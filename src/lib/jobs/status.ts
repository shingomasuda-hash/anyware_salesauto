import type { Db } from "@/db";
import type { SearchJobRow } from "@/db/types";
import { countNeedsReviewForSearchJob, getSearchJob, listJobStatusesForSearchJob } from "@/db/repositories/jobs";

export interface SearchJobProgress {
  job: SearchJobRow;
  crawl: { total: number; completed: number; failed: number; pending: number };
  analysis: { total: number; completed: number; failed: number; pending: number };
  needsReview: number;
  isFinished: boolean;
}

/** 検索ジョブの進捗（登録 / クロール / 分析 の各段階） */
export async function getSearchJobProgress(db: Db, jobId: string): Promise<SearchJobProgress | null> {
  const job = await getSearchJob(db, jobId);
  if (!job) return null;

  const [crawlRows, analysisRows, needsReview] = await Promise.all([
    listJobStatusesForSearchJob(db, "crawl", jobId),
    listJobStatusesForSearchJob(db, "analysis", jobId),
    countNeedsReviewForSearchJob(db, jobId),
  ]);

  const count = (list: { status: string }[]) => ({
    total: list.length,
    completed: list.filter((r) => r.status === "completed").length,
    failed: list.filter((r) => r.status === "failed").length,
    pending: list.filter((r) => ["pending", "retrying", "processing"].includes(r.status)).length,
  });
  const crawl = count(crawlRows);
  const analysis = count(analysisRows);
  const isFinished = ["completed", "failed", "cancelled"].includes(job.status) && crawl.pending === 0 && analysis.pending === 0;
  return { job, crawl, analysis, needsReview, isFinished };
}
