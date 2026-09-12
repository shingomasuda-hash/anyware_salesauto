/**
 * 登録済みの公式サイトURLを、現在の判定基準で再点検する。
 *
 *   npm run db:recheck-sites            … 対象を表示するだけ
 *   npm run db:recheck-sites -- --apply … 不適切なURLを外して要確認に戻す
 *
 * 公式サイトの判定は実データ検証で何度も厳しくしてきたが、
 * 既に登録済みの URL には遡って適用されていなかった。
 * そのため法人情報DB・電話番号検索・団体の名簿ページが「公式サイト」として残り、
 * 再クロールでもそこを読み続けてしまっていた。
 *
 * URL は website_candidates に理由つきで残すので、後から確認できる。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { updateCompany } from "../src/db/repositories/companies";
import { recheckSiteUrl } from "../src/lib/companies/site-recheck";
import type { Json } from "../src/db/types";

type Row = { id: string; company_name: string; website_url: string; website_candidates: unknown };

const apply = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const rows = await rawRows<Row>(
    db,
    sql`select id, company_name, website_url, website_candidates
        from companies
        where website_url is not null
        order by updated_at desc`,
  );

  const bad = rows
    .map((r) => ({ row: r, verdict: recheckSiteUrl(r.website_url) }))
    .filter((x) => !x.verdict.ok);

  console.log(`公式サイトが登録されている企業: ${rows.length}社`);
  if (bad.length === 0) {
    console.log("現在の基準で不適切なURLはありません。");
    return;
  }

  console.log(`\n公式サイトとして不適切: ${bad.length}社\n`);
  for (const { row, verdict } of bad.slice(0, 30)) {
    console.log(`  ${row.company_name}`);
    console.log(`    ${row.website_url}`);
    console.log(`    → ${verdict.reason}`);
  }
  if (bad.length > 30) console.log(`  … 他 ${bad.length - 30}社`);

  if (!apply) {
    console.log(`\n外すには --apply を付けてください（例: npm run db:recheck-sites -- --apply）`);
    console.log("外した企業は「公式HP要確認」になり、一覧から除外されます。URL は履歴に残します。");
    return;
  }

  for (const { row, verdict } of bad) {
    const previous = Array.isArray(row.website_candidates) ? (row.website_candidates as unknown[]) : [];
    await updateCompany(db, row.id, {
      website_url: null,
      website_domain: null,
      // 外した理由を残す（消さずに履歴として持つ）
      website_candidates: [...previous, { url: row.website_url, source: "search", rejectedReason: verdict.reason }] as unknown as Json,
      verification_status: "needs_review",
      crawl_status: "no_website",
      official_site_confidence: null,
    });
  }
  console.log(`\n${bad.length}社の公式サイトを外し、「要確認」に戻しました。`);
  console.log("これらの企業は一覧から除外されます（フィルタ「公式HP未確認も表示」で確認できます）。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
