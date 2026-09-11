/**
 * AI 分析を実行するかの門番。
 * 「採用ページのある企業だけ」を営業リストの条件とすると同時に、
 * AI を呼ぶ企業数が費用をほぼ決めるため、この判定を固定する。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldEnqueueAnalysis } from "../gate";

const mocks = vi.hoisted(() => ({ requireRecruitPage: true }));
vi.mock("@/lib/config/ai", () => ({
  getAiConfig: () => ({ requireRecruitPage: mocks.requireRecruitPage }),
}));

afterEach(() => {
  mocks.requireRecruitPage = true;
});

describe("shouldEnqueueAnalysis", () => {
  it("採用ページがあれば分析ジョブを投入する", () => {
    expect(shouldEnqueueAnalysis("https://example.co.jp/recruit").ok).toBe(true);
  });

  it("採用ページが無ければ投入しない（AIを呼ばない）", () => {
    const result = shouldEnqueueAnalysis(null);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("採用ページ");
  });

  it("設定を外せば採用ページが無くても投入する", () => {
    mocks.requireRecruitPage = false;
    expect(shouldEnqueueAnalysis(null).ok).toBe(true);
  });
});
