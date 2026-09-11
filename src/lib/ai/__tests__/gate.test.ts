/**
 * AI 分析を実行するかの門番。
 *
 * 判断材料は「採用の痕跡があるか」であって、採用ページの有無ではない。
 * 公式サイトに採用ページが無い企業（求人媒体だけ使っている等）も営業ターゲットなので、
 * ここで落としてはいけない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldEnqueueAnalysis } from "../gate";

const mocks = vi.hoisted(() => ({ requireRecruitSignal: true }));
vi.mock("@/lib/config/ai", () => ({
  getAiConfig: () => ({ requireRecruitSignal: mocks.requireRecruitSignal }),
}));

afterEach(() => {
  mocks.requireRecruitSignal = true;
});

describe("shouldEnqueueAnalysis", () => {
  it("採用に注力している企業は分析する", () => {
    expect(shouldEnqueueAnalysis("active_recruit").ok).toBe(true);
  });

  it("採用ページが手薄な企業は分析する（困っていそうなターゲット）", () => {
    expect(shouldEnqueueAnalysis("weak_recruit_page").ok).toBe(true);
  });

  it("採用ページが無くても採用の痕跡があれば分析する（主要ターゲット）", () => {
    expect(shouldEnqueueAnalysis("no_recruit_page").ok).toBe(true);
  });

  it("採用の痕跡が無ければ分析しない（AIを呼ばない）", () => {
    const result = shouldEnqueueAnalysis("no_signal");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("採用・求人の記載が見つからない");
  });

  it("設定を外せば痕跡が無くても分析する", () => {
    mocks.requireRecruitSignal = false;
    expect(shouldEnqueueAnalysis("no_signal").ok).toBe(true);
  });
});
