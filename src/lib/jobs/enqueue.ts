import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/db/types";
import type { CompanySearchConditions } from "@/lib/integrations/gbiz/types";

/** クロールジョブを追加（同一企業の pending/retrying/processing があれば追加しない） */
export async function enqueueCrawlJob(
  db: AdminClient,
  companyId: string,
  options: { searchJobId?: string | null; enqueueAnalysis?: boolean; priority?: number } = {},
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await db
    .from("crawl_jobs")
    .select("id")
    .eq("company_id", companyId)
    .in("status", ["pending", "retrying", "processing"])
    .limit(1);
  if (existing && existing.length > 0) return { id: existing[0].id, created: false };

  const { data, error } = await db
    .from("crawl_jobs")
    .insert({
      company_id: companyId,
      search_job_id: options.searchJobId ?? null,
      enqueue_analysis: options.enqueueAnalysis ?? true,
      priority: options.priority ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`クロールジョブの作成に失敗: ${error?.message}`);
  await db.from("companies").update({ crawl_status: "not_crawled" }).eq("id", companyId).in("crawl_status", ["failed", "crawled"]);
  return { id: data.id, created: true };
}

export async function enqueueAnalysisJob(
  db: AdminClient,
  companyId: string,
  options: { searchJobId?: string | null; priority?: number } = {},
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await db
    .from("analysis_jobs")
    .select("id")
    .eq("company_id", companyId)
    .in("status", ["pending", "retrying", "processing"])
    .limit(1);
  if (existing && existing.length > 0) return { id: existing[0].id, created: false };

  const { data, error } = await db
    .from("analysis_jobs")
    .insert({ company_id: companyId, search_job_id: options.searchJobId ?? null, priority: options.priority ?? 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`分析ジョブの作成に失敗: ${error?.message}`);
  return { id: data.id, created: true };
}

export async function createSearchJob(
  db: AdminClient,
  conditions: CompanySearchConditions,
  options: { name?: string; createdBy?: string | null; provider?: string } = {},
): Promise<string> {
  const { data, error } = await db
    .from("search_jobs")
    .insert({
      name: options.name ?? null,
      conditions: conditions as unknown as Json,
      requested_count: conditions.requestedCount,
      created_by: options.createdBy ?? null,
      provider: options.provider ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`検索ジョブの作成に失敗: ${error?.message}`);
  return data.id;
}

/** 失敗したジョブを再実行可能にする（失敗企業のみ再実行） */
export async function retryFailedJobs(
  db: AdminClient,
  scope: { searchJobId?: string; companyId?: string; jobType?: "crawl" | "analysis" | "search" } = {},
): Promise<{ crawl: number; analysis: number; search: number }> {
  const result = { crawl: 0, analysis: 0, search: 0 };
  const reset = { status: "pending" as const, attempts: 0, error: null, locked_at: null };

  if (!scope.jobType || scope.jobType === "crawl") {
    let q = db.from("crawl_jobs").update(reset).eq("status", "failed");
    if (scope.searchJobId) q = q.eq("search_job_id", scope.searchJobId);
    if (scope.companyId) q = q.eq("company_id", scope.companyId);
    const { data } = await q.select("id");
    result.crawl = data?.length ?? 0;
  }
  if (!scope.jobType || scope.jobType === "analysis") {
    let q = db.from("analysis_jobs").update(reset).eq("status", "failed");
    if (scope.searchJobId) q = q.eq("search_job_id", scope.searchJobId);
    if (scope.companyId) q = q.eq("company_id", scope.companyId);
    const { data } = await q.select("id");
    result.analysis = data?.length ?? 0;
  }
  if ((!scope.jobType || scope.jobType === "search") && !scope.companyId) {
    let q = db.from("search_jobs").update({ ...reset, status: "pending" as const }).eq("status", "failed");
    if (scope.searchJobId) q = q.eq("id", scope.searchJobId);
    const { data } = await q.select("id");
    result.search = data?.length ?? 0;
  }
  return result;
}
