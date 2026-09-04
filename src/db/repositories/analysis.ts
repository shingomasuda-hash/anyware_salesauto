import { desc, eq } from "drizzle-orm";
import type { Db } from "../index";
import { companyAnalysis, companyAnalysisEvidence } from "../schema";
import type { CompanyAnalysisEvidenceInsert, CompanyAnalysisEvidenceRow, CompanyAnalysisInsert, CompanyAnalysisRow } from "../types";

export async function insertAnalysis(db: Db, values: CompanyAnalysisInsert): Promise<CompanyAnalysisRow> {
  const rows = await db.insert(companyAnalysis).values(values).returning();
  return rows[0];
}

export async function getAnalysisById(db: Db, id: string): Promise<CompanyAnalysisRow | null> {
  const rows = await db.select().from(companyAnalysis).where(eq(companyAnalysis.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertEvidence(db: Db, rows: CompanyAnalysisEvidenceInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(companyAnalysisEvidence).values(rows);
}

export async function listEvidence(db: Db, analysisId: string): Promise<CompanyAnalysisEvidenceRow[]> {
  return db.select().from(companyAnalysisEvidence).where(eq(companyAnalysisEvidence.analysis_id, analysisId)).orderBy(companyAnalysisEvidence.category);
}

export async function listAnalysisHistory(db: Db, companyId: string, limit = 10) {
  return db
    .select({
      id: companyAnalysis.id,
      analyzed_at: companyAnalysis.analyzed_at,
      sales_priority_rank: companyAnalysis.sales_priority_rank,
      sales_priority_score: companyAnalysis.sales_priority_score,
      model: companyAnalysis.model,
    })
    .from(companyAnalysis)
    .where(eq(companyAnalysis.company_id, companyId))
    .orderBy(desc(companyAnalysis.analyzed_at))
    .limit(limit);
}
