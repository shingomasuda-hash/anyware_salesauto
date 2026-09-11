import type { Db } from "@/db";
import type { AnalysisJobRow } from "@/db/types";
import { getCompanyById, updateCompany } from "@/db/repositories/companies";
import { analyzeCompany } from "@/lib/ai/analyze-company";
import { checkAnalysisAllowed } from "@/lib/ai/gate";
import { Logger } from "@/lib/logging/logger";

export interface AnalysisJobResult {
  analysisId: string | null;
  rank: string | null;
  score: number | null;
  /** 条件・予算により AI を呼ばずに終えた場合の理由 */
  skippedReason?: string;
}

export async function processAnalysisJob(db: Db, job: AnalysisJobRow, logger: Logger): Promise<AnalysisJobResult> {
  const company = await getCompanyById(db, job.company_id);
  if (!company) throw new Error(`企業が見つかりません: ${job.company_id}`);

  // API を叩く直前で条件と予算を確認する（採用ページなし / 当月予算超過なら呼ばない）
  const gate = await checkAnalysisAllowed(db, company);
  if (!gate.allowed) {
    await updateCompany(db, job.company_id, { analysis_status: "not_analyzed" });
    await logger.info("AI分析を見送り", { company: company.company_name, reason: gate.reason });
    return { analysisId: null, rank: null, score: null, skippedReason: gate.reason ?? "条件を満たしません" };
  }

  await updateCompany(db, job.company_id, { analysis_status: "analyzing" });
  const result = await analyzeCompany(db, job.company_id, logger);
  return { analysisId: result.analysis.id, rank: result.analysis.sales_priority_rank, score: result.analysis.sales_priority_score };
}
