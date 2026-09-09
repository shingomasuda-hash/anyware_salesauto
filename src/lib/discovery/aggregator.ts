import { deduplicate, type DedupeResult } from "./deduplicator";
import { emptyProviderStat } from "./budget";
import { isPlausibleCompany } from "./normalizer";
import type {
  CompanyDiscoveryProvider,
  DiscoveryCandidate,
  DiscoveryContext,
  DiscoveryQuery,
  MergedCandidate,
  ProviderStats,
} from "./types";

export interface AggregationResult {
  merged: MergedCandidate[];
  stats: ProviderStats;
  executedQueryIds: string[];
  stoppedReason: "completed" | "budget" | "deadline";
  dedupe: DedupeResult;
}

/**
 * 計画されたクエリを Provider ごとに実行し、候補を統合する。
 * - Provider 単体が失敗しても他 Provider で処理を継続する
 * - 予算・締切を超えたら安全に打ち切る（途中結果は保持する）
 */
export async function aggregateCandidates(
  queries: DiscoveryQuery[],
  providers: CompanyDiscoveryProvider[],
  context: DiscoveryContext,
  seed: MergedCandidate[] = [],
): Promise<AggregationResult> {
  const byName = new Map(providers.map((p) => [p.name, p]));
  const stats: ProviderStats = {};
  const executedQueryIds: string[] = [];
  let merged: MergedCandidate[] = [...seed];
  const dedupeTotals: DedupeResult = {
    merged,
    duplicateCount: 0,
    reasons: { corporate_number: 0, domain: 0, phone: 0, name_address: 0, name_city: 0, fuzzy_name: 0 },
  };
  let stoppedReason: AggregationResult["stoppedReason"] = "completed";

  for (const query of queries) {
    if (context.budget.isTimeExceeded() || Date.now() > context.deadline) {
      stoppedReason = "deadline";
      break;
    }
    if (!context.budget.canProviderRequest() || !context.budget.canAddCandidate()) {
      stoppedReason = "budget";
      break;
    }
    const provider = byName.get(query.provider);
    if (!provider) continue;

    const stat = (stats[query.provider] ??= emptyProviderStat());
    context.budget.consumeProviderRequest();
    stat.requestCount += 1;
    executedQueryIds.push(query.id);

    let results: DiscoveryCandidate[] = [];
    try {
      results = await provider.search(query, context);
    } catch (err) {
      // Provider 単体の失敗は全体を止めない
      stat.failedCount += 1;
      await context.log("warn", `${query.provider} の検索に失敗しました`, {
        query: query.text ?? query.shard?.label ?? query.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const plausible = results.filter(isPlausibleCompany);
    stat.resultCount += plausible.length;

    const before = merged.length;
    const result = deduplicate(plausible, merged);
    merged = result.merged;
    dedupeTotals.duplicateCount += result.duplicateCount;
    for (const key of Object.keys(result.reasons) as (keyof typeof result.reasons)[]) {
      dedupeTotals.reasons[key] += result.reasons[key];
    }
    const newCount = merged.length - before;
    stat.newCandidateCount += newCount;
    stat.duplicateCount += plausible.length - newCount;
    context.budget.addCandidates(newCount);
  }

  dedupeTotals.merged = merged;
  return { merged, stats, executedQueryIds, stoppedReason, dedupe: dedupeTotals };
}
