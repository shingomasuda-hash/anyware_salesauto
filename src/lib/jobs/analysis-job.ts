import type { Db } from "@/db";
import type { AnalysisJobRow } from "@/db/types";
import { updateCompany } from "@/db/repositories/companies";
import { analyzeCompany } from "@/lib/ai/analyze-company";
import { Logger } from "@/lib/logging/logger";

export async function processAnalysisJob(db: Db, job: AnalysisJobRow, logger: Logger): Promise<{ analysisId: string; rank: string | null; score: number | null }> {
  await updateCompany(db, job.company_id, { analysis_status: "analyzing" });
  const result = await analyzeCompany(db, job.company_id, logger);
  return { analysisId: result.analysis.id, rank: result.analysis.sales_priority_rank, score: result.analysis.sales_priority_score };
}
