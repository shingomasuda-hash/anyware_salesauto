import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../index";
import { companyPages } from "../schema";
import type { CompanyPageInsert, CompanyPageRow } from "../types";

/** 企業のクロール済みページを全置換（再クロール時） */
export async function replaceCompanyPages(db: Db, companyId: string, rows: CompanyPageInsert[]): Promise<void> {
  await db.delete(companyPages).where(eq(companyPages.company_id, companyId));
  if (rows.length > 0) await db.insert(companyPages).values(rows);
}

export async function listCompanyPages(db: Db, companyId: string): Promise<CompanyPageRow[]> {
  return db.select().from(companyPages).where(eq(companyPages.company_id, companyId)).orderBy(desc(companyPages.crawled_at), companyPages.page_type);
}

export async function countCompanyPages(db: Db, companyId: string): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(companyPages).where(eq(companyPages.company_id, companyId));
  return rows[0]?.count ?? 0;
}
