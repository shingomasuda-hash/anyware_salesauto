import { z } from "zod";

const score = z.number().int().min(0).max(100);
const nullableScore = score.nullable();

/**
 * AI の出力は細部がぶれる。厳格に検証して丸ごと失敗させると、
 * その企業の分析がすべて失われ、再試行の費用も無駄になる。
 * 実データでは「personalization が4件（上限3）」「employee_count_observed が0」
 * 「enum の値が想定外」で3社が失敗し、うち1社は再試行の上限まで使い切った。
 *
 * 安全に関わる判断（営業拒否・事実と推測の分離）は厳格なままにし、
 * 分類や件数のような些細なぶれは受け取り側で整える。
 */

/** 想定外の値を既定値に倒す enum */
function lenientEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.enum(values).catch(fallback as T[number]);
}

export const evidenceSchema = z.object({
  category: lenientEnum(
    ["company", "business", "recruiting", "web", "sns", "digital_marketing", "dx", "sales_restriction", "contact", "other"],
    "other",
  ),
  source_url: z.string().catch(""),
  evidence_text: z.string().max(200).catch(""),
});

/**
 * Claude から返させる企業分析の構造化スキーマ。
 * 「確認できた事実」と「推測」を分離し、不明は null / unknown を使わせる。
 *
 * 出力トークンは費用の約4割を占めるため、配列の上限件数と文字数は
 * 「営業判断に必要な最小限」に抑えている。安全に関わる sales_restriction と
 * 事実／推測の分離（observed_facts / inferences）は件数を絞っても必ず残す。
 */
export const companyAnalysisOutputSchema = z.object({
  company_summary: z.string().max(300),
  business_summary: z.string().max(300),
  recruiting_status: lenientEnum(["active", "inactive", "unknown"], "unknown"),
  recruiting_summary: z.string().max(300).nullable(),
  target_candidates: z.array(z.string().max(40)).max(5),
  new_graduate_hiring: lenientEnum(["yes", "no", "unknown"], "unknown"),
  mid_career_hiring: lenientEnum(["yes", "no", "unknown"], "unknown"),
  // 0 を「不明」の意味で返してくることがあるため、null に倒す
  employee_count_observed: z.number().int().nullable().transform((v) => (v !== null && v > 0 ? v : null)),
  scores: z.object({
    recruitment_page_quality_score: nullableScore,
    recruitment_issue_score: nullableScore,
    web_quality_score: nullableScore,
    sns_activity_score: nullableScore,
    digital_marketing_score: nullableScore,
    dx_opportunity_score: nullableScore,
    growth_potential_score: nullableScore,
  }),
  observed_facts: z.array(z.string().max(120)).max(8),
  inferences: z.array(z.string().max(120)).max(5),
  detected_issues: z.array(z.string().max(120)).max(5),
  detected_strengths: z.array(z.string().max(120)).max(5),
  recommended_topics: z.array(z.string().max(80)).max(5),
  sales_restriction: z.object({
    detected: z.boolean(),
    restriction_text: z.string().max(200).nullable(),
    source_url: z.string().nullable(),
  }),
  /**
   * 企業ごとに変える営業文の下書き。
   * 自社サービスの定義が与えられていない場合は null を返させる
   * （当たり障りのない一般的な文面を作らせない）。
   */
  sales_outreach: z
    .object({
      subject: z.string().max(60),
      body: z.string().max(700),
      /** 文面で触れたその企業固有の事実（observed_facts から。監査用） */
      // 件数が多い分には害がないので、超過分は切り捨てて受け取る
      personalization: z.array(z.string().max(120)).transform((v) => v.slice(0, 3)),
      /** 推測に基づく部分があれば明示する */
      hypothesis_note: z.string().max(150).nullable(),
    })
    .nullable(),
  // 本文が空の根拠は監査の役に立たないので除き、件数の超過は切り捨てる
  evidence: z.array(evidenceSchema).transform((v) => v.filter((e) => e.evidence_text.trim().length > 0).slice(0, 8)),
  analysis_reason: z.string().max(500),
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
