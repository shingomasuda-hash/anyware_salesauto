import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
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

/**
 * 営業候補企業へ昇格した候補の数。
 * duplicate の候補も既存企業を指して company_id を持つため、status='verified' に限定する
 * （重複検出は昇格ではない）。
 */
export async function countPromotedCandidates(db: Db, runId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.run_id, runId),
        eq(discoveryCandidates.status, "verified"),
        isNotNull(discoveryCandidates.company_id),
      ),
    );
  return rows[0]?.count ?? 0;
}

export interface DiscoveryRunCounts {
  byStatus: Record<DiscoveryCandidateStatus, number>;
  /** 重複（既に登録済みの企業）を除いた新規候補数 */
  discovered: number;
  /** 保存した候補の総数（重複を含む） */
  total: number;
  promoted: number;
}

/**
 * discovery_runs のカウンタを discovery_candidates の実データから再計算する。
 *
 * カウンタを加算方式で持つと、ステップ実行のやり直しや手動レビュー（承認・却下）で
 * 実データとズレる。集計は必ず実データから引き直す。
 *
 * discovered_count は重複を除いた新規候補数。duplicate_count は別軸（既に登録済みの企業）で、
 * discovered_count には含めない。
 */
export async function refreshDiscoveryRunCounts(db: Db, runId: string): Promise<DiscoveryRunCounts> {
  const byStatus = await countCandidatesByStatus(db, runId);
  const promoted = await countPromotedCandidates(db, runId);
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const discovered = total - byStatus.duplicate;
  await updateDiscoveryRun(db, runId, {
    discovered_count: discovered,
    verified_count: byStatus.verified,
    needs_review_count: byStatus.needs_review,
    duplicate_count: byStatus.duplicate,
    rejected_count: byStatus.rejected,
    promoted_count: promoted,
  });
  return { byStatus, discovered, total, promoted };
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

/**
 * 同じ観測を二重に積まずに記録する。
 *
 * ユニークインデックスは (company_id, provider, external_id) だが、
 * PostgreSQL は NULL 同士を別物として扱うため、external_id を持たない観測
 * （法人番号もドメインも無い情報源）は制約で弾けず、再探索のたびに行が増える。
 * そこで書き込む観測と同じキーの行を先に消してから入れ直す。
 * 他の情報源が記録した行には触れない。
 */
export async function replaceCompanySources(db: Db, companyId: string, rows: CompanySourceInsert[]): Promise<void> {
  if (rows.length === 0) return;
  // 列ごとに比較する（行コンストラクタ (a,b,c) in ((..)) はパラメータの型が決まらず失敗する）
  const sameObservation = rows.map((r) =>
    and(
      eq(companySources.provider, r.provider),
      sql`coalesce(${companySources.external_id}, '') = ${r.external_id ?? ""}`,
      sql`coalesce(${companySources.source_url}, '') = ${r.source_url ?? ""}`,
      sql`coalesce(${companySources.source_type}, '') = ${r.source_type ?? ""}`,
    )!,
  );
  await db.delete(companySources).where(and(eq(companySources.company_id, companyId), or(...sameObservation)));
  await db.insert(companySources).values(rows);
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
