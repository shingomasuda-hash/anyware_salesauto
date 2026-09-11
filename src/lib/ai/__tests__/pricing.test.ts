/**
 * AI 費用の計算と予算判定。
 * 月3,000社を1万円以内に収める運用のため、費用の見積もりは推測ではなく
 * 記録済みトークン数からの計算であることを固定する。
 */
import { describe, expect, it } from "vitest";
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, MODEL_RATES, currentMonthStart, usdFor } from "../pricing";

describe("usdFor", () => {
  it("公開単価どおりに計算する", () => {
    // 実測値（50社ラン時点の全期間）と突き合わせた計算式
    const cost = usdFor("claude-opus-5", {
      inputTokens: 457_379,
      outputTokens: 74_865,
      cacheReadTokens: 90_012,
      cacheCreationTokens: 10_386,
    });
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(4.27, 2);
  });

  it("キャッシュは読み込み0.1倍・書き込み1.25倍で計算する", () => {
    const rate = MODEL_RATES["claude-opus-5"];
    const read = usdFor("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 });
    const write = usdFor("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1_000_000 });
    expect(read).toBeCloseTo(rate.input * CACHE_READ_MULTIPLIER, 6);
    expect(write).toBeCloseTo(rate.input * CACHE_WRITE_MULTIPLIER, 6);
  });

  it("単価が未登録のモデルは 0 ではなく null を返す（費用を過小評価しない）", () => {
    expect(usdFor("some-unknown-model", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBeNull();
  });

  it("Haiku 4.5 は Opus 5 の 5分の1", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
    expect(usdFor("claude-haiku-4-5", usage)! * 5).toBeCloseTo(usdFor("claude-opus-5", usage)!, 6);
  });
});

describe("currentMonthStart", () => {
  it("当月1日の 00:00 を返す", () => {
    expect(currentMonthStart(new Date("2026-09-11T07:36:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("月初でも当月の1日を返す", () => {
    expect(currentMonthStart(new Date("2026-09-01T00:00:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
