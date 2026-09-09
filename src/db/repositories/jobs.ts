import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../index";
import { rawRows } from "../index";
import { analysisJobs, companies, crawlJobs, searchJobItems, searchJobs } from "../schema";
import type { AnalysisJobRow, CrawlJobRow, JobStatus, SearchJobItemRow, SearchJobRow } from "../types";

export type JobKind = "crawl" | "analysis";
export type JobTable = "search_jobs" | "crawl_jobs" | "analysis_jobs" | "discovery_runs";

export const ACTIVE_JOB_STATUSES: JobStatus[] = ["pending", "retrying", "processing"];

function jobTable(kind: JobKind) {
  return kind === "crawl" ? crawlJobs : analysisJobs;
}

/**
 * 次のジョブを取得（PostgreSQL 関数 claim_job: FOR UPDATE SKIP LOCKED）。
 * 複数の worker が同時に呼んでも同じジョブは 1 つの worker にしか渡らない。
 */
export async function claimJob<T>(db: Db, table: JobTable, staleMinutes = 15): Promise<T | null> {
  const rows = await rawRows<{ job: T | string | null }>(db, sql`select public.claim_job(${table}, ${staleMinutes}) as job`);
  const job = rows[0]?.job ?? null;
  if (job === null) return null;
  return (typeof job === "string" ? JSON.parse(job) : job) as T;
}

// ---- search_jobs -----------------------------------------------------------

export async function insertSearchJob(db: Db, values: typeof searchJobs.$inferInsert): Promise<string> {
  const rows = await db.insert(searchJobs).values(values).returning({ id: searchJobs.id });
  return rows[0].id;
}

export async function getSearchJob(db: Db, id: string): Promise<SearchJobRow | null> {
  const rows = await db.select().from(searchJobs).where(eq(searchJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateSearchJob(db: Db, id: string, values: Partial<typeof searchJobs.$inferInsert>): Promise<void> {
  await db.update(searchJobs).set(values).where(eq(searchJobs.id, id));
}

export async function incrementSearchJobCounters(
  db: Db,
  jobId: string,
  delta: { found?: number; registered?: number; new?: number; duplicate?: number; skipped?: number; failed?: number },
): Promise<void> {
  await db.execute(
    sql`select public.increment_search_job_counters(${jobId}::uuid, ${delta.found ?? 0}, ${delta.registered ?? 0}, ${delta.new ?? 0}, ${delta.duplicate ?? 0}, ${delta.skipped ?? 0}, ${delta.failed ?? 0})`,
  );
}

export async function listSearchJobs(db: Db, limit: number): Promise<SearchJobRow[]> {
  return db.select().from(searchJobs).orderBy(desc(searchJobs.created_at)).limit(limit);
}

export async function cancelSearchJob(db: Db, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.update(searchJobs).set({ status: "cancelled", completed_at: now, locked_at: null }).where(and(eq(searchJobs.id, id), inArray(searchJobs.status, ACTIVE_JOB_STATUSES)));
  await db.update(crawlJobs).set({ status: "cancelled" }).where(and(eq(crawlJobs.search_job_id, id), inArray(crawlJobs.status, ["pending", "retrying"])));
  await db.update(analysisJobs).set({ status: "cancelled" }).where(and(eq(analysisJobs.search_job_id, id), inArray(analysisJobs.status, ["pending", "retrying"])));
}

// ---- search_job_items ------------------------------------------------------

export async function insertSearchJobItem(db: Db, values: typeof searchJobItems.$inferInsert): Promise<void> {
  await db.insert(searchJobItems).values(values);
}

export type SearchJobItemWithCompany = SearchJobItemRow & {
  companies: { verification_status: string; analysis_status: string; sales_contact_allowed: string } | null;
};

export async function listSearchJobItemsWithCompany(db: Db, jobId: string, limit = 500): Promise<SearchJobItemWithCompany[]> {
  const rows = await db
    .select({
      item: searchJobItems,
      verification_status: companies.verification_status,
      analysis_status: companies.analysis_status,
      sales_contact_allowed: companies.sales_contact_allowed,
    })
    .from(searchJobItems)
    .leftJoin(companies, eq(companies.id, searchJobItems.company_id))
    .where(eq(searchJobItems.search_job_id, jobId))
    .orderBy(desc(searchJobItems.created_at))
    .limit(limit);
  return rows.map((r) => ({
    ...r.item,
    companies: r.verification_status ? { verification_status: r.verification_status, analysis_status: r.analysis_status!, sales_contact_allowed: r.sales_contact_allowed! } : null,
  }));
}

export async function countNeedsReviewForSearchJob(db: Db, jobId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(searchJobItems)
    .innerJoin(companies, eq(companies.id, searchJobItems.company_id))
    .where(and(eq(searchJobItems.search_job_id, jobId), eq(companies.verification_status, "needs_review")));
  return rows[0]?.count ?? 0;
}

// ---- crawl_jobs / analysis_jobs --------------------------------------------

export async function findActiveJobId(db: Db, kind: JobKind, companyId: string): Promise<string | null> {
  const t = jobTable(kind);
  const rows = await db.select({ id: t.id }).from(t).where(and(eq(t.company_id, companyId), inArray(t.status, ACTIVE_JOB_STATUSES))).limit(1);
  return rows[0]?.id ?? null;
}

export async function insertCrawlJob(db: Db, values: typeof crawlJobs.$inferInsert): Promise<string> {
  const rows = await db.insert(crawlJobs).values(values).returning({ id: crawlJobs.id });
  return rows[0].id;
}

export async function insertAnalysisJob(db: Db, values: typeof analysisJobs.$inferInsert): Promise<string> {
  const rows = await db.insert(analysisJobs).values(values).returning({ id: analysisJobs.id });
  return rows[0].id;
}

export interface JobUpdate {
  status?: JobStatus;
  locked_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  result?: unknown;
  attempts?: number;
}

export async function updateJob(db: Db, kind: JobKind, id: string, values: JobUpdate): Promise<void> {
  const set = { ...values, result: values.result as never };
  if (values.result === undefined) delete (set as { result?: unknown }).result;
  if (kind === "crawl") await db.update(crawlJobs).set(set).where(eq(crawlJobs.id, id));
  else await db.update(analysisJobs).set(set).where(eq(analysisJobs.id, id));
}

/** 検索ジョブに紐づくジョブの status 一覧（進捗集計用） */
export async function listJobStatusesForSearchJob(db: Db, kind: JobKind, searchJobId: string): Promise<{ status: JobStatus }[]> {
  const t = jobTable(kind);
  return db.select({ status: t.status }).from(t).where(eq(t.search_job_id, searchJobId));
}

export async function countJobsByStatus(db: Db, kind: JobKind): Promise<Record<JobStatus, number>> {
  const t = jobTable(kind);
  const rows = await db.select({ status: t.status, count: sql<number>`count(*)::int` }).from(t).groupBy(t.status);
  const result: Record<JobStatus, number> = { pending: 0, processing: 0, completed: 0, failed: 0, retrying: 0, cancelled: 0 };
  for (const r of rows) result[r.status] = r.count;
  return result;
}

export interface FailedJobWithCompany {
  id: string;
  company_id: string;
  error: string | null;
  attempts: number;
  updated_at: string;
  company_name: string | null;
}

export async function listFailedJobsWithCompany(db: Db, kind: JobKind, limit = 20): Promise<FailedJobWithCompany[]> {
  const t = jobTable(kind);
  return db
    .select({ id: t.id, company_id: t.company_id, error: t.error, attempts: t.attempts, updated_at: t.updated_at, company_name: companies.company_name })
    .from(t)
    .leftJoin(companies, eq(companies.id, t.company_id))
    .where(eq(t.status, "failed"))
    .orderBy(desc(t.updated_at))
    .limit(limit);
}

export async function listCompanyJobs(db: Db, kind: "crawl", companyId: string, limit?: number): Promise<CrawlJobRow[]>;
export async function listCompanyJobs(db: Db, kind: "analysis", companyId: string, limit?: number): Promise<AnalysisJobRow[]>;
export async function listCompanyJobs(db: Db, kind: JobKind, companyId: string, limit = 5): Promise<CrawlJobRow[] | AnalysisJobRow[]> {
  if (kind === "crawl") return db.select().from(crawlJobs).where(eq(crawlJobs.company_id, companyId)).orderBy(desc(crawlJobs.created_at)).limit(limit);
  return db.select().from(analysisJobs).where(eq(analysisJobs.company_id, companyId)).orderBy(desc(analysisJobs.created_at)).limit(limit);
}

/** 失敗ジョブを pending に戻す。戻した件数を返す */
export async function retryFailedJobs(db: Db, kind: JobKind, scope: { searchJobId?: string; companyId?: string }): Promise<number> {
  const t = jobTable(kind);
  const conditions = [eq(t.status, "failed")];
  if (scope.searchJobId) conditions.push(eq(t.search_job_id, scope.searchJobId));
  if (scope.companyId) conditions.push(eq(t.company_id, scope.companyId));
  const reset = { status: "pending" as const, attempts: 0, error: null, locked_at: null };
  const rows =
    kind === "crawl"
      ? await db.update(crawlJobs).set(reset).where(and(...conditions)).returning({ id: crawlJobs.id })
      : await db.update(analysisJobs).set(reset).where(and(...conditions)).returning({ id: analysisJobs.id });
  return rows.length;
}

export async function retryFailedSearchJobs(db: Db, searchJobId?: string): Promise<number> {
  const conditions = [eq(searchJobs.status, "failed")];
  if (searchJobId) conditions.push(eq(searchJobs.id, searchJobId));
  const rows = await db.update(searchJobs).set({ status: "pending", attempts: 0, error: null, locked_at: null }).where(and(...conditions)).returning({ id: searchJobs.id });
  return rows.length;
}
