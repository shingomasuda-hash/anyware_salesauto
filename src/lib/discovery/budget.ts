import type { BudgetTracker, BudgetUsage, DiscoveryBudget, ProviderStat, ProviderStats, DiscoveryProviderName } from "./types";

/** 予算の消費を追跡する。API 料金事故を防ぐため、超過したら Provider 呼び出しを止める */
export function createBudgetTracker(budget: DiscoveryBudget, initial?: Partial<BudgetUsage>): BudgetTracker {
  const usage: BudgetUsage = {
    providerRequests: initial?.providerRequests ?? 0,
    candidates: initial?.candidates ?? 0,
    verificationRequests: initial?.verificationRequests ?? 0,
    startedAt: initial?.startedAt ?? Date.now(),
  };

  const isTimeExceeded = () => Date.now() - usage.startedAt > budget.maxExecutionMinutes * 60_000;

  return {
    budget,
    usage,
    canProviderRequest: () => usage.providerRequests < budget.maxProviderRequests && !isTimeExceeded(),
    canVerificationRequest: () => usage.verificationRequests < budget.maxVerificationRequests && !isTimeExceeded(),
    canAddCandidate: () => usage.candidates < budget.maxCandidates,
    isTimeExceeded,
    consumeProviderRequest: () => {
      usage.providerRequests += 1;
    },
    consumeVerificationRequest: () => {
      usage.verificationRequests += 1;
    },
    addCandidates: (n: number) => {
      usage.candidates += n;
    },
    exhaustedReason: () => {
      if (isTimeExceeded()) return `実行時間の上限（${budget.maxExecutionMinutes}分）に達しました`;
      if (usage.providerRequests >= budget.maxProviderRequests) return `Provider リクエスト上限（${budget.maxProviderRequests}回）に達しました`;
      if (usage.candidates >= budget.maxCandidates) return `候補数の上限（${budget.maxCandidates}件）に達しました`;
      return null;
    },
  };
}

export function emptyProviderStat(): ProviderStat {
  return { requestCount: 0, resultCount: 0, newCandidateCount: 0, duplicateCount: 0, verifiedCount: 0, failedCount: 0, skipped: false };
}

/** Provider 統計をマージ（ステップ実行のたびに加算していく） */
export function mergeProviderStats(base: ProviderStats, add: ProviderStats): ProviderStats {
  const out: ProviderStats = { ...base };
  for (const [name, stat] of Object.entries(add) as [DiscoveryProviderName, ProviderStat][]) {
    const prev = out[name] ?? emptyProviderStat();
    out[name] = {
      requestCount: prev.requestCount + stat.requestCount,
      resultCount: prev.resultCount + stat.resultCount,
      newCandidateCount: prev.newCandidateCount + stat.newCandidateCount,
      duplicateCount: prev.duplicateCount + stat.duplicateCount,
      verifiedCount: prev.verifiedCount + stat.verifiedCount,
      failedCount: prev.failedCount + stat.failedCount,
      skipped: stat.skipped || prev.skipped,
      unavailableReason: stat.unavailableReason ?? prev.unavailableReason,
    };
  }
  return out;
}
