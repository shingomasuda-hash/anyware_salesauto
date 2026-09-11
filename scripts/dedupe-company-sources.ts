/**
 * company_sources の重複行を掃除する。
 *
 *   npm run db:dedupe-sources            … 件数を表示するだけ（変更しない）
 *   npm run db:dedupe-sources -- --apply … 実際に削除する
 *
 * 同一企業の同じ観測（provider + external_id + source_url + source_type）が
 * 複数行あると「GビズINFO(90) が7回」のように表示される。
 * ユニークインデックスは (company_id, provider, external_id) だが、
 * PostgreSQL では NULL 同士が別物として扱われるため、external_id が無い行は弾けない。
 * 現在のコードは投入前に畳んでいるので、これは過去に溜まった行の掃除用。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";

type CountRow = { total: number | string };

const apply = process.argv.includes("--apply");

/** 同じ観測のうち最も古い1行だけ残す */
const DUPLICATE_IDS = sql`
  select id from (
    select id,
           row_number() over (
             partition by company_id, provider, coalesce(external_id, ''), coalesce(source_url, ''), coalesce(source_type, '')
             order by created_at asc, id asc
           ) as rn
    from company_sources
  ) t where rn > 1`;

async function main() {
  const db = getDb();
  const [{ total }] = await rawRows<CountRow>(db, sql`select count(*) as total from (${DUPLICATE_IDS}) d`);
  const count = Number(total) || 0;

  if (count === 0) {
    console.log("重複した company_sources はありません。");
    return;
  }
  console.log(`重複行: ${count}件`);

  if (!apply) {
    console.log("削除するには --apply を付けて実行してください（例: npm run db:dedupe-sources -- --apply）");
    return;
  }
  await db.execute(sql`delete from company_sources where id in (${DUPLICATE_IDS})`);
  console.log(`${count}件を削除しました。各観測につき最も古い1行を残しています。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
