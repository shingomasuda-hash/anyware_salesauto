/**
 * 昇格の途中で失敗した候補を復旧する。
 *
 *   npm run db:repair-candidates              … 対象を表示するだけ（変更しない）
 *   npm run db:repair-candidates -- --apply   … 実際に直す
 *
 * 企業登録まで終わったのに、その後の処理（情報源の記録など）で例外になると
 * 「company_id は入っているのに status が failed」という食い違った状態が残り、
 * 検証レポートの安全検査が落ちる。企業自体は正しく登録されているため、
 * 本人確認スコアが基準を満たしている候補は verified に戻す。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { getDiscoveryConfig } from "../src/lib/config/discovery";

type Row = { id: string; name: string; verification_score: number | null; reject_reason: string | null };

const apply = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const { thresholds } = getDiscoveryConfig();

  const rows = await rawRows<Row>(
    db,
    sql`select id, name, verification_score, reject_reason
        from discovery_candidates
        where status = 'failed'
          and company_id is not null
          and verification_score >= ${thresholds.verified}
        order by created_at desc`,
  );

  if (rows.length === 0) {
    console.log("復旧が必要な候補はありません。");
    return;
  }

  console.log(`企業登録は完了しているのに failed のままの候補: ${rows.length}件\n`);
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.name}（スコア ${r.verification_score}）: ${(r.reject_reason ?? "").slice(0, 100)}`);
  }
  if (rows.length > 20) console.log(`  … 他 ${rows.length - 20}件`);

  if (!apply) {
    console.log(`\n直すには --apply を付けて実行してください（例: npm run db:repair-candidates -- --apply）`);
    return;
  }

  await db.execute(sql`
    update discovery_candidates
    set status = 'verified', reject_reason = null, updated_at = now()
    where status = 'failed'
      and company_id is not null
      and verification_score >= ${thresholds.verified}`);
  console.log(`\n${rows.length}件を確認済み（verified）に戻しました。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
