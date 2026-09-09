import type { Db } from "@/db";
import type { Json } from "@/db/types";
import { updateCompanyWhereCrawlStatusIn } from "@/db/repositories/companies";
import { findActiveJobId, insertAnalysisJob, insertCrawlJob, insertSearchJob, retryFailedJobs as repoRetryFailedJobs, retryFailedSearchJobs } from "@/db/repositories/jobs";
import { insertDiscoveryRun } from "@/db/repositories/discovery";
import { getDiscoveryConfig, scaleBudgetForRequest } from "@/lib/config/discovery";
import type { DiscoveryCriteria, DiscoveryMode } from "@/lib/discovery/types";
import type { CompanySearchConditions } from "@/lib/integrations/gbiz/types";

/** クロールジョブを追加（同一企業の pending/retrying/processing があれば追加しない） */
export async function enqueueCrawlJob(
  db: Db,
  companyId: string,
  options: { searchJobId?: string | null; enqueueAnalysis?: boolean; priority?: number } = {},
): Promise<{ id: string; created: boolean }> {
  const existing = await findActiveJobId(db, "crawl", companyId);
  if (existing) return { id: existing, created: false };
  const id = await insertCrawlJob(db, {
    company_id: companyId,
    search_job_id: options.searchJobId ?? null,
    enqueue_analysis: options.enqueueAnalysis ?? true,
    priority: options.priority ?? 0,
  });
  await updateCompanyWhereCrawlStatusIn(db, companyId, ["failed", "crawled"], { crawl_status: "not_crawled" });
  return { id, created: true };
}

export async function enqueueAnalysisJob(
  db: Db,
  companyId: string,
  options: { searchJobId?: string | null; priority?: number } = {},
): Promise<{ id: string; created: boolean }> {
  const existing = await findActiveJobId(db, "analysis", companyId);
  if (existing) return { id: existing, created: false };
  const id = await insertAnalysisJob(db, { company_id: companyId, search_job_id: options.searchJobId ?? null, priority: options.priority ?? 0 });
  return { id, created: true };
}

export async function createSearchJob(
  db: Db,
  conditions: CompanySearchConditions,
  options: { name?: string; createdBy?: string | null; provider?: string } = {},
): Promise<string> {
  return insertSearchJob(db, {
    name: options.name ?? null,
    conditions: conditions as unknown as Json,
    requested_count: conditions.requestedCount,
    created_by: options.createdBy ?? null,
    provider: options.provider ?? null,
  });
}

/**
 * 企業探索（Discovery Run）を登録する。
 * 実際の探索はジョブランナーがステップ実行するため、ここでは 1 行作るだけ。
 */
export async function createDiscoveryRun(
  db: Db,
  criteria: DiscoveryCriteria,
  options: { name?: string; mode?: DiscoveryMode; createdBy?: string | null } = {},
): Promise<string> {
  const cfg = getDiscoveryConfig();
  const mode = options.mode ?? cfg.mode;
  const run = await insertDiscoveryRun(db, {
    name: options.name ?? null,
    criteria: criteria as unknown as Json,
    mode,
    requested_count: criteria.maxResults,
    budget: scaleBudgetForRequest(cfg.budget, criteria.maxResults) as unknown as Json,
    created_by: options.createdBy ?? null,
  });
  return run.id;
}

/** 失敗したジョブを再実行可能にする（失敗企業のみ再実行） */
export async function retryFailedJobs(
  db: Db,
  scope: { searchJobId?: string; companyId?: string; jobType?: "crawl" | "analysis" | "search" } = {},
): Promise<{ crawl: number; analysis: number; search: number }> {
  const result = { crawl: 0, analysis: 0, search: 0 };
  if (!scope.jobType || scope.jobType === "crawl") result.crawl = await repoRetryFailedJobs(db, "crawl", scope);
  if (!scope.jobType || scope.jobType === "analysis") result.analysis = await repoRetryFailedJobs(db, "analysis", scope);
  if ((!scope.jobType || scope.jobType === "search") && !scope.companyId) result.search = await retryFailedSearchJobs(db, scope.searchJobId);
  return result;
}
