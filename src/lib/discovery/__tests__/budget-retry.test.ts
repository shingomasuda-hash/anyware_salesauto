import { describe, expect, it, vi } from "vitest";
import { createBudgetTracker, emptyProviderStat, mergeProviderStats } from "../budget";
import { backoffDelay, isRetryableError, ProviderHttpError, withRetry } from "../retry";
import { scaleBudgetForRequest } from "@/lib/config/discovery";
import type { DiscoveryBudget } from "../types";

const budget: DiscoveryBudget = {
  maxProviderRequests: 3,
  maxCandidates: 5,
  maxVerificationRequests: 2,
  maxCrawlPages: 10,
  maxAiCalls: 10,
  maxExecutionMinutes: 60,
};

describe("createBudgetTracker", () => {
  it("Provider リクエスト上限で止まる", () => {
    const t = createBudgetTracker(budget);
    for (let i = 0; i < 3; i++) {
      expect(t.canProviderRequest()).toBe(true);
      t.consumeProviderRequest();
    }
    expect(t.canProviderRequest()).toBe(false);
    expect(t.exhaustedReason()).toContain("Provider リクエスト上限");
  });

  it("候補数の上限で止まる", () => {
    const t = createBudgetTracker(budget);
    t.addCandidates(5);
    expect(t.canAddCandidate()).toBe(false);
    expect(t.exhaustedReason()).toContain("候補数の上限");
  });

  it("検証リクエスト上限で止まる", () => {
    const t = createBudgetTracker(budget);
    t.consumeVerificationRequest();
    t.consumeVerificationRequest();
    expect(t.canVerificationRequest()).toBe(false);
  });

  it("実行時間の上限を超えたら止まる", () => {
    const t = createBudgetTracker({ ...budget, maxExecutionMinutes: 0 }, { startedAt: Date.now() - 1000 });
    expect(t.isTimeExceeded()).toBe(true);
    expect(t.canProviderRequest()).toBe(false);
    expect(t.exhaustedReason()).toContain("実行時間の上限");
  });

  it("消費量を引き継いで再開できる（ステップ実行）", () => {
    const t = createBudgetTracker(budget, { providerRequests: 2 });
    expect(t.canProviderRequest()).toBe(true);
    t.consumeProviderRequest();
    expect(t.canProviderRequest()).toBe(false);
  });
});

describe("scaleBudgetForRequest", () => {
  it("少数件の探索では上限まで使い切らない", () => {
    const big: DiscoveryBudget = { ...budget, maxProviderRequests: 60, maxCandidates: 600, maxVerificationRequests: 300 };
    const scaled = scaleBudgetForRequest(big, 10);
    expect(scaled.maxProviderRequests).toBeLessThan(big.maxProviderRequests);
    expect(scaled.maxCandidates).toBeLessThan(big.maxCandidates);
  });

  it("上限を超えて増やさない", () => {
    const scaled = scaleBudgetForRequest(budget, 500);
    expect(scaled.maxProviderRequests).toBeLessThanOrEqual(budget.maxProviderRequests);
    expect(scaled.maxCandidates).toBeLessThanOrEqual(budget.maxCandidates);
  });
});

describe("mergeProviderStats", () => {
  it("ステップごとの統計を加算する", () => {
    const merged = mergeProviderStats(
      { gbiz: { ...emptyProviderStat(), requestCount: 2, resultCount: 10 } },
      { gbiz: { ...emptyProviderStat(), requestCount: 1, resultCount: 5 }, web_search: { ...emptyProviderStat(), skipped: true, unavailableReason: "キー未設定" } },
    );
    expect(merged.gbiz?.requestCount).toBe(3);
    expect(merged.gbiz?.resultCount).toBe(15);
    expect(merged.web_search?.skipped).toBe(true);
  });
});

describe("isRetryableError", () => {
  it("429 / 5xx / タイムアウトは再試行対象", () => {
    expect(isRetryableError(new ProviderHttpError("rate limit", 429))).toBe(true);
    expect(isRetryableError(new ProviderHttpError("server", 503))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("The operation was aborted due to timeout"))).toBe(true);
  });

  it("400 / 401 / 403 は再試行しない（設定ミスを撃ち続けない）", () => {
    expect(isRetryableError(new ProviderHttpError("bad request", 400))).toBe(false);
    expect(isRetryableError(new ProviderHttpError("unauthorized", 401))).toBe(false);
    expect(isRetryableError(new ProviderHttpError("forbidden", 403))).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("フルジッターで上限を超えない", () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const d = backoffDelay(attempt, 500, 8000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });
});

describe("withRetry", () => {
  it("一時的失敗のあと成功する", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new ProviderHttpError("rate limit", 429);
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("再試行対象でないエラーは即座に投げ直す", async () => {
    const fn = vi.fn(async () => {
      throw new ProviderHttpError("bad key", 401);
    });
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow("bad key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("maxAttempts で必ず打ち切る（無限リトライしない）", async () => {
    const fn = vi.fn(async () => {
      throw new ProviderHttpError("server", 500);
    });
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
