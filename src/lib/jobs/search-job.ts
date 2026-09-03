import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, SearchJobRow } from "@/lib/db/types";
import { registerCompany } from "@/lib/companies/register";
import { getGbizProvider, mapGbizToCompanyInput, matchesConditions, type GbizHojin } from "@/lib/integrations/gbiz";
import { getPlacesProvider } from "@/lib/integrations/google-places";
import { Logger, serializeError } from "@/lib/logging/logger";
import { enqueueCrawlJob } from "./enqueue";
import { parseStoredConditions } from "./search-conditions";

const PAGE_LIMIT = 50;
const MAX_PAGES_PER_STEP = 6;

interface SearchCursor {
  page?: number;
  done?: boolean;
  totalPages?: number;
}

export type StepOutcome = "continue" | "completed" | "failed";

/**
 * 検索ジョブを 1 ステップ進める。
 * GビズINFO からページ単位で候補を取得し、条件フィルタ → 重複判定 → 登録 → クロールジョブ投入。
 * 時間切れ or 上限ページ数に達したら cursor を保存して "continue" を返す（次回呼び出しで再開）。
 */
export async function processSearchJobStep(db: AdminClient, job: SearchJobRow, logger: Logger, deadline: number): Promise<StepOutcome> {
  const conditions = parseStoredConditions(job.conditions);
  const cursor = (job.cursor ?? {}) as SearchCursor;
  const provider = getGbizProvider();
  const places = getPlacesProvider();
  let page = cursor.page ?? 1;
  let registered = job.registered_count;
  let pagesThisStep = 0;
  const detailCache = new Map<string, GbizHojin | null>();

  if (job.attempts === 1 && !cursor.page) {
    await logger.info("企業検索を開始", { conditions, provider: provider.name });
    await db.from("search_jobs").update({ provider: provider.name }).eq("id", job.id);
  }

  try {
    while (registered < job.requested_count && pagesThisStep < MAX_PAGES_PER_STEP && Date.now() < deadline) {
      const result = await provider.search(conditions, page, PAGE_LIMIT);
      pagesThisStep++;
      await logger.info(`候補を取得 (page ${page}/${result.totalPages || "?"})`, { count: result.items.length, totalCount: result.totalCount });
      if (result.items.length === 0) {
        cursor.done = true;
        break;
      }
      await db.rpc("increment_search_job_counters", { p_job_id: job.id, p_found: result.items.length });

      for (const item of result.items) {
        if (registered >= job.requested_count) break;
        if (Date.now() > deadline) break;

        const name = (item.name ?? "").trim();
        if (!name) continue;
        const match = matchesConditions(item, conditions);
        if (!match.ok) {
          await recordItem(db, job.id, item, "skipped", match.reason ?? null, null);
          continue;
        }

        let hojin = item;
        // 検索結果に URL が無い場合のみ詳細取得（API 呼び出しを最小化）
        if (!hojin.company_url && provider.name === "gbiz" && hojin.corporate_number) {
          if (!detailCache.has(hojin.corporate_number)) {
            try {
              detailCache.set(hojin.corporate_number, await provider.detail(hojin.corporate_number));
            } catch (err) {
              await logger.warn("GビズINFO 詳細取得に失敗", { corporateNumber: hojin.corporate_number, ...serializeError(err) });
              detailCache.set(hojin.corporate_number, null);
            }
          }
          const detail = detailCache.get(hojin.corporate_number);
          if (detail) hojin = { ...hojin, ...detail };
        }

        const input = mapGbizToCompanyInput(hojin, conditions.industry);
        input.createdBy = job.created_by;

        if (!input.websiteUrl && conditions.requireWebsite) {
          // 公式HP必須: Places で候補探索、見つからなければスキップ
          try {
            const found = await places.findCompany(`${input.companyName} ${input.address ?? ""}`.trim());
            const withSite = found.find((f) => f.websiteUrl);
            if (withSite?.websiteUrl) input.websiteUrl = withSite.websiteUrl;
          } catch (err) {
            await logger.warn("Google Places 検索に失敗", serializeError(err));
          }
          if (!input.websiteUrl) {
            await recordItem(db, job.id, item, "skipped", "公式HPが見つからない", null);
            continue;
          }
        }

        try {
          const reg = await registerCompany(db, input, logger.child({ category: "company" }));
          registered++;
          if (reg.status === "new") {
            await recordItem(db, job.id, item, "new", null, reg.company.id);
            await db.rpc("increment_search_job_counters", { p_job_id: job.id, p_registered: 1, p_new: 1 });
            if (reg.company.verification_status !== "no_website" || !conditions.requireWebsite) {
              await enqueueCrawlJob(db, reg.company.id, { searchJobId: job.id, enqueueAnalysis: true });
            }
          } else {
            await recordItem(db, job.id, item, "duplicate", reg.reason, reg.company.id);
            await db.rpc("increment_search_job_counters", { p_job_id: job.id, p_registered: 1, p_duplicate: 1 });
            // 既存企業でも未クロール / 未分析なら処理に載せる
            if (reg.company.crawl_status === "not_crawled" && reg.company.verification_status !== "no_website") {
              await enqueueCrawlJob(db, reg.company.id, { searchJobId: job.id, enqueueAnalysis: true });
            }
          }
        } catch (err) {
          await logger.error("企業登録に失敗", { companyName: name, ...serializeError(err) });
          await recordItem(db, job.id, item, "failed", err instanceof Error ? err.message : String(err), null);
          await db.rpc("increment_search_job_counters", { p_job_id: job.id, p_failed: 1 });
        }
      }

      if (result.totalPages && page >= result.totalPages) {
        cursor.done = true;
        break;
      }
      cursor.totalPages = result.totalPages;
      page++;
    }
  } catch (err) {
    await logger.error("企業検索でエラー", serializeError(err));
    await db.from("search_jobs").update({ cursor: { ...cursor, page } as Json, error: err instanceof Error ? err.message : String(err) }).eq("id", job.id);
    throw err;
  }

  cursor.page = page;
  const finished = cursor.done || registered >= job.requested_count;
  await db.from("search_jobs").update({ cursor: cursor as Json }).eq("id", job.id);
  if (finished) {
    await logger.info("企業検索が完了", { registered, requested: job.requested_count, pages: page });
    return "completed";
  }
  return "continue";
}

async function recordItem(db: AdminClient, jobId: string, item: GbizHojin, status: "new" | "duplicate" | "skipped" | "failed", reason: string | null, companyId: string | null) {
  await db.from("search_job_items").insert({
    search_job_id: jobId,
    company_id: companyId,
    corporate_number: item.corporate_number ?? null,
    company_name: (item.name ?? "").trim() || "(no name)",
    status,
    reason,
  });
}
