import { describe, expect, it } from "vitest";
import { resolveSalesRestriction } from "../analyze-company";
import type { CompanyAnalysisOutput } from "../schemas";
import type { CompanyPageRow, CompanyRow } from "@/db/types";

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    sales_contact_allowed: "unknown",
    sales_restriction_text: null,
    sales_restriction_source_url: null,
    employee_count: null,
    website_url: "https://example.co.jp",
    ...overrides,
  } as CompanyRow;
}

function page(page_type: string, raw_text = "本文あり"): CompanyPageRow {
  return { url: `https://example.co.jp/${page_type}/`, page_type, raw_text, title: null } as CompanyPageRow;
}

function output(overrides: Partial<CompanyAnalysisOutput["sales_restriction"]> = {}): CompanyAnalysisOutput {
  return { sales_restriction: { detected: false, restriction_text: null, source_url: null, ...overrides } } as CompanyAnalysisOutput;
}

describe("resolveSalesRestriction", () => {
  it("営業拒否が確定済みの企業は再分析でも false のまま（営業可能に戻さない）", () => {
    const r = resolveSalesRestriction(
      company({ sales_contact_allowed: "false", sales_restriction_text: "営業お断り", sales_restriction_source_url: "https://example.co.jp/contact/" }),
      output(),
      [page("contact")],
    );
    expect(r.allowed).toBe("false");
    expect(r.text).toBe("営業お断り");
  });

  it("AI が検出した場合は false", () => {
    const r = resolveSalesRestriction(
      company(),
      output({ detected: true, restriction_text: "営業目的のご連絡はお断りしております", source_url: "https://example.co.jp/contact/" }),
      [page("contact")],
    );
    expect(r.allowed).toBe("false");
    expect(r.sourceUrl).toBe("https://example.co.jp/contact/");
  });

  it("問い合わせページを確認できていれば、表記なしで true", () => {
    const r = resolveSalesRestriction(company(), output(), [page("top"), page("contact")]);
    expect(r.allowed).toBe("true");
    expect(r.text).toBeNull();
  });

  it("問い合わせページをクロールできていない場合は true と断定せず unknown", () => {
    const r = resolveSalesRestriction(company(), output(), [page("top"), page("company"), page("recruit")]);
    expect(r.allowed).toBe("unknown");
  });

  it("問い合わせページが空（JSレンダリング等で本文が取れない）場合も unknown", () => {
    const r = resolveSalesRestriction(company(), output(), [page("top"), page("contact", "")]);
    expect(r.allowed).toBe("unknown");
  });

  it("プライバシーポリシーを確認できていれば判断材料として扱う", () => {
    const r = resolveSalesRestriction(company(), output(), [page("privacy")]);
    expect(r.allowed).toBe("true");
  });

  it("ルール検出のヒットがあり AI が否定した場合は unknown（true に昇格させない）", () => {
    const r = resolveSalesRestriction(company({ sales_restriction_text: "営業時間のご案内" }), output(), [page("contact")]);
    expect(r.allowed).toBe("unknown");
  });
});
