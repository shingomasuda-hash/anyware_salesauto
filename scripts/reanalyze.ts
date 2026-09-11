/**
 * AI 分析をやり直す（取材依頼文のテーマを変えたときなど）。
 *
 *   npm run reanalyze                          … 対象と概算費用を表示するだけ
 *   npm run reanalyze -- --apply               … 分析ジョブを投入する
 *   npm run reanalyze -- --limit 5 --apply     … 5社だけ試す
 *   npm run reanalyze -- --prefecture 京都府 --apply
 *   npm run reanalyze -- --rank A --apply      … 営業ランクAだけ
 *
 * 文面の指示（プロンプト）を変えても、すでに保存済みの分析結果は変わらない。
 * 作り直したい企業の分析ジョブを投入するのがこのスクリプト。
 * 投入後は npm run jobs:run -- --drain で処理する。
 *
 * 1社あたり実費がかかるため、既定では投入しない（--apply が必要）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { enqueueAnalysisJob } from "../src/lib/jobs/enqueue";
import { getMonthlySpend } from "../src/lib/ai/pricing";
import { getOutreachConfig, outreachLabel, outreachMissingHint } from "../src/lib/config/outreach";
import { getEnv } from "../src/lib/config/env";

type Row = { id: string; company_name: string; prefecture: string | null; sales_priority_rank: string | null; has_outreach: boolean };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const apply = process.argv.includes("--apply");
const limit = Math.max(1, Number(arg("limit") ?? 50));
const prefecture = arg("prefecture");
const rank = arg("rank");

async function main() {
  const db = getDb();
  const outreach = getOutreachConfig();
  const env = getEnv();

  console.log(`文面の目的: ${outreachLabel(outreach.purpose)}`);
  if (!outreach.configured) {
    console.log(`⚠️ ${outreachMissingHint(outreach.purpose)}`);
    console.log("   このまま実行しても文面は作られません（分析結果だけが更新されます）。");
  } else if (outreach.purpose === "interview") {
    console.log(`取材テーマ: ${outreach.interviewTopic}`);
  }

  // 採用ページがある企業だけが分析対象（ANALYSIS_REQUIRE_RECRUIT_PAGE）
  const rows = await rawRows<Row>(
    db,
    sql`select id, company_name, prefecture, sales_priority_rank, has_outreach
        from company_overview
        where has_recruit_page = true
          and sales_contact_allowed <> 'false'
          ${prefecture ? sql`and prefecture = ${prefecture}` : sql``}
          ${rank ? sql`and sales_priority_rank = ${rank}` : sql``}
        order by sales_priority_score desc nulls last, created_at desc
        limit ${limit}`,
  );

  if (rows.length === 0) {
    console.log("\n対象の企業がありません（採用ページあり・営業可の企業が対象です）。");
    return;
  }

  // 実費の目安は当月の実績から出す（推測ではなく記録済みトークン数ベース）
  const spend = await getMonthlySpend(db);
  const perCompanyJpy = 14;
  console.log(`\n対象: ${rows.length}社`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.company_name}（${r.prefecture ?? "—"} / ランク ${r.sales_priority_rank ?? "—"} / 文面 ${r.has_outreach ? "あり" : "なし"}）`);
  }
  if (rows.length > 10) console.log(`  … 他 ${rows.length - 10}社`);

  console.log(`\n概算費用: 約${(rows.length * perCompanyJpy).toLocaleString()}円（1社 ${perCompanyJpy}円で計算）`);
  console.log(`当月の使用: ${Math.round(spend.jpy).toLocaleString()}円 / 上限 ${spend.budgetJpy.toLocaleString()}円（残り ${Math.round(spend.remainingJpy).toLocaleString()}円）`);
  if (spend.budgetJpy > 0 && rows.length * perCompanyJpy > spend.remainingJpy) {
    console.log("⚠️ 残り予算を超えます。上限に達した分は自動的に見送られます（AI_MONTHLY_BUDGET_JPY）。");
  }

  if (!apply) {
    console.log(`\n実行するには --apply を付けてください（例: npm run reanalyze -- --limit 5 --apply）`);
    return;
  }

  let queued = 0;
  for (const r of rows) {
    const result = await enqueueAnalysisJob(db, r.id, { priority: 50 });
    if (result.created) queued++;
  }
  console.log(`\n${queued}社の分析ジョブを投入しました（既に待機中のものは重複投入しません）。`);
  console.log(`次に実行: npm run jobs:run -- --drain`);
  if (env.DATA_MODE !== "live") console.log(`※ DATA_MODE=${env.DATA_MODE ?? "(未設定)"} のため、実APIは呼ばれません。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
