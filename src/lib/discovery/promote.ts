import type { Db } from "@/db";
import type {
  CompanySource,
  CompanySourceInsert,
  DiscoveryCandidateRow,
  DiscoveryProviderName,
  Json,
} from "@/db/types";
import { replaceCompanySources, updateCandidate } from "@/db/repositories/discovery";
import { registerCompany } from "@/lib/companies/register";
import { enqueueCrawlJob } from "@/lib/jobs/enqueue";
import type { Logger } from "@/lib/logging/logger";
import { dedupeObservations } from "./deduplicator";
import type { DiscoveryCandidate, MergedCandidate } from "./types";

export interface PromoteOptions {
  /** 探索条件（採用必須などの判定に使う） */
  recruitingRequired?: boolean;
  industryFallback?: string | null;
  createdBy?: string | null;
  /** レビューで公式サイトを手修正した場合に上書きする */
  websiteUrl?: string | null;
  /** クロールジョブを投入するか（既定: 公式サイトがあれば投入） */
  enqueueCrawl?: boolean;
}

export interface PromoteResult {
  companyId: string;
  created: boolean;
  crawlEnqueued: boolean;
}

/**
 * 本人確認を通過した候補を companies へ昇格させる。
 * ここを通らずに companies へ企業を追加してはいけない（Discovery → Verification → Verified の順を守る）。
 */
export async function promoteCandidate(db: Db, row: DiscoveryCandidateRow, options: PromoteOptions, logger: Logger): Promise<PromoteResult> {
  const websiteUrl = options.websiteUrl ?? row.website;
  const reg = await registerCompany(
    db,
    {
      corporateNumber: row.corporate_number,
      companyName: row.name,
      address: row.address,
      prefecture: row.prefecture,
      city: row.city,
      industry: row.industry ?? options.industryFallback ?? null,
      phone: row.phone,
      websiteUrl,
      source: toCompanySource(row.primary_source),
      sourceRaw: row.raw_data,
      createdBy: options.createdBy ?? null,
    },
    logger,
  );

  await updateCandidate(db, row.id, { company_id: reg.company.id, website: websiteUrl });
  await saveCompanySources(db, reg.company.id, { ...row, website: websiteUrl });

  // Full Crawl は「本人確認済み かつ 公式サイトあり」のみ。
  // 採用活動が条件のとき、採用の痕跡が無い企業には無駄なアクセスをしない。
  const skipForRecruiting = Boolean(options.recruitingRequired) && row.recruiting_signal === "no";
  const shouldCrawl = (options.enqueueCrawl ?? Boolean(websiteUrl)) && Boolean(websiteUrl) && !skipForRecruiting;
  if (shouldCrawl) {
    await enqueueCrawlJob(db, reg.company.id, { enqueueAnalysis: true });
  } else if (skipForRecruiting) {
    await logger.info("採用活動の痕跡が無いためクロールを見送り", { company: row.name });
  }

  return { companyId: reg.company.id, created: reg.status === "new", crawlEnqueued: shouldCrawl };
}

/** 企業情報の出所をすべて残す（どの Provider が何を観測したか） */
export async function saveCompanySources(db: Db, companyId: string, row: DiscoveryCandidateRow): Promise<void> {
  const merged = rowToMerged(row);
  const sources: CompanySourceInsert[] = merged.observations.map((o) => ({
    company_id: companyId,
    provider: o.source,
    external_id: o.sourceId,
    source_url: o.sourceUrl,
    source_type: "discovery",
    confidence: o.sourceConfidence,
    observed_data: {
      name: o.name,
      address: o.address,
      phone: o.phone,
      website: o.website,
      corporateNumber: o.corporateNumber,
      industry: o.industry,
      observedAt: o.discoveredAt,
    } as unknown as Json,
  }));
  if (row.official_site_confidence !== null && row.website) {
    sources.push({
      company_id: companyId,
      provider: "official_web",
      external_id: row.domain,
      source_url: row.website,
      source_type: "verification",
      confidence: row.official_site_confidence,
      observed_data: { verificationScore: row.verification_score, signals: row.verification_signals } as unknown as Json,
    });
  }
  // ON CONFLICT DO NOTHING は同一 INSERT 文の中の重複を弾かないため、ここで畳んでおく。
  // 同じ企業を再探索したときに行が増えないよう、同じ観測は置き換える。
  await replaceCompanySources(db, companyId, dedupeSourceRows(sources));
}

/** (provider, external_id, source_url) が同じ行は confidence の高い 1 件だけ残す */
function dedupeSourceRows(rows: CompanySourceInsert[]): CompanySourceInsert[] {
  const byKey = new Map<string, CompanySourceInsert>();
  for (const row of rows) {
    const key = [row.provider, row.external_id ?? "", row.source_url ?? "", row.source_type ?? ""].join("|");
    const prev = byKey.get(key);
    if (!prev || (row.confidence ?? 0) > (prev.confidence ?? 0)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/** discovery_candidates の行を MergedCandidate に戻す（観測は raw_data に保持している） */
export function rowToMerged(row: DiscoveryCandidateRow): MergedCandidate {
  const raw = (row.raw_data ?? {}) as { observations?: DiscoveryCandidate[] };
  const base: DiscoveryCandidate = {
    name: row.name,
    normalizedName: row.normalized_name,
    address: row.address,
    prefecture: row.prefecture,
    city: row.city,
    phone: row.phone,
    website: row.website,
    domain: row.domain,
    corporateNumber: row.corporate_number,
    industry: row.industry,
    source: row.primary_source,
    // 観測が残っていない古い行でも情報源を特定できるようにする。
    // ここが null だと company_sources の external_id が NULL になり、
    // ユニークインデックスが効かず再探索のたびに行が増える。
    sourceId: row.corporate_number ?? row.domain,
    sourceUrl: row.website,
    sourceConfidence: row.source_confidence,
    rawData: row.raw_data,
    discoveredAt: row.created_at,
  };
  const observations = Array.isArray(raw.observations) && raw.observations.length > 0 ? dedupeObservations(raw.observations) : [base];
  const sources = row.sources as DiscoveryProviderName[];
  return { ...base, observations, sources: sources.length > 0 ? sources : [row.primary_source] };
}

/** discovery の Provider 名を companies.source の値へ写す */
export function toCompanySource(provider: DiscoveryProviderName): CompanySource {
  if (provider === "gbiz") return "gbiz";
  if (provider === "google_places") return "google_places";
  return "import";
}
