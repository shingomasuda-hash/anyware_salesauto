import { getEnv } from "@/lib/config/env";
import type { AnalysisJobRow, CrawlJobRow, Json, SearchJobRow } from "@/lib/db/types";
import { Logger, serializeError } from "@/lib/logging/logger";
import { createSupabaseAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { processAnalysisJob } from "./analysis-job";
import { processCrawlJob } from "./crawl-job";
import { processSearchJobStep } from "./search-job";

export interface RunnerStats {
  searchSteps: number;
  crawlJobs: number;
  analysisJobs: number;
  failures: number;
  durationMs: number;
  stoppedReason: "empty" | "deadline";
}

type JobTable = "search_jobs" | "crawl_jobs" | "analysis_jobs";

async function claim<T>(db: AdminClient, table: JobTable): Promise<T | null> {
  const { data, error } = await db.rpc("claim_job", { p_job_table: table, p_stale_minutes: 15 });
  if (error) throw new Error(`ジョブ取得 (${table}) に失敗: ${error.message}`);
  return (data as T | null) ?? null;
}

/**
 * ジョブランナー。maxRuntimeMs の範囲で pending ジョブを順番に処理する。
 * 優先順: 検索ステップ → 分析（クロール済みをすぐ結果に反映） → クロール
 * 複数の呼び出しが同時に走っても claim_job (SKIP LOCKED) により二重処理されない。
 */
export async function processJobs(options: { maxRuntimeMs?: number; db?: AdminClient } = {}): Promise<RunnerStats> {
  const env = getEnv();
  const db = options.db ?? createSupabaseAdminClient();
  const maxRuntime = options.maxRuntimeMs ?? env.JOB_MAX_RUNTIME_MS;
  const started = Date.now();
  const deadline = started + maxRuntime;
  const stats: RunnerStats = { searchSteps: 0, crawlJobs: 0, analysisJobs: 0, failures: 0, durationMs: 0, stoppedReason: "empty" };
  const rootLogger = new Logger(db, { category: "job" });

  while (Date.now() < deadline) {
    const search = await claim<SearchJobRow>(db, "search_jobs");
    if (search) {
      stats.searchSteps++;
      await runSearchStep(db, search, rootLogger, deadline, stats);
      continue;
    }
    const analysis = await claim<AnalysisJobRow>(db, "analysis_jobs");
    if (analysis) {
      stats.analysisJobs++;
      await runAnalysis(db, analysis, rootLogger, stats);
      continue;
    }
    const crawl = await claim<CrawlJobRow>(db, "crawl_jobs");
    if (crawl) {
      stats.crawlJobs++;
      await runCrawl(db, crawl, rootLogger, stats);
      continue;
    }
    break;
  }
  stats.stoppedReason = Date.now() >= deadline ? "deadline" : "empty";
  stats.durationMs = Date.now() - started;
  return stats;
}

async function runSearchStep(db: AdminClient, job: SearchJobRow, root: Logger, deadline: number, stats: RunnerStats) {
  const logger = root.child({ category: "search", jobId: job.id, jobType: "search" });
  try {
    const outcome = await processSearchJobStep(db, job, logger, deadline);
    if (outcome === "completed") {
      await db.from("search_jobs").update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null }).eq("id", job.id);
    } else {
      // 継続: attempts は消費しない
      await db.from("search_jobs").update({ status: "pending", locked_at: null, attempts: Math.max(0, job.attempts - 1) }).eq("id", job.id);
    }
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await db
      .from("search_jobs")
      .update({ status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err), completed_at: failed ? new Date().toISOString() : null })
      .eq("id", job.id);
    await logger.error(failed ? "検索ジョブが失敗（上限到達）" : "検索ジョブでエラー（再試行）", serializeError(err));
  }
}

async function runCrawl(db: AdminClient, job: CrawlJobRow, root: Logger, stats: RunnerStats) {
  const logger = root.child({ category: "crawl", jobId: job.id, jobType: "crawl", companyId: job.company_id });
  try {
    const result = await processCrawlJob(db, job, logger);
    await db
      .from("crawl_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null, result: result as unknown as Json })
      .eq("id", job.id);
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await db.from("crawl_jobs").update({ status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err) }).eq("id", job.id);
    await db.from("companies").update({ crawl_status: failed ? "failed" : "not_crawled" }).eq("id", job.company_id);
    await logger.error(failed ? "クロールが失敗（上限到達）" : "クロールでエラー（再試行）", serializeError(err));
  }
}

async function runAnalysis(db: AdminClient, job: AnalysisJobRow, root: Logger, stats: RunnerStats) {
  const logger = root.child({ category: "analysis", jobId: job.id, jobType: "analysis", companyId: job.company_id });
  try {
    const result = await processAnalysisJob(db, job, logger);
    await db
      .from("analysis_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null, result: result as unknown as Json })
      .eq("id", job.id);
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await db.from("analysis_jobs").update({ status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err) }).eq("id", job.id);
    await db.from("companies").update({ analysis_status: failed ? "failed" : "not_analyzed" }).eq("id", job.company_id);
    await logger.error(failed ? "AI分析が失敗（上限到達）" : "AI分析でエラー（再試行）", serializeError(err));
  }
}

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}
