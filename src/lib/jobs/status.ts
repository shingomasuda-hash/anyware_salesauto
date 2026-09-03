import type { AdminClient } from "@/lib/supabase/admin";
import type { SearchJobRow } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export interface SearchJobProgress {
  job: SearchJobRow;
  crawl: { total: number; completed: number; failed: number; pending: number };
  analysis: { total: number; completed: number; failed: number; pending: number };
  needsReview: number;
  isFinished: boolean;
}

type AnyClient = AdminClient | SupabaseClient<Database>;

/** 検索ジョブの進捗（登録 / クロール / 分析 の各段階） */
export async function getSearchJobProgress(db: AnyClient, jobId: string): Promise<SearchJobProgress | null> {
  const { data: job } = await db.from("search_jobs").select("*").eq("id", jobId).single();
  if (!job) return null;

  const [crawlRes, analysisRes, reviewRes] = await Promise.all([
    db.from("crawl_jobs").select("status, result").eq("search_job_id", jobId),
    db.from("analysis_jobs").select("status").eq("search_job_id", jobId),
    db.from("search_job_items").select("company_id, companies!inner(verification_status)").eq("search_job_id", jobId).eq("companies.verification_status", "needs_review"),
  ]);

  const count = (rows: { status: string }[] | null) => {
    const list = rows ?? [];
    return {
      total: list.length,
      completed: list.filter((r) => r.status === "completed").length,
      failed: list.filter((r) => r.status === "failed").length,
      pending: list.filter((r) => ["pending", "retrying", "processing"].includes(r.status)).length,
    };
  };
  const crawl = count(crawlRes.data);
  const analysis = count(analysisRes.data);
  const isFinished = ["completed", "failed", "cancelled"].includes(job.status) && crawl.pending === 0 && analysis.pending === 0;
  return { job, crawl, analysis, needsReview: reviewRes.data?.length ?? 0, isFinished };
}
