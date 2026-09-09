import type { Db } from "@/db";
import type { DiscoveryCandidateStatus, DiscoveryRunRow } from "@/db/types";
import { countCandidatesByStatus, getDiscoveryRun } from "@/db/repositories/discovery";
import type { ProviderStats } from "./types";

export interface DiscoveryRunProgress {
  run: DiscoveryRunRow;
  counts: Record<DiscoveryCandidateStatus, number>;
  providerStats: ProviderStats;
  isFinished: boolean;
}

/** 探索ランの進捗（Provider ごとの内訳つき） */
export async function getDiscoveryRunProgress(db: Db, runId: string): Promise<DiscoveryRunProgress | null> {
  const run = await getDiscoveryRun(db, runId);
  if (!run) return null;
  const counts = await countCandidatesByStatus(db, runId);
  return {
    run,
    counts,
    providerStats: (run.provider_stats ?? {}) as ProviderStats,
    isFinished: ["completed", "partially_completed", "failed", "cancelled"].includes(run.status),
  };
}
