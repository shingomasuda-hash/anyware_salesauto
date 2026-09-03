import { z } from "zod";

const score = z.number().int().min(0).max(100);
const nullableScore = score.nullable();

export const evidenceSchema = z.object({
  category: z.enum(["company", "business", "recruiting", "web", "sns", "digital_marketing", "dx", "sales_restriction", "contact", "other"]),
  source_url: z.string(),
  evidence_text: z.string().min(1).max(500),
});

/**
 * Claude から返させる企業分析の構造化スキーマ。
 * 「確認できた事実」と「推測」を分離し、不明は null / unknown を使わせる。
 */
export const companyAnalysisOutputSchema = z.object({
  company_summary: z.string().max(600),
  business_summary: z.string().max(800),
  recruiting_status: z.enum(["active", "inactive", "unknown"]),
  recruiting_summary: z.string().max(600).nullable(),
  target_candidates: z.array(z.string().max(60)).max(10),
  new_graduate_hiring: z.enum(["yes", "no", "unknown"]),
  mid_career_hiring: z.enum(["yes", "no", "unknown"]),
  employee_count_observed: z.number().int().positive().nullable(),
  scores: z.object({
    recruitment_page_quality_score: nullableScore,
    recruitment_issue_score: nullableScore,
    web_quality_score: nullableScore,
    sns_activity_score: nullableScore,
    digital_marketing_score: nullableScore,
    dx_opportunity_score: nullableScore,
    growth_potential_score: nullableScore,
  }),
  observed_facts: z.array(z.string().max(200)).max(25),
  inferences: z.array(z.string().max(200)).max(15),
  detected_issues: z.array(z.string().max(200)).max(15),
  detected_strengths: z.array(z.string().max(200)).max(15),
  recommended_topics: z.array(z.string().max(120)).max(10),
  sales_restriction: z.object({
    detected: z.boolean(),
    restriction_text: z.string().max(400).nullable(),
    source_url: z.string().nullable(),
  }),
  evidence: z.array(evidenceSchema).max(30),
  analysis_reason: z.string().max(1500),
  confidence_score: score,
});

export type CompanyAnalysisOutput = z.infer<typeof companyAnalysisOutputSchema>;

/** 不正 JSON / スキーマ違反時に安全に検証する */
export function parseAnalysisOutput(raw: unknown): { ok: true; data: CompanyAnalysisOutput } | { ok: false; error: string } {
  const parsed = companyAnalysisOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("JSON オブジェクトが見つかりません");
  }
}
