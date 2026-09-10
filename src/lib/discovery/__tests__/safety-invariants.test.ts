/**
 * 安全設計の不変条件を固定する。
 *
 * 1) Web検索単独の低確度候補を自動で企業登録しない
 * 2) 営業拒否が unknown（未確認）の企業を営業可能として扱わない
 */
import { describe, expect, it } from "vitest";
import { getDiscoveryConfig } from "@/lib/config/discovery";
import { verifyCandidate } from "../verifier";
import { toMerged } from "../deduplicator";
import { toCandidate } from "../normalizer";
import { buildCompanyWhere, parseCompanyFilters } from "@/lib/companies/filters";
import { resolveSalesRestriction } from "@/lib/ai/analyze-company";
import type { CompanyAnalysisOutput } from "@/lib/ai/schemas";
import type { CompanyPageRow, CompanyRow } from "@/db/types";
import type { MergedCandidate } from "../types";

/** Drizzle の SQL オブジェクトは循環参照を持つため、文字列片だけを安全に集める */
function describeSql(node: unknown): string {
  const out: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (n: unknown) => {
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    if (typeof n === "boolean" || typeof n === "number") {
      out.push(String(n));
      return;
    }
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const o = n as Record<string, unknown>;
    for (const key of ["queryChunks", "value", "name", "chunk", "left", "right", "operator"]) {
      if (key in o) walk(o[key]);
    }
  };
  walk(node);
  return out.join(" | ");
}

function webSearchOnly(overrides: Partial<MergedCandidate> = {}): MergedCandidate {
  const base = toMerged(
    toCandidate({
      name: "株式会社山田製作所",
      website: "https://yamada-ss.co.jp",
      source: "web_search",
      sourceConfidence: 30,
    }),
  );
  return { ...base, sources: ["web_search"], ...overrides };
}

describe("Web検索単独候補は自動登録しない", () => {
  const { thresholds } = getDiscoveryConfig();

  it("公式サイトに社名があっても、単独では verified に届かない", () => {
    const r = verifyCandidate(webSearchOnly(), {
      websiteText: "株式会社山田製作所 会社概要",
      websiteTitle: "株式会社山田製作所",
      officialSiteConfidence: 100,
    });
    // 社名一致20 + ドメイン確認10 = 30 < verified しきい値
    expect(r.score).toBeLessThan(thresholds.verified);
    expect(r.status).not.toBe("verified");
  });

  it("法人番号が無い限り verified にならない（配点上、到達不能）", () => {
    const { weights } = getDiscoveryConfig();
    // 法人番号・公的情報源を除いた満点
    const maxWithoutOfficial =
      weights.websiteNameMatch + weights.addressMatch + weights.phoneMatch + weights.domainMatch + weights.multiSource;
    expect(maxWithoutOfficial).toBeLessThan(thresholds.verified);
  });

  it("裏付けが全く無い候補は rejected（要確認にも回さない）", () => {
    const r = verifyCandidate(webSearchOnly(), {});
    expect(r.status).toBe("rejected");
    expect(r.score).toBeLessThan(thresholds.needsReview);
  });
});

describe("営業拒否が unknown の企業を営業可能として扱わない", () => {
  it("営業対象の絞り込みは sales_contact_allowed='true' のみを通す", () => {
    const parts = describeSql(buildCompanyWhere(parseCompanyFilters({ excludeRestricted: "on" })));
    expect(parts).toContain("sales_contact_allowed");
    // 'true' に限定していること。'false' を除くだけの条件（<>）では unknown が通ってしまう
    expect(parts).toContain("true");
    expect(parts).not.toContain("<>");
  });

  it("絞り込みを使わない場合は unknown も一覧に出る（存在は隠さない）", () => {
    expect(describeSql(buildCompanyWhere(parseCompanyFilters({})))).not.toContain("sales_contact_allowed");
  });

  it("問い合わせ系ページを確認できていなければ unknown（true と断定しない）", () => {
    const company = { sales_contact_allowed: "unknown", sales_restriction_text: null, sales_restriction_source_url: null } as CompanyRow;
    const out = { sales_restriction: { detected: false, restriction_text: null, source_url: null } } as CompanyAnalysisOutput;
    const pagesWithoutContact = [{ page_type: "top", raw_text: "会社概要" }] as CompanyPageRow[];
    expect(resolveSalesRestriction(company, out, pagesWithoutContact).allowed).toBe("unknown");
  });

  it("一度 false になった企業は再分析でも false のまま", () => {
    const company = { sales_contact_allowed: "false", sales_restriction_text: "営業お断り", sales_restriction_source_url: "https://x/contact" } as CompanyRow;
    const out = { sales_restriction: { detected: false, restriction_text: null, source_url: null } } as CompanyAnalysisOutput;
    const pages = [{ page_type: "contact", raw_text: "お問い合わせ" }] as CompanyPageRow[];
    expect(resolveSalesRestriction(company, out, pages).allowed).toBe("false");
  });
});
