"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getGbizProvider } from "@/lib/integrations/gbiz";
import { registerCompany } from "@/lib/companies/register";
import { extractDomain, normalizeUrl } from "@/lib/companies/normalize";
import { Logger, serializeError } from "@/lib/logging/logger";
import { createSearchJob, enqueueAnalysisJob, enqueueCrawlJob, retryFailedJobs } from "@/lib/jobs/enqueue";
import { kickJobProcessing } from "@/lib/jobs/kick";
import { processJobs } from "@/lib/jobs/runner";
import { describeConditions, searchConditionsSchema, toSearchConditions } from "@/lib/jobs/search-conditions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthDisabled } from "@/lib/config/env";
import type { Json } from "@/lib/db/types";

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string> } | null;

export async function signOutAction() {
  if (!isAuthDisabled()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/** 「企業を探す」: 検索ジョブを作成し、バックグラウンド処理を開始して進捗画面へ */
export async function createSearchJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = searchConditionsSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "form")] = issue.message;
    return { ok: false, message: "入力内容を確認してください", errors };
  }
  const conditions = toSearchConditions(parsed.data);
  if (conditions.employeeMin !== undefined && conditions.employeeMax !== undefined && conditions.employeeMin > conditions.employeeMax) {
    return { ok: false, message: "従業員数の下限が上限を超えています", errors: { employeeMin: "下限 ≤ 上限 にしてください" } };
  }
  const db = createSupabaseAdminClient();
  const logger = new Logger(db, { category: "search" });
  let jobId: string;
  try {
    // プロバイダの設定不備（APIキー未設定など）はここで早期に検知
    const provider = getGbizProvider();
    jobId = await createSearchJob(db, conditions, { name: describeConditions(conditions), createdBy: user.id, provider: provider.name });
    await logger.info("検索ジョブを作成", { jobId, conditions });
  } catch (err) {
    await logger.error("検索ジョブの作成に失敗", serializeError(err));
    return { ok: false, message: err instanceof Error ? err.message : "検索ジョブの作成に失敗しました" };
  }
  kickJobProcessing();
  redirect(`/search/${jobId}`);
}

/** 手動企業追加: 企業名 + 公式URL → 登録 → クロール → 分析 */
export async function addCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const companyName = String(formData.get("companyName") ?? "").trim();
  const websiteUrlRaw = String(formData.get("websiteUrl") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const industry = String(formData.get("industry") ?? "").trim() || null;
  const corporateNumberRaw = String(formData.get("corporateNumber") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!companyName) errors.companyName = "企業名は必須です";
  const websiteUrl = websiteUrlRaw ? normalizeUrl(websiteUrlRaw) : null;
  if (websiteUrlRaw && !websiteUrl) errors.websiteUrl = "URL の形式が正しくありません";
  const corporateNumber = corporateNumberRaw ? corporateNumberRaw.replace(/\D/g, "") : null;
  if (corporateNumber && corporateNumber.length !== 13) errors.corporateNumber = "法人番号は13桁です";
  if (Object.keys(errors).length > 0) return { ok: false, message: "入力内容を確認してください", errors };

  const db = createSupabaseAdminClient();
  const logger = new Logger(db, { category: "company" });
  let companyId: string;
  let duplicate = false;
  try {
    const result = await registerCompany(
      db,
      { companyName, websiteUrl, address, industry, corporateNumber: corporateNumber || null, source: "manual", createdBy: user.id },
      logger,
    );
    companyId = result.company.id;
    duplicate = result.status === "duplicate";
    if (duplicate && websiteUrl && !result.company.website_url) {
      // 既存企業に URL が無ければ候補として追加
      const existing = (result.company.website_candidates as unknown as { url: string; source: string }[]) ?? [];
      if (!existing.some((c) => c.url === websiteUrl)) {
        await db
          .from("companies")
          .update({ website_candidates: [...existing, { url: websiteUrl, source: "manual" }] as unknown as Json })
          .eq("id", companyId);
      }
    }
    if (websiteUrl || result.company.website_url || (result.company.website_candidates as unknown[]).length > 0) {
      await enqueueCrawlJob(db, companyId, { enqueueAnalysis: true, priority: 10 });
    }
  } catch (err) {
    await logger.error("手動企業追加に失敗", serializeError(err));
    return { ok: false, message: err instanceof Error ? err.message : "登録に失敗しました" };
  }
  kickJobProcessing();
  revalidatePath("/companies");
  redirect(`/companies/${companyId}${duplicate ? "?duplicate=1" : "?created=1"}`);
}

/** 再解析: サイト再クロール → AI 再分析 */
export async function reanalyzeCompanyAction(companyId: string): Promise<ActionState> {
  await requireUser();
  const db = createSupabaseAdminClient();
  const { data: company } = await db.from("companies").select("id, website_url, website_candidates, verification_status").eq("id", companyId).single();
  if (!company) return { ok: false, message: "企業が見つかりません" };
  const hasCandidate = Boolean(company.website_url) || ((company.website_candidates as unknown[]) ?? []).length > 0;
  if (!hasCandidate) return { ok: false, message: "公式サイトURLが未設定のため再解析できません。先に公式サイトを設定してください。" };
  // 古い失敗ジョブは残し、新規に投入
  await enqueueCrawlJob(db, companyId, { enqueueAnalysis: true, priority: 20 });
  await new Logger(db, { category: "crawl", companyId }).info("再解析をリクエスト");
  kickJobProcessing();
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "再解析を開始しました。完了まで数分かかることがあります。" };
}

/** クロール済みだが未分析の企業を AI 分析のみ再実行 */
export async function analyzeOnlyAction(companyId: string): Promise<ActionState> {
  await requireUser();
  const db = createSupabaseAdminClient();
  const { count } = await db.from("company_pages").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (!count) return { ok: false, message: "クロール済みページがありません。再解析（クロール込み）を実行してください。" };
  await enqueueAnalysisJob(db, companyId, { priority: 20 });
  kickJobProcessing();
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "AI分析を開始しました。" };
}

/** 要確認企業の公式サイトを手動で確定 */
export async function setOfficialSiteAction(companyId: string, url: string): Promise<ActionState> {
  await requireUser();
  const normalized = normalizeUrl(url);
  const domain = extractDomain(normalized);
  if (!normalized || !domain) return { ok: false, message: "URL の形式が正しくありません" };
  const db = createSupabaseAdminClient();
  const { data: conflict } = await db.from("companies").select("id, company_name").eq("website_domain", domain).neq("id", companyId).limit(1);
  if (conflict && conflict.length > 0) return { ok: false, message: `このドメインは「${conflict[0].company_name}」に登録済みです（重複）` };
  const { error } = await db
    .from("companies")
    .update({ website_url: normalized, website_domain: domain, verification_status: "manual", official_site_confidence: 100, crawl_status: "not_crawled" })
    .eq("id", companyId);
  if (error) return { ok: false, message: error.message };
  await enqueueCrawlJob(db, companyId, { enqueueAnalysis: true, priority: 20 });
  await new Logger(db, { category: "company", companyId }).info("公式サイトを手動設定", { url: normalized });
  kickJobProcessing();
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "公式サイトを設定し、クロールを開始しました。" };
}

/** 営業可否を手動で上書き */
export async function setSalesContactAllowedAction(companyId: string, value: "true" | "false" | "unknown"): Promise<ActionState> {
  await requireUser();
  const db = createSupabaseAdminClient();
  const { error } = await db.from("companies").update({ sales_contact_allowed: value }).eq("id", companyId);
  if (error) return { ok: false, message: error.message };
  if (value === "false") {
    const { data: existing } = await db.from("suppression_list").select("id").eq("company_id", companyId).eq("reason", "manual").limit(1);
    if (!existing || existing.length === 0) await db.from("suppression_list").insert({ company_id: companyId, reason: "manual", note: "画面から手動設定" });
  } else {
    await db.from("suppression_list").delete().eq("company_id", companyId).eq("reason", "manual");
  }
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "営業可否を更新しました" };
}

export async function retryFailedJobsAction(scope: { searchJobId?: string; companyId?: string; jobType?: "crawl" | "analysis" | "search" }): Promise<ActionState> {
  await requireUser();
  const db = createSupabaseAdminClient();
  const result = await retryFailedJobs(db, scope);
  const total = result.crawl + result.analysis + result.search;
  if (total > 0) kickJobProcessing();
  revalidatePath("/jobs");
  if (scope.searchJobId) revalidatePath(`/search/${scope.searchJobId}`);
  if (scope.companyId) revalidatePath(`/companies/${scope.companyId}`);
  return { ok: true, message: total > 0 ? `${total}件のジョブを再実行キューに戻しました` : "再実行対象の失敗ジョブはありません" };
}

export async function cancelSearchJobAction(searchJobId: string): Promise<ActionState> {
  await requireUser();
  const db = createSupabaseAdminClient();
  await db.from("search_jobs").update({ status: "cancelled", completed_at: new Date().toISOString(), locked_at: null }).eq("id", searchJobId).in("status", ["pending", "processing", "retrying"]);
  await db.from("crawl_jobs").update({ status: "cancelled" }).eq("search_job_id", searchJobId).in("status", ["pending", "retrying"]);
  await db.from("analysis_jobs").update({ status: "cancelled" }).eq("search_job_id", searchJobId).in("status", ["pending", "retrying"]);
  revalidatePath(`/search/${searchJobId}`);
  revalidatePath("/jobs");
  return { ok: true, message: "検索ジョブをキャンセルしました" };
}

/** 手動でジョブ処理を1サイクル実行（Cron が無いローカル環境用） */
export async function runJobsNowAction(): Promise<ActionState> {
  await requireUser();
  try {
    const stats = await processJobs({ maxRuntimeMs: 25_000 });
    revalidatePath("/jobs");
    return { ok: true, message: `処理完了: 検索${stats.searchSteps} / クロール${stats.crawlJobs} / 分析${stats.analysisJobs}（失敗${stats.failures}）` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "ジョブ処理に失敗しました" };
  }
}
