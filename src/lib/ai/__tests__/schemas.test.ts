import { describe, expect, it } from "vitest";
import { extractJsonObject, parseAnalysisOutput } from "../schemas";
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
  it("rejects out-of-range scores and unknown enums", () => {
    expect(parseAnalysisOutput({ ...valid, scores: { ...valid.scores, web_quality_score: 120 } }).ok).toBe(false);
    expect(parseAnalysisOutput({ ...valid, recruiting_status: "maybe" }).ok).toBe(false);
    expect(parseAnalysisOutput({ ...valid, confidence_score: "high" }).ok).toBe(false);
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
