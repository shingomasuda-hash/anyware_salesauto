/**
 * company_sources の重複行を掃除する。
 *
 *   npm run db:dedupe-sources              … 件数を表示するだけ（変更しない）
 *   npm run db:dedupe-sources -- --apply   … 実際に削除する
 *   npm run db:dedupe-sources -- --inspect … 同じ情報源が何行も並ぶ企業の中身を表示する
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

type InspectRow = {
  company_name: string;
  provider: string;
  external_id: string | null;
  source_url: string | null;
  source_type: string | null;
  confidence: number | null;
  rows: number | string;
};

const apply = process.argv.includes("--apply");
const inspect = process.argv.includes("--inspect");

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

/**
 * 同じ企業・同じ情報源の行が複数ある箇所を、キーの中身つきで表示する。
 * 「GビズINFO が7行」のように見えるとき、どの項目が違って重複と判定されていないかを特定する。
 */
async function printInspection(db: ReturnType<typeof getDb>): Promise<void> {
  const rows = await rawRows<InspectRow>(
    db,
    sql`select c.company_name,
               s.provider,
               s.external_id,
               s.source_url,
               s.source_type,
               s.confidence,
               count(*) as rows
        from company_sources s
        join companies c on c.id = s.company_id
        where s.company_id in (
          select company_id from company_sources group by company_id, provider having count(*) > 1
        )
        group by c.company_name, s.provider, s.external_id, s.source_url, s.source_type, s.confidence
        order by c.company_name, s.provider
        limit 60`,
  );
  if (rows.length === 0) {
    console.log("同じ情報源が複数行ある企業はありません。");
    return;
  }
  console.log("同じ企業・同じ情報源で複数行ある箇所（キーの中身）:\n");
  let current = "";
  for (const r of rows) {
    if (r.company_name !== current) {
      current = r.company_name;
      console.log(`  ${current}`);
    }
    console.log(
      `    ${r.provider} / type=${r.source_type ?? "(null)"} / conf=${r.confidence ?? "—"} / 同一行 ${r.rows}件`,
    );
    console.log(`      external_id: ${r.external_id ?? "(null)"}`);
    console.log(`      source_url : ${r.source_url ?? "(null)"}`);
  }
  console.log("\n→ external_id または source_url が行ごとに違う場合、それが重複と判定されない理由です。");
}

async function main() {
  const db = getDb();

  if (inspect) {
    await printInspection(db);
    return;
  }
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
