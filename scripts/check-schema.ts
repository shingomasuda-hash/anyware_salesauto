/**
 * DB のスキーマがコードの期待と一致しているか確認する。
 *
 *   npm run db:verify
 *
 * マイグレーションが失敗してもツールが黙って終わることがあり、
 * 画面を開いて初めて「column does not exist」で気づくことになる。
 * db:migrate の直後にこれを実行すれば、その場で分かる。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";

type ColumnRow = { table_name: string; column_name: string };

/** コードが必ず参照する列（追加したらここにも足す） */
const REQUIRED: Record<string, string[]> = {
  companies: [
    "corporate_number", "company_name", "website_url", "verification_status", "sales_contact_allowed",
    "recruit_page_url", "recruit_target", "recruit_target_reasons", "job_boards", "latest_analysis_id",
  ],
  company_analysis: [
    "sales_priority_score", "sales_priority_rank", "confidence_score",
    "outreach_subject", "outreach_body", "outreach_personalization", "outreach_hypothesis_note",
  ],
  company_overview: [
    "has_website", "has_recruit_page", "has_contact", "has_email", "has_sns",
    "analysis_id", "sales_priority_rank", "confidence_score",
    "outreach_subject", "outreach_body", "has_outreach", "recruit_target", "job_boards",
  ],
  discovery_candidates: ["run_id", "status", "verification_score", "company_id"],
  company_sources: ["company_id", "provider", "external_id", "source_url", "source_type"],
};

async function main() {
  const db = getDb();
  const names = Object.keys(REQUIRED);
  const rows = await rawRows<ColumnRow>(
    db,
    sql`select table_name, column_name
        from information_schema.columns
        where table_schema = 'public' and table_name in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
  );

  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

  let missingTotal = 0;
  console.log("=== スキーマ確認 ===\n");
  for (const [table, columns] of Object.entries(REQUIRED)) {
    const have = actual.get(table);
    if (!have) {
      console.log(`❌ ${table}: テーブル / ビューが存在しません`);
      missingTotal += columns.length;
      continue;
    }
    const missing = columns.filter((c) => !have.has(c));
    if (missing.length === 0) {
      console.log(`✅ ${table}（${columns.length}列を確認）`);
    } else {
      console.log(`❌ ${table}: 不足 ${missing.join(", ")}`);
      missingTotal += missing.length;
    }
  }

  if (missingTotal > 0) {
    console.log(`\n${missingTotal}列が不足しています。マイグレーションが適用されていません。`);
    console.log("npm run db:migrate を実行し、エラーが出ていないか確認してください。");
    process.exit(1);
  }
  console.log("\nすべて一致しています。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
