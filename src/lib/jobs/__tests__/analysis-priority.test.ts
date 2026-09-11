/**
 * AI 分析の順番。
 *
 * 月の AI 予算に上限があるため（AI_MONTHLY_BUDGET_JPY）、
 * 予算を使い切る前に見込みの高い企業から分析されている必要がある。
 * 順番はクロールで機械的に取れた事実だけで決める（AI は使わない）。
 */
import { describe, expect, it } from "vitest";
import { analysisPriority } from "../analysis-priority";

const base = {
  hasRecruitPage: true,
  recruitPageCount: 1,
  contactChannels: 1,
  snsCount: 0,
  pageCount: 6,
  salesRestricted: false,
};

describe("analysisPriority", () => {
  it("営業を断る表記がある企業は最後にする", () => {
    expect(analysisPriority({ ...base, salesRestricted: true })).toBe(0);
  });

  it("連絡手段が多いほど優先される", () => {
    expect(analysisPriority({ ...base, contactChannels: 3 })).toBeGreaterThan(analysisPriority({ ...base, contactChannels: 0 }));
  });

  it("採用ページが充実しているほど優先される", () => {
    expect(analysisPriority({ ...base, recruitPageCount: 3 })).toBeGreaterThan(analysisPriority({ ...base, recruitPageCount: 1 }));
  });

  it("SNS があるほど優先される", () => {
    expect(analysisPriority({ ...base, snsCount: 3 })).toBeGreaterThan(analysisPriority(base));
  });

  it("情報量（ページ数）が多いほど優先される", () => {
    expect(analysisPriority({ ...base, pageCount: 20 })).toBeGreaterThan(analysisPriority({ ...base, pageCount: 2 }));
  });

  it("採用ページが無い企業より、ある企業が優先される", () => {
    expect(analysisPriority(base)).toBeGreaterThan(analysisPriority({ ...base, hasRecruitPage: false }));
  });

  it("常に 0-100 の範囲", () => {
    const max = analysisPriority({ hasRecruitPage: true, recruitPageCount: 99, contactChannels: 99, snsCount: 99, pageCount: 999, salesRestricted: false });
    expect(max).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThan(0);
  });
});
