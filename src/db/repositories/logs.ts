import { and, desc, eq, type SQL } from "drizzle-orm";
import type { Db } from "../index";
import { aiUsageLogs, companies, systemLogs } from "../schema";
import type { AiUsageLogInsert, AiUsageLogRow, LogLevel, SystemLogRow } from "../types";

export async function insertSystemLog(db: Db, values: typeof systemLogs.$inferInsert): Promise<void> {
  await db.insert(systemLogs).values(values);
}

export async function listSystemLogs(db: Db, filter: { category?: string; level?: LogLevel; limit?: number }): Promise<SystemLogRow[]> {
  const conditions: SQL[] = [];
  if (filter.category) conditions.push(eq(systemLogs.category, filter.category));
  if (filter.level) conditions.push(eq(systemLogs.level, filter.level));
  return db
    .select()
    .from(systemLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(systemLogs.created_at))
    .limit(filter.limit ?? 200);
}

export async function insertAiUsageLog(db: Db, values: AiUsageLogInsert): Promise<void> {
  await db.insert(aiUsageLogs).values(values);
}

export type AiUsageLogWithCompany = AiUsageLogRow & { companies: { company_name: string } | null };

export async function listAiUsageLogsWithCompany(db: Db, limit = 200): Promise<AiUsageLogWithCompany[]> {
  const rows = await db
    .select({ log: aiUsageLogs, company_name: companies.company_name })
    .from(aiUsageLogs)
    .leftJoin(companies, eq(companies.id, aiUsageLogs.company_id))
    .orderBy(desc(aiUsageLogs.created_at))
    .limit(limit);
  return rows.map((r) => ({ ...r.log, companies: r.company_name ? { company_name: r.company_name } : null }));
}
