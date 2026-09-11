/**
 * 営業リストの絞り込み条件。
 * 「採用ページあり」は AI の判定ではなくクロールで確認した事実（has_recruit_page）を使う。
 */
import { describe, expect, it } from "vitest";
import { MIN_ANALYSIS_CONFIDENCE } from "../constants";
import { buildCompanyWhere, companyFilterSchema, filtersToSearchParams, parseCompanyFilters } from "../filters";

function filters(partial: Record<string, unknown> = {}) {
  return companyFilterSchema.parse(partial);
}

/** WHERE 句に含まれる列名を集める（どの条件が効いたかを確認する） */
function columnsIn(where: ReturnType<typeof buildCompanyWhere>): string[] {
  const found: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 30) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as { queryChunks?: unknown; name?: unknown };
    if (typeof obj.name === "string") found.push(obj.name);
    if (obj.queryChunks) walk(obj.queryChunks, depth + 1);
  };
  walk(where?.queryChunks ?? [], 0);
  return found;
}

describe("採用ページのある企業のみ", () => {
  it("既定で has_recruit_page 条件が入る（指定なしでも絞り込む）", () => {
    expect(columnsIn(buildCompanyWhere(filters()))).toContain("has_recruit_page");
  });

  it("「採用ページなしも表示」を選んだときだけ条件が外れる", () => {
    // 確度の条件は既定で常に入るため、採用ページの条件だけが消えることを見る
    expect(columnsIn(buildCompanyWhere(filters({ includeNoRecruitPage: "1" })))).not.toContain("has_recruit_page");
  });

  it("AI判定の recruiting とは別条件", () => {
    const both = columnsIn(buildCompanyWhere(filters({ recruiting: "1" })));
    expect(both).toContain("has_recruit_page");
    expect(both).toContain("recruiting_status");
  });

  it("URL クエリを往復しても保持される", () => {
    const on = parseCompanyFilters({ includeNoRecruitPage: "1" });
    expect(on.includeNoRecruitPage).toBe(true);
    expect(filtersToSearchParams(on).get("includeNoRecruitPage")).toBe("1");

    const off = parseCompanyFilters({});
    expect(off.includeNoRecruitPage).toBe(false);
    expect(filtersToSearchParams(off).get("includeNoRecruitPage")).toBeNull();
  });
});

describe("営業可のみ", () => {
  it("unknown（未確認）も除外する", () => {
    // 営業拒否表記を確認できていない企業を営業可能として扱わない
    expect(columnsIn(buildCompanyWhere(filters({ excludeRestricted: "1" })))).toContain("sales_contact_allowed");
  });
});

describe("確度が低い企業を営業リストに出さない", () => {
  // AI が「判断材料が足りない」と判定した企業はリストに載せても判断に使えない。
  // 一方、まだ分析していない企業（AI予算の上限に達した分）は機械抽出の情報で
  // 絞り込めるため、除外してはいけない。
  it("既定で確度とランクの条件が入る", () => {
    const cols = columnsIn(buildCompanyWhere(filters()));
    expect(cols).toContain("confidence_score");
    expect(cols).toContain("sales_priority_rank");
  });

  it("未分析の企業を残すため analysis_id も条件に入る", () => {
    expect(columnsIn(buildCompanyWhere(filters()))).toContain("analysis_id");
  });

  it("「確度が低い企業も表示」を選ぶと条件が外れる", () => {
    const cols = columnsIn(buildCompanyWhere(filters({ includeLowConfidence: "1" })));
    expect(cols).not.toContain("confidence_score");
  });

  it("両方を外すと条件が無くなる（全件表示）", () => {
    expect(buildCompanyWhere(filters({ includeNoRecruitPage: "1", includeLowConfidence: "1" }))).toBeUndefined();
  });

  it("URL クエリを往復しても保持される", () => {
    const on = parseCompanyFilters({ includeLowConfidence: "1" });
    expect(on.includeLowConfidence).toBe(true);
    expect(filtersToSearchParams(on).get("includeLowConfidence")).toBe("1");
    expect(parseCompanyFilters({}).includeLowConfidence).toBe(false);
  });

  it("下限は 0-100 の範囲にある", () => {
    expect(MIN_ANALYSIS_CONFIDENCE).toBeGreaterThan(0);
    expect(MIN_ANALYSIS_CONFIDENCE).toBeLessThan(100);
  });
});
