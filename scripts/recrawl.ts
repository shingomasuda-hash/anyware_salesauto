/**
 * 登録済みの企業をクロールし直す。
 *
 *   npm run recrawl                        … 対象を表示するだけ
 *   npm run recrawl -- --apply             … クロールジョブを投入する
 *   npm run recrawl -- --missing-target --apply  … 採用状況が未判定の企業だけ
 *   npm run recrawl -- --prefecture 京都府 --apply
 *
 * 採用状況（recruit_target）や問い合わせフォームの情報はクロール時に判定するため、
 * 判定ロジックを追加・変更したあとは再クロールしないと既存の企業に反映されない。
 *
 * クロール自体に API 費用はかからない（公式サイトは特定済みなので Web 検索も走らない）。
 * AI 分析は既定では走らせない。必要なら --with-analysis を付ける。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { enqueueCrawlJob } from "../src/lib/jobs/enqueue";
import { recheckSiteUrl } from "../src/lib/companies/site-recheck";
import { IS_RECRAWLABLE } from "../src/lib/maintenance/targets";

type Row = { id: string; company_name: string; prefecture: string | null; recruit_target: string | null; website_url: string | null };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const apply = process.argv.includes("--apply");
const withAnalysis = process.argv.includes("--with-analysis");
const missingTarget = process.argv.includes("--missing-target");
const limit = Math.max(1, Number(arg("limit") ?? 100));
const prefecture = arg("prefecture");

async function main() {
  const db = getDb();
  const rows = await rawRows<Row>(
    db,
    sql`select id, company_name, prefecture, recruit_target, website_url
        from companies
        where ${sql.raw(IS_RECRAWLABLE)}
          ${missingTarget ? sql`and recruit_target is null` : sql``}
          ${prefecture ? sql`and prefecture = ${prefecture}` : sql``}
        order by updated_at desc
        limit ${limit}`,
  );

  if (rows.length === 0) {
    console.log("対象の企業がありません（公式サイトを確認できた企業が対象です）。");
    return;
  }

  // 現在の基準で公式サイトとして不適切な URL は読みに行かない。
  // 法人情報DB・団体名簿を20ページずつ読むのは無駄で、相手方にも負荷をかける。
  const invalid = rows.filter((r) => !recheckSiteUrl(r.website_url).ok);
  const targets = rows.filter((r) => recheckSiteUrl(r.website_url).ok);
  if (invalid.length > 0) {
    console.log(`公式サイトが不適切なため除外: ${invalid.length}社`);
    for (const r of invalid.slice(0, 5)) console.log(`  ${r.company_name} → ${r.website_url}`);
    if (invalid.length > 5) console.log(`  … 他 ${invalid.length - 5}社`);
    console.log("  → npm run db:recheck-sites -- --apply で公式サイトを外してください\n");
  }
  if (targets.length === 0) {
    console.log("クロールできる企業がありません。");
    return;
  }

  const unjudged = targets.filter((r) => !r.recruit_target).length;
  console.log(`対象: ${targets.length}社（うち採用状況が未判定 ${unjudged}社）`);
  for (const r of targets.slice(0, 10)) {
    console.log(`  ${r.company_name}（${r.prefecture ?? "—"} / 採用状況 ${r.recruit_target ?? "未判定"}）`);
  }
  if (targets.length > 10) console.log(`  … 他 ${targets.length - 10}社`);

  console.log(`\nクロール自体に API 費用はかかりません。`);
  console.log(withAnalysis ? "AI分析も投入します（1社14円程度の費用がかかります）。" : "AI分析は投入しません（--with-analysis で投入できます）。");

  if (!apply) {
    console.log(`\n実行するには --apply を付けてください（例: npm run recrawl -- --missing-target --apply）`);
    return;
  }

  let queued = 0;
  for (const r of targets) {
    const result = await enqueueCrawlJob(db, r.id, { enqueueAnalysis: withAnalysis });
    if (result.created) queued++;
  }
  console.log(`\n${queued}社のクロールジョブを投入しました。`);
  console.log(`次に実行: npm run jobs:run -- --drain`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
