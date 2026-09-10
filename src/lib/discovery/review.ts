import type { Db } from "@/db";
import type { DiscoveryCandidateRow } from "@/db/types";
import { getDiscoveryRun, refreshDiscoveryRunCounts, updateCandidate, updateDiscoveryRun } from "@/db/repositories/discovery";
import type { Logger } from "@/lib/logging/logger";
import { promoteCandidate, type PromoteResult } from "./promote";

/**
 * needs_review の候補を人が承認して営業候補企業へ昇格させる。
 * 自動判定で verified にならなかった企業は、必ずこの明示的な承認を通す。
 */
export async function approveCandidate(
  db: Db,
  candidate: DiscoveryCandidateRow,
  options: { websiteUrl?: string | null; reviewedBy?: string | null },
  logger: Logger,
): Promise<PromoteResult> {
  const websiteUrl = options.websiteUrl?.trim() || candidate.website;
  const result = await promoteCandidate(
    db,
    { ...candidate, website: websiteUrl },
    { websiteUrl, createdBy: options.reviewedBy ?? null },
    logger,
  );
  await updateCandidate(db, candidate.id, {
    status: "verified",
    reject_reason: null,
    reviewed_by: options.reviewedBy ?? null,
    reviewed_at: new Date().toISOString(),
  });
  // 手動レビューで候補の状態が変わるため、探索ランの集計を実データから引き直す
  if (candidate.run_id) await refreshDiscoveryRunCounts(db, candidate.run_id);
  await logger.info("候補を手動で承認", { candidate: candidate.name, companyId: result.companyId });
  return result;
}

/** 候補を却下する（companies には登録しない） */
export async function rejectCandidate(db: Db, candidate: DiscoveryCandidateRow, reason: string, reviewedBy?: string | null): Promise<void> {
  await updateCandidate(db, candidate.id, {
    status: "rejected",
    reject_reason: reason.slice(0, 500),
    reviewed_by: reviewedBy ?? null,
    reviewed_at: new Date().toISOString(),
  });
  if (candidate.run_id) await refreshDiscoveryRunCounts(db, candidate.run_id);
}

/**
 * 公式サイトを手修正して再検証待ちに戻す。
 * 探索が終了済みの Run でも、この候補だけを検証し直せるように Run を verifying へ戻す。
 */
export async function correctCandidateWebsite(db: Db, candidate: DiscoveryCandidateRow, websiteUrl: string, reviewedBy?: string | null): Promise<void> {
  await updateCandidate(db, candidate.id, {
    website: websiteUrl,
    domain: null,
    status: "discovered",
    verification_score: null,
    official_site_confidence: null,
    reject_reason: null,
    reviewed_by: reviewedBy ?? null,
    reviewed_at: new Date().toISOString(),
  });
  if (!candidate.run_id) return;
  await refreshDiscoveryRunCounts(db, candidate.run_id);
  const run = await getDiscoveryRun(db, candidate.run_id);
  if (!run || run.status === "running") return;
  await updateDiscoveryRun(db, candidate.run_id, { status: "pending", phase: "verifying", locked_at: null, completed_at: null, attempts: 0 });
}
