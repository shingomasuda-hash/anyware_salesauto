import { and, eq } from "drizzle-orm";
import type { Db } from "../index";
import { suppressionList } from "../schema";
import type { SuppressionReason } from "../types";

/** 同一企業・同一理由の抑止レコードが無ければ追加（将来の自動送信から除外するため） */
export async function ensureSuppression(
  db: Db,
  values: { companyId: string; reason: SuppressionReason; note?: string | null; sourceUrl?: string | null; domain?: string | null },
): Promise<void> {
  const existing = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(and(eq(suppressionList.company_id, values.companyId), eq(suppressionList.reason, values.reason)))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(suppressionList).values({
    company_id: values.companyId,
    reason: values.reason,
    note: values.note ?? null,
    source_url: values.sourceUrl ?? null,
    domain: values.domain ?? null,
  });
}

export async function deleteSuppression(db: Db, companyId: string, reason: SuppressionReason): Promise<void> {
  await db.delete(suppressionList).where(and(eq(suppressionList.company_id, companyId), eq(suppressionList.reason, reason)));
}
