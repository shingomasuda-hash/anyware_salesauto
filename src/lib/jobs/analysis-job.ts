import type { AdminClient } from "@/lib/supabase/admin";
import type { AnalysisJobRow } from "@/lib/db/types";
import { analyzeCompany } from "@/lib/ai/analyze-company";
import { Logger } from "@/lib/logging/logger";

export async function processAnalysisJob(db: AdminClient, job: AnalysisJobRow, logger: Logger): Promise<{ analysisId: string; rank: string | null; score: number | null }> {
  await db.from("companies").update({ analysis_status: "analyzing" }).eq("id", job.company_id);
  const result = await analyzeCompany(db, job.company_id, logger);
  return { analysisId: result.analysis.id, rank: result.analysis.sales_priority_rank, score: result.analysis.sales_priority_score };
}
