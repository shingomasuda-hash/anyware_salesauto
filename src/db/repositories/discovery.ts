import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../index";
import { companies, companySources, discoveryCandidates, discoveryRuns } from "../schema";
import type {
  CompanySourceInsert,
  CompanySourceRow,
  DiscoveryCandidateInsert,
  DiscoveryCandidateRow,
  DiscoveryCandidateStatus,
  DiscoveryRunInsert,
  DiscoveryRunRow,
} from "../types";

// ---------------- discovery_runs ----------------

export async function insertDiscoveryRun(db: Db, values: DiscoveryRunInsert): Promise<DiscoveryRunRow> {
  const rows = await db.insert(discoveryRuns).values(values).returning();
  return rows[0];
}

export async function getDiscoveryRun(db: Db, id: string): Promise<DiscoveryRunRow | null> {
  const rows = await db.select().from(discoveryRuns).where(eq(discoveryRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateDiscoveryRun(db: Db, id: string, values: Partial<DiscoveryRunInsert>): Promise<void> {
  await db.update(discoveryRuns).set(values).where(eq(discoveryRuns.id, id));
}

export async function listDiscoveryRuns(db: Db, limit = 20): Promise<DiscoveryRunRow[]> {
  return db.select().from(discoveryRuns).orderBy(desc(discoveryRuns.created_at)).limit(limit);
}

export async function cancelDiscoveryRun(db: Db, id: string): Promise<void> {
  await db
    .update(discoveryRuns)
    .set({ status: "cancelled", completed_at: new Date().toISOString(), locked_at: null })
    .where(and(eq(discoveryRuns.id, id), inArray(discoveryRuns.status, ["pending", "running"])));
}

// ---------------- discovery_candidates ----------------

export async function insertCandidates(db: Db, rows: DiscoveryCandidateInsert[]): Promise<DiscoveryCandidateRow[]> {
  if (rows.length === 0) return [];
  return db.insert(discoveryCandidates).values(rows).returning();
}

export async function updateCandidate(db: Db, id: string, values: Partial<DiscoveryCandidateInsert>): Promise<void> {
  await db.update(discoveryCandidates).set(values).where(eq(discoveryCandidates.id, id));
}

export async function listCandidatesByRun(db: Db, runId: string, status?: DiscoveryCandidateStatus, limit = 500): Promise<DiscoveryCandidateRow[]> {
  const conditions: SQL[] = [eq(discoveryCandidates.run_id, runId)];
  if (status) conditions.push(eq(discoveryCandidates.status, status));
  return db
    .select()
    .from(discoveryCandidates)
    .where(and(...conditions))
    .orderBy(desc(discoveryCandidates.verification_score), desc(discoveryCandidates.created_at))
    .limit(limit);
}

/** 検証待ちの候補を取り出す（1ステップ分） */
export async function claimCandidatesForVerification(db: Db, runId: string, limit: number): Promise<DiscoveryCandidateRow[]> {
  return db
    .select()
    .from(discoveryCandidates)
    .where(and(eq(discoveryCandidates.run_id, runId), eq(discoveryCandidates.status, "discovered")))
    .orderBy(desc(discoveryCandidates.source_confidence))
    .limit(limit);
}

export async function countCandidatesByStatus(db: Db, runId: string): Promise<Record<DiscoveryCandidateStatus, number>> {
  const rows = await db
    .select({ status: discoveryCandidates.status, count: sql<number>`count(*)::int` })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.run_id, runId))
    .groupBy(discoveryCandidates.status);
  const result: Record<DiscoveryCandidateStatus, number> = {
    discovered: 0,
    verifying: 0,
    verified: 0,
    needs_review: 0,
    duplicate: 0,
    rejected: 0,
    failed: 0,
  };
  for (const r of rows) result[r.status] = r.count;
  return result;
}

/** 既存の候補・企業と突き合わせて、すでに知っている企業かを判定する材料を取る */
export async function findKnownMatches(
  db: Db,
  keys: { corporateNumbers: string[]; domains: string[]; normalizedNames: string[] },
): Promise<{ candidates: DiscoveryCandidateRow[]; companyIds: { id: string; corporate_number: string | null; website_domain: string | null; company_name_normalized: string; address_normalized: string | null }[] }> {
  const candConditions: SQL[] = [];
  if (keys.corporateNumbers.length) candConditions.push(inArray(discoveryCandidates.corporate_number, keys.corporateNumbers));
  if (keys.domains.length) candConditions.push(inArray(discoveryCandidates.domain, keys.domains));
  if (keys.normalizedNames.length) candConditions.push(inArray(discoveryCandidates.normalized_name, keys.normalizedNames));

  const compConditions: SQL[] = [];
  if (keys.corporateNumbers.length) compConditions.push(inArray(companies.corporate_number, keys.corporateNumbers));
  if (keys.domains.length) compConditions.push(inArray(companies.website_domain, keys.domains));
  if (keys.normalizedNames.length) compConditions.push(inArray(companies.company_name_normalized, keys.normalizedNames));

  const [candidates, companyRows] = await Promise.all([
    candConditions.length
      ? db.select().from(discoveryCandidates).where(or(...candConditions)).limit(500)
      : Promise.resolve([] as DiscoveryCandidateRow[]),
    compConditions.length
      ? db
          .select({
            id: companies.id,
            corporate_number: companies.corporate_number,
            website_domain: companies.website_domain,
            company_name_normalized: companies.company_name_normalized,
            address_normalized: companies.address_normalized,
          })
          .from(companies)
          .where(or(...compConditions))
          .limit(500)
      : Promise.resolve([]),
  ]);
  return { candidates, companyIds: companyRows };
}

/** レビュー待ち（needs_review）の候補一覧 */
export async function listReviewQueue(db: Db, limit = 100): Promise<(DiscoveryCandidateRow & { run_name: string | null })[]> {
  const rows = await db
    .select({ candidate: discoveryCandidates, run_name: discoveryRuns.name })
    .from(discoveryCandidates)
    .leftJoin(discoveryRuns, eq(discoveryRuns.id, discoveryCandidates.run_id))
    .where(eq(discoveryCandidates.status, "needs_review"))
    .orderBy(desc(discoveryCandidates.verification_score), desc(discoveryCandidates.created_at))
    .limit(limit);
  return rows.map((r) => ({ ...r.candidate, run_name: r.run_name }));
}

export async function getCandidate(db: Db, id: string): Promise<DiscoveryCandidateRow | null> {
  const rows = await db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function countPendingReview(db: Db): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.status, "needs_review"));
  return rows[0]?.count ?? 0;
}

// ---------------- company_sources ----------------

/** 同一 (company, provider, external_id) は上書きせず無視する（観測は積み上げる） */
export async function insertCompanySources(db: Db, rows: CompanySourceInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(companySources).values(rows).onConflictDoNothing();
}

export async function listCompanySources(db: Db, companyId: string): Promise<CompanySourceRow[]> {
  return db.select().from(companySources).where(eq(companySources.company_id, companyId)).orderBy(desc(companySources.confidence));
}

/** まだ company に紐づいていない verified 候補 */
export async function listPromotableCandidates(db: Db, runId: string, limit: number): Promise<DiscoveryCandidateRow[]> {
  return db
    .select()
    .from(discoveryCandidates)
    .where(and(eq(discoveryCandidates.run_id, runId), eq(discoveryCandidates.status, "verified"), isNull(discoveryCandidates.company_id)))
    .orderBy(desc(discoveryCandidates.verification_score))
    .limit(limit);
}
