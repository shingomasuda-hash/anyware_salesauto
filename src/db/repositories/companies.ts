import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../index";
import { rawRows } from "../index";
import { companies, companyOverview } from "../schema";
import type { CompanyInsert, CompanyOverviewRow, CompanyRow, DashboardStats } from "../types";

export interface DedupeCandidateRow {
  id: string;
  corporate_number: string | null;
  website_domain: string | null;
  company_name_normalized: string;
  address_normalized: string | null;
}

/** 重複判定用: 法人番号 / ドメイン / 企業名+所在地 のいずれかに一致する既存企業を取得 */
export async function findDedupeCandidates(
  db: Db,
  keys: { corporateNumber: string | null; domain: string | null; nameNorm: string; addrNorm: string | null },
): Promise<DedupeCandidateRow[]> {
  const conditions: SQL[] = [];
  if (keys.corporateNumber) conditions.push(eq(companies.corporate_number, keys.corporateNumber));
  if (keys.domain) conditions.push(eq(companies.website_domain, keys.domain));
  if (keys.nameNorm && keys.addrNorm) conditions.push(and(eq(companies.company_name_normalized, keys.nameNorm), eq(companies.address_normalized, keys.addrNorm))!);
  if (conditions.length === 0) return [];
  return db
    .select({
      id: companies.id,
      corporate_number: companies.corporate_number,
      website_domain: companies.website_domain,
      company_name_normalized: companies.company_name_normalized,
      address_normalized: companies.address_normalized,
    })
    .from(companies)
    .where(or(...conditions))
    .limit(10);
}

export async function getCompanyById(db: Db, id: string): Promise<CompanyRow | null> {
  const rows = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertCompany(db: Db, values: CompanyInsert): Promise<CompanyRow> {
  const rows = await db.insert(companies).values(values).returning();
  return rows[0];
}

export async function updateCompany(db: Db, id: string, values: Partial<CompanyInsert>): Promise<void> {
  await db.update(companies).set(values).where(eq(companies.id, id));
}

/** crawl_status が指定値のときだけ更新（enqueue 時のリセット用） */
export async function updateCompanyWhereCrawlStatusIn(db: Db, id: string, statuses: CompanyRow["crawl_status"][], values: Partial<CompanyInsert>): Promise<void> {
  await db
    .update(companies)
    .set(values)
    .where(and(eq(companies.id, id), inArray(companies.crawl_status, statuses)));
}

export async function findCompanyByDomainExcluding(db: Db, domain: string, excludeId: string): Promise<{ id: string; company_name: string } | null> {
  const rows = await db
    .select({ id: companies.id, company_name: companies.company_name })
    .from(companies)
    .where(and(eq(companies.website_domain, domain), ne(companies.id, excludeId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface OverviewQuery {
  where: SQL | undefined;
  orderBy: SQL[];
  limit: number;
  offset: number;
}

export async function listCompanyOverview(db: Db, q: OverviewQuery): Promise<{ rows: CompanyOverviewRow[]; total: number }> {
  const [rows, countRows] = await Promise.all([
    db.select().from(companyOverview).where(q.where).orderBy(...q.orderBy).limit(q.limit).offset(q.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(companyOverview).where(q.where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function listCompanyOverviewAll(db: Db, q: Omit<OverviewQuery, "offset">): Promise<CompanyOverviewRow[]> {
  return db.select().from(companyOverview).where(q.where).orderBy(...q.orderBy).limit(q.limit);
}

/** ダッシュボード: 営業優先度の高い企業 */
export async function listTopCompanies(db: Db, limit: number) {
  return db
    .select({
      id: companyOverview.id,
      company_name: companyOverview.company_name,
      prefecture: companyOverview.prefecture,
      industry: companyOverview.industry,
      sales_priority_score: companyOverview.sales_priority_score,
      sales_priority_rank: companyOverview.sales_priority_rank,
      sales_contact_allowed: companyOverview.sales_contact_allowed,
      analyzed_at: companyOverview.analyzed_at,
    })
    .from(companyOverview)
    .where(sql`${companyOverview.sales_priority_score} is not null`)
    .orderBy(desc(companyOverview.sales_priority_score))
    .limit(limit);
}

export async function getDashboardStats(db: Db): Promise<DashboardStats> {
  const rows = await rawRows<{ stats: Partial<DashboardStats> | string }>(db, sql`select public.dashboard_stats() as stats`);
  const raw = rows[0]?.stats;
  const d: Partial<DashboardStats> = typeof raw === "string" ? (JSON.parse(raw) as Partial<DashboardStats>) : (raw ?? {});
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
  return {
    total_companies: n(d.total_companies),
    added_this_week: n(d.added_this_week),
    rank_a: n(d.rank_a),
    rank_b: n(d.rank_b),
    unanalyzed: n(d.unanalyzed),
    sales_restricted: n(d.sales_restricted),
    website_unverified: n(d.website_unverified),
    pending_jobs: n(d.pending_jobs),
    needs_review_candidates: n(d.needs_review_candidates),
  };
}
