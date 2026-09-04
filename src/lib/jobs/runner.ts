import { getEnv } from "@/lib/config/env";
import { getDb, type Db } from "@/db";
import type { AnalysisJobRow, CrawlJobRow, SearchJobRow } from "@/db/types";
import { claimJob, updateJob, updateSearchJob } from "@/db/repositories/jobs";
import { updateCompany } from "@/db/repositories/companies";
import { Logger, serializeError } from "@/lib/logging/logger";
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

/**
 * ジョブランナー。maxRuntimeMs の範囲で pending ジョブを順番に処理する。
 * 優先順: 検索ステップ → 分析（クロール済みをすぐ結果に反映） → クロール
 * 複数の呼び出しが同時に走っても claim_job (FOR UPDATE SKIP LOCKED) により二重処理されない。
 */
export async function processJobs(options: { maxRuntimeMs?: number; db?: Db } = {}): Promise<RunnerStats> {
  const env = getEnv();
  const db = options.db ?? getDb();
  const maxRuntime = options.maxRuntimeMs ?? env.JOB_MAX_RUNTIME_MS;
  const started = Date.now();
  const deadline = started + maxRuntime;
  const stats: RunnerStats = { searchSteps: 0, crawlJobs: 0, analysisJobs: 0, failures: 0, durationMs: 0, stoppedReason: "empty" };
  const rootLogger = new Logger(db, { category: "job" });

  while (Date.now() < deadline) {
    const search = await claimJob<SearchJobRow>(db, "search_jobs");
    if (search) {
      stats.searchSteps++;
      await runSearchStep(db, search, rootLogger, deadline, stats);
      continue;
    }
    const analysis = await claimJob<AnalysisJobRow>(db, "analysis_jobs");
    if (analysis) {
      stats.analysisJobs++;
      await runAnalysis(db, analysis, rootLogger, stats);
      continue;
    }
    const crawl = await claimJob<CrawlJobRow>(db, "crawl_jobs");
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

async function runSearchStep(db: Db, job: SearchJobRow, root: Logger, deadline: number, stats: RunnerStats) {
  const logger = root.child({ category: "search", jobId: job.id, jobType: "search" });
  try {
    const outcome = await processSearchJobStep(db, job, logger, deadline);
    if (outcome === "completed") {
      await updateSearchJob(db, job.id, { status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null });
    } else {
      // 継続: attempts は消費しない
      await updateSearchJob(db, job.id, { status: "pending", locked_at: null, attempts: Math.max(0, job.attempts - 1) });
    }
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await updateSearchJob(db, job.id, { status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err), completed_at: failed ? new Date().toISOString() : null });
    await logger.error(failed ? "検索ジョブが失敗（上限到達）" : "検索ジョブでエラー（再試行）", serializeError(err));
  }
}

async function runCrawl(db: Db, job: CrawlJobRow, root: Logger, stats: RunnerStats) {
  const logger = root.child({ category: "crawl", jobId: job.id, jobType: "crawl", companyId: job.company_id });
  try {
    const result = await processCrawlJob(db, job, logger);
    await updateJob(db, "crawl", job.id, { status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null, result });
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await updateJob(db, "crawl", job.id, { status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err) });
    await updateCompany(db, job.company_id, { crawl_status: failed ? "failed" : "not_crawled" });
    await logger.error(failed ? "クロールが失敗（上限到達）" : "クロールでエラー（再試行）", serializeError(err));
  }
}

async function runAnalysis(db: Db, job: AnalysisJobRow, root: Logger, stats: RunnerStats) {
  const logger = root.child({ category: "analysis", jobId: job.id, jobType: "analysis", companyId: job.company_id });
  try {
    const result = await processAnalysisJob(db, job, logger);
    await updateJob(db, "analysis", job.id, { status: "completed", completed_at: new Date().toISOString(), locked_at: null, error: null, result });
  } catch (err) {
    stats.failures++;
    const failed = job.attempts >= job.max_attempts;
    await updateJob(db, "analysis", job.id, { status: failed ? "failed" : "retrying", locked_at: null, error: errMessage(err) });
    await updateCompany(db, job.company_id, { analysis_status: failed ? "failed" : "not_analyzed" });
    await logger.error(failed ? "AI分析が失敗（上限到達）" : "AI分析でエラー（再試行）", serializeError(err));
  }
}

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}
