import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { rawRows } from "./index";

/**
 * アプリが必ず参照するテーブル / ビューと列。
 *
 * マイグレーションが失敗しても drizzle-kit は成功したように見えることがあり、
 * 画面を開いて初めて「column does not exist」で気づくことになる。
 * ここを唯一の定義として、CLI（db:verify）・/api/health・統合テストが同じものを見る。
 * 列を追加したらここにも足すこと。
 */
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  companies: [
    "corporate_number",
    "company_name",
    "website_url",
    "verification_status",
    "sales_contact_allowed",
    "recruit_page_url",
    "recruit_target",
    "recruit_target_reasons",
    "job_boards",
    "latest_analysis_id",
  ],
  company_analysis: [
    "sales_priority_score",
    "sales_priority_rank",
    "confidence_score",
    "outreach_subject",
    "outreach_body",
    "outreach_personalization",
    "outreach_hypothesis_note",
  ],
  company_overview: [
    "has_website",
    "has_recruit_page",
    "has_contact",
    "has_email",
    "has_sns",
    "analysis_id",
    "sales_priority_rank",
    "confidence_score",
    "outreach_subject",
    "outreach_body",
    "has_outreach",
    "recruit_target",
    "job_boards",
  ],
  discovery_runs: ["phase", "requested_count", "discovered_count", "promoted_count"],
  discovery_candidates: ["run_id", "status", "verification_score", "company_id"],
  company_sources: ["company_id", "provider", "external_id", "source_url", "source_type"],
};

/** 必ず存在すべき PostgreSQL 関数 */
export const REQUIRED_FUNCTIONS = ["claim_job", "dashboard_stats", "increment_search_job_counters"];

export interface SchemaCheckResult {
  ok: boolean;
  /** テーブル / ビューごとの不足列 */
  missingColumns: Record<string, string[]>;
  missingFunctions: string[];
}

/**
 * DB の実体が期待と一致しているかを確認する。
 * 期待値を引数で差し替えられるようにしてあるのは、
 * 「欠けていれば検知できる」ことをテストで確認するため（検知できないチェックは無意味）。
 */
export async function checkRequiredSchema(
  db: Db,
  required: Record<string, string[]> = REQUIRED_COLUMNS,
  requiredFunctions: string[] = REQUIRED_FUNCTIONS,
): Promise<SchemaCheckResult> {
  // 配列をそのまま渡すとタプル ($1,$2,...) に展開され any() が受け取れないため、
  // カンマ区切りの1パラメータを string_to_array で配列に戻す
  const tables = Object.keys(required);
  const columnRows = await rawRows<{ table_name: string; column_name: string }>(
    db,
    sql`select table_name::text as table_name, column_name::text as column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name::text = any(string_to_array(${tables.join(",")}, ','))`,
  );
  const actual = new Map<string, Set<string>>();
  for (const r of columnRows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

  const missingColumns: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(required)) {
    const have = actual.get(table);
    const missing = have ? columns.filter((c) => !have.has(c)) : columns;
    if (missing.length > 0) missingColumns[table] = missing;
  }

  const functionRows = await rawRows<{ proname: string }>(
    db,
    sql`select proname::text as proname from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname::text = any(string_to_array(${requiredFunctions.join(",")}, ','))`,
  );
  const haveFunctions = new Set(functionRows.map((r) => r.proname));
  const missingFunctions = requiredFunctions.filter((f) => !haveFunctions.has(f));

  return { ok: Object.keys(missingColumns).length === 0 && missingFunctions.length === 0, missingColumns, missingFunctions };
}
