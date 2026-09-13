import { describe, expect, it } from "vitest";
import { companyAnalysisOutputSchema, extractJsonObject, normalizeAnalysisOutput, parseAnalysisOutput } from "../schemas";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MockAiProvider } from "../mock";

const valid = {
  company_summary: "要約",
  business_summary: "事業",
  recruiting_status: "active",
  recruiting_summary: null,
  target_candidates: ["中途"],
  new_graduate_hiring: "unknown",
  mid_career_hiring: "yes",
  employee_count_observed: null,
  scores: {
    recruitment_page_quality_score: 40,
    recruitment_issue_score: 80,
    web_quality_score: 45,
    sns_activity_score: 10,
    digital_marketing_score: 20,
    dx_opportunity_score: 60,
    growth_potential_score: 55,
  },
  observed_facts: ["採用ページあり"],
  inferences: ["媒体依存の可能性"],
  detected_issues: ["社員紹介なし"],
  detected_strengths: [],
  recommended_topics: ["採用LP"],
  sales_restriction: { detected: false, restriction_text: null, source_url: null },
  sales_outreach: null,
  evidence: [{ category: "recruiting", source_url: "https://example.jp/recruit/", evidence_text: "中途採用 3職種" }],
  analysis_reason: "理由",
  confidence_score: 70,
};

describe("parseAnalysisOutput", () => {
  it("accepts a valid payload", () => {
    const r = parseAnalysisOutput(valid);
    expect(r.ok).toBe(true);
  });
  it("rejects out-of-range scores", () => {
    // スコアは営業ランクの計算に直結するため、範囲外は受け取らない
    expect(parseAnalysisOutput({ ...valid, scores: { ...valid.scores, web_quality_score: 120 } }).ok).toBe(false);
    expect(parseAnalysisOutput({ ...valid, confidence_score: "high" }).ok).toBe(false);
  });
  it("accepts unknown enum values by falling back", () => {
    // 分類のぶれで分析を丸ごと失うほうが損失が大きい（実データで3社が失敗した）
    const r = parseAnalysisOutput({ ...valid, recruiting_status: "maybe" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.recruiting_status).toBe("unknown");
  });
  it("rejects missing required fields with a readable error", () => {
    const r = parseAnalysisOutput({ company_summary: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("business_summary");
  });
});

describe("extractJsonObject", () => {
  it("parses fenced and prefixed json", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('結果: {"a":{"b":2}} 以上')).toEqual({ a: { b: 2 } });
  });
  it("throws on no json", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("MockAiProvider", () => {
  it("produces schema-valid output", async () => {
    const provider = new MockAiProvider();
    const res = await provider.analyzeCompany({
      contextText: "採用情報 中途採用 正社員 社員インタビュー © 2025",
      mockHints: { companyName: "テスト株式会社", websiteUrl: "https://mock-test.example.jp", pageTypes: ["top", "recruit", "contact"], hasSns: false, hasEmail: true, hasContactForm: true, salesRestrictionText: null, salesRestrictionUrl: null, urls: ["https://mock-test.example.jp", "https://mock-test.example.jp/recruit/"] },
    });
    expect(parseAnalysisOutput(res.output).ok).toBe(true);
    expect(res.output.recruiting_status).toBe("active");
    expect(res.provider).toBe("mock");
  });
});

describe("営業文（sales_outreach）", () => {
  const outreach = {
    subject: "採用ページ改善のご提案",
    body: "ご担当者様\n\n採用ページに募集職種の記載があることを拝見しご連絡しました。",
    personalization: ["採用ページに募集職種の記載あり"],
    hypothesis_note: "課題の想定はサイト記載からの推測です",
  };

  it("自社サービス未設定なら null を許す", () => {
    expect(parseAnalysisOutput({ ...valid, sales_outreach: null }).ok).toBe(true);
  });

  it("営業文つきの出力を受け入れる", () => {
    const parsed = parseAnalysisOutput({ ...valid, sales_outreach: outreach });
    expect(parsed.ok).toBe(true);
  });

  it("件名が長すぎる場合は弾く", () => {
    const parsed = parseAnalysisOutput({ ...valid, sales_outreach: { ...outreach, subject: "あ".repeat(61) } });
    expect(parsed.ok).toBe(false);
  });

  it("本文が長すぎる場合は弾く", () => {
    const parsed = parseAnalysisOutput({ ...valid, sales_outreach: { ...outreach, body: "あ".repeat(701) } });
    expect(parsed.ok).toBe(false);
  });

  it("推測の注記は省略できる", () => {
    expect(parseAnalysisOutput({ ...valid, sales_outreach: { ...outreach, hypothesis_note: null } }).ok).toBe(true);
  });
});

describe("APIに送るJSON Schemaを生成できる", () => {
  // スキーマは Anthropic API へ渡す JSON Schema の生成にも使われる。
  // transform / catch を書くと生成に失敗し、AI分析が全件失敗する（実際に起こした）。
  // 出力のぶれは normalizeAnalysisOutput で整えること。
  it("companyAnalysisOutputSchema を JSON Schema に変換できる", () => {
    expect(() => zodOutputFormat(companyAnalysisOutputSchema)).not.toThrow();
  });
});

describe("AI出力のぶれを受け止める", () => {
  // 厳格に検証して丸ごと失敗させると、その企業の分析がすべて失われ、
  // 再試行の費用も無駄になる。実データで3社が失敗し1社は完全に失われた。
  const parse = (patch: Record<string, unknown>) => parseAnalysisOutput({ ...valid, ...patch });

  it("想定外の enum を既定値に倒す", () => {
    const r = parse({ recruiting_status: "recruiting" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.recruiting_status).toBe("unknown");
  });

  it("従業員数の0を不明として扱う", () => {
    const r = parse({ employee_count_observed: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.employee_count_observed).toBeNull();
  });

  it("本文が空の根拠を取り除く", () => {
    const r = parse({ evidence: [{ category: "company", source_url: "https://x", evidence_text: "" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.evidence).toHaveLength(0);
  });

  it("想定外の根拠カテゴリを other に倒す", () => {
    const r = parse({ evidence: [{ category: "history", source_url: "https://x", evidence_text: "創業60年" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.evidence[0].category).toBe("other");
  });

  it("固有の事実が上限を超えても切り捨てて受け取る", () => {
    const r = parse({
      sales_outreach: {
        subject: "取材のお願い",
        body: "本文",
        personalization: ["事実1", "事実2", "事実3", "事実4"],
        hypothesis_note: null,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.sales_outreach?.personalization).toHaveLength(3);
  });

  it("整えるのは分類と件数だけで、スコアには手を出さない", () => {
    // スコアは営業ランクの計算に直結するため、範囲外は検証で弾く
    const normalized = normalizeAnalysisOutput({ ...valid, scores: { ...valid.scores, web_quality_score: 120 } }) as typeof valid;
    expect(normalized.scores.web_quality_score).toBe(120);
    expect(parse({ scores: { ...valid.scores, web_quality_score: 120 } }).ok).toBe(false);
  });
});

describe("SDKの検証で落ちない緩さを保つ", () => {
  // Anthropic SDK はレスポンスをこのスキーマで検証してから返す。
  // 制約を厳しくすると normalizeAnalysisOutput に届く前に失敗し、分析が丸ごと失われる。
  // 実データで personalization 4件・従業員数0・空の根拠で失敗した。
  const parse = (patch: Record<string, unknown>) => companyAnalysisOutputSchema.safeParse({ ...valid, ...patch });

  it("固有の事実を4件返しても受け取れる", () => {
    expect(
      parse({
        sales_outreach: { subject: "件名", body: "本文", personalization: ["1", "2", "3", "4"], hypothesis_note: null },
      }).success,
    ).toBe(true);
  });

  it("従業員数0を受け取れる", () => {
    expect(parse({ employee_count_observed: 0 }).success).toBe(true);
  });

  it("本文が空の根拠を受け取れる", () => {
    expect(parse({ evidence: [{ category: "company", source_url: "https://x", evidence_text: "" }] }).success).toBe(true);
  });
});
