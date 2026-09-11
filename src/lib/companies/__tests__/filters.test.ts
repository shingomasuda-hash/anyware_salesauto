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

describe("採用状況による絞り込み", () => {
  // 営業ターゲットは「採用で困っていそう / 力を入れていそう /
  // 採用はしているが公式サイトに採用ページが無い」企業。
  // 採用ページの有無では絞らない（採用ページなしは主要ターゲットのひとつ）。
  it("既定で採用の痕跡なし（no_signal）だけを除く", () => {
    expect(columnsIn(buildCompanyWhere(filters()))).toContain("recruit_target");
  });

  it("採用ページの有無では絞らない", () => {
    expect(columnsIn(buildCompanyWhere(filters()))).not.toContain("has_recruit_page");
  });

  it("区分を指定するとその区分だけになる", () => {
    expect(columnsIn(buildCompanyWhere(filters({ recruitTarget: "no_recruit_page" })))).toContain("recruit_target");
  });

  it("「採用の痕跡なしも表示」を選ぶと条件が外れる", () => {
    const cols = columnsIn(buildCompanyWhere(filters({ includeNoRecruitSignal: "1", includeLowConfidence: "1", includeRestricted: "1", includeUnverifiedSite: "1" })));
    expect(cols).not.toContain("recruit_target");
  });

  it("URL クエリを往復しても保持される", () => {
    const parsed = parseCompanyFilters({ recruitTarget: "weak_recruit_page" });
    expect(parsed.recruitTarget).toBe("weak_recruit_page");
    expect(filtersToSearchParams(parsed).get("recruitTarget")).toBe("weak_recruit_page");
  });
});

describe("営業できない企業を出さない", () => {
  it("既定で営業不可を除外する", () => {
    expect(columnsIn(buildCompanyWhere(filters()))).toContain("sales_contact_allowed");
  });

  it("「営業不可も表示」を選んだときだけ出す", () => {
    const cols = columnsIn(buildCompanyWhere(filters({ includeRestricted: "1", includeNoRecruitSignal: "1", includeLowConfidence: "1", includeUnverifiedSite: "1" })));
    expect(cols).not.toContain("sales_contact_allowed");
  });
});

describe("公式サイトを確認できた企業だけを出す", () => {
  // 企業名のリンク先が公式サイトでない、という事故を防ぐ
  it("既定で website_url と確認状態の条件が入る", () => {
    const cols = columnsIn(buildCompanyWhere(filters()));
    expect(cols).toContain("website_url");
    expect(cols).toContain("verification_status");
  });

  it("「公式HP未確認も表示」を選んだときだけ外れる", () => {
    const cols = columnsIn(buildCompanyWhere(filters({ includeUnverifiedSite: "1", includeNoRecruitSignal: "1", includeLowConfidence: "1", includeRestricted: "1" })));
    expect(cols).not.toContain("verification_status");
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

  it("既定の除外をすべて外すと条件が無くなる（全件表示）", () => {
    expect(
      buildCompanyWhere(filters({ includeNoRecruitSignal: "1", includeLowConfidence: "1", includeRestricted: "1", includeUnverifiedSite: "1" })),
    ).toBeUndefined();
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
