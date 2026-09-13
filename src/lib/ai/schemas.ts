import { z } from "zod";

const score = z.number().int().min(0).max(100);
const nullableScore = score.nullable();

/**
 * このスキーマは **Anthropic API に送る JSON Schema の生成にも使われる**。
 * JSON Schema は変換（transform）や既定値への差し替え（catch）を表現できないため、
 * ここには書けない。書くと API 呼び出し自体が失敗する（実際に全件失敗させた）。
 *
 * 出力のぶれは、検証の前に normalizeAnalysisOutput で整える。
 */

const EVIDENCE_CATEGORIES = ["company", "business", "recruiting", "web", "sns", "digital_marketing", "dx", "sales_restriction", "contact", "other"] as const;

export const evidenceSchema = z.object({
  category: z.enum(EVIDENCE_CATEGORIES),
  source_url: z.string(),
  // 制約は「モデルへの指示」でもある。厳しくすると SDK の検証で落ち、
  // 分析が丸ごと失われる。緩めに受け取り、normalizeAnalysisOutput で整える。
  evidence_text: z.string().max(200),
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
  recruiting_status: z.enum(["active", "inactive", "unknown"]),
  recruiting_summary: z.string().max(300).nullable(),
  target_candidates: z.array(z.string().max(40)).max(5),
  new_graduate_hiring: z.enum(["yes", "no", "unknown"]),
  mid_career_hiring: z.enum(["yes", "no", "unknown"]),
  // 0 を「不明」の意味で返してくることがある（normalize で null にする）
  employee_count_observed: z.number().int().nullable(),
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
      // 実際に使うのは3件。4件以上返して分析ごと失われるより、受け取って切り詰める
      personalization: z.array(z.string().max(120)).max(6),
      /** 推測に基づく部分があれば明示する */
      hypothesis_note: z.string().max(150).nullable(),
    })
    .nullable(),
  evidence: z.array(evidenceSchema).max(8),
  analysis_reason: z.string().max(500),
  confidence_score: score,
});

export type CompanyAnalysisOutput = z.infer<typeof companyAnalysisOutputSchema>;

/** 不正 JSON / スキーマ違反時に安全に検証する */
const RECRUITING_STATUSES = ["active", "inactive", "unknown"] as const;
const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;

function pickEnum<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/**
 * 検証の前に、AI 出力の些細なぶれを整える。
 *
 * Anthropic SDK は**この関数より前に**レスポンスをスキーマで検証する。
 * そのためスキーマ側の制約を厳しくすると、ここに届く前に失敗する。
 * スキーマは緩めに受け取り、絞り込みはここで行う。
 * 厳格に検証して丸ごと失敗させると、その企業の分析がすべて失われ、
 * 再試行の費用も無駄になる。実データでは
 * 「personalization が4件（上限3）」「employee_count_observed が0」
 * 「enum の値が想定外」で分析が失われた。
 *
 * スコアと confidence は営業ランクの計算に直結するため、ここでは触らない。
 * 範囲外なら検証で弾く。
 */
export function normalizeAnalysisOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const o = { ...(raw as Record<string, unknown>) };

  o.recruiting_status = pickEnum(o.recruiting_status, RECRUITING_STATUSES, "unknown");
  o.new_graduate_hiring = pickEnum(o.new_graduate_hiring, YES_NO_UNKNOWN, "unknown");
  o.mid_career_hiring = pickEnum(o.mid_career_hiring, YES_NO_UNKNOWN, "unknown");

  // 0 や負数を「不明」の意味で返してくることがある
  if (typeof o.employee_count_observed === "number" && o.employee_count_observed <= 0) o.employee_count_observed = null;

  if (Array.isArray(o.evidence)) {
    o.evidence = o.evidence
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e): Record<string, unknown> => ({ ...e, category: pickEnum(e.category, EVIDENCE_CATEGORIES, "other") }))
      // 本文が空の根拠は監査の役に立たない
      .filter((e) => typeof e.evidence_text === "string" && e.evidence_text.trim().length > 0)
      .slice(0, 8);
  }

  if (typeof o.sales_outreach === "object" && o.sales_outreach !== null) {
    const outreach = { ...(o.sales_outreach as Record<string, unknown>) };
    if (Array.isArray(outreach.personalization)) outreach.personalization = outreach.personalization.slice(0, 3);
    o.sales_outreach = outreach;
  }

  return o;
}

export function parseAnalysisOutput(raw: unknown): { ok: true; data: CompanyAnalysisOutput } | { ok: false; error: string } {
  const parsed = companyAnalysisOutputSchema.safeParse(normalizeAnalysisOutput(raw));
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
