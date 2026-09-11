import { getEnv } from "./env";
import type { DiscoveryBudget, DiscoveryMode } from "@/lib/discovery/types";

/**
 * Verification Score の重み。実データ検証の結果に応じてここだけを調整すれば挙動が変わる。
 * 合計が 100 を超えても構わない（最終的に 0-100 にクランプする）。
 */
export interface VerificationWeights {
  corporateNumber: number;
  websiteNameMatch: number;
  addressMatch: number;
  phoneMatch: number;
  domainMatch: number;
  multiSource: number;
  /** 公的情報源（GビズINFO/EDINET）に裏付けがある */
  officialSource: number;
}

export interface VerificationThresholds {
  /** これ以上で verified */
  verified: number;
  /** これ以上で needs_review（未満は rejected 相当の unverified） */
  needsReview: number;
}

export function getDiscoveryConfig() {
  const env = getEnv();
  return {
    mode: (env.DISCOVERY_MODE ?? "hybrid") as DiscoveryMode,
    weights: {
      corporateNumber: 40,
      websiteNameMatch: 20,
      addressMatch: 15,
      phoneMatch: 10,
      domainMatch: 10,
      multiSource: 5,
      officialSource: 10,
    } satisfies VerificationWeights,
    thresholds: { verified: 80, needsReview: 60 } satisfies VerificationThresholds,
    /** 1 回の Discovery Run の上限。API 料金事故を防ぐ */
    budget: {
      maxProviderRequests: env.DISCOVERY_MAX_PROVIDER_REQUESTS,
      maxCandidates: env.DISCOVERY_MAX_CANDIDATES,
      maxVerificationRequests: env.DISCOVERY_MAX_VERIFICATION_REQUESTS,
      maxCrawlPages: env.CRAWL_MAX_PAGES,
      maxAiCalls: env.DISCOVERY_MAX_AI_CALLS,
      maxExecutionMinutes: env.DISCOVERY_MAX_EXECUTION_MINUTES,
    } satisfies DiscoveryBudget,
    /** 1 クエリあたりの取得件数 */
    perQueryLimit: 30,
    /** 1 ステップで実行するクエリ数の上限（HTTP のタイムアウト対策） */
    queriesPerStep: 6,
    /** 軽量 enrichment で取得するページ数 */
    lightCrawlMaxPages: 4,
  } as const;
}

/** budget を Run ごとにスケールさせる（少数件の探索で上限まで使い切らない） */
export function scaleBudgetForRequest(budget: DiscoveryBudget, requestedCount: number): DiscoveryBudget {
  const scale = Math.max(1, Math.ceil(requestedCount / 20));
  return {
    ...budget,
    maxProviderRequests: Math.min(budget.maxProviderRequests, 8 * scale),
    maxCandidates: Math.min(budget.maxCandidates, Math.max(40, requestedCount * 4)),
    // 候補1件あたり「公式サイト検索1回 + ページ取得最大3回」かかるうえ、
    // 目標の数倍の候補を検証するため、検証リクエストは多めに確保する
    maxVerificationRequests: Math.min(budget.maxVerificationRequests, Math.max(40, requestedCount * 12)),
  };
}
