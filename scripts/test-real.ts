/**
 * 実企業テスト（Phase 3.5）。
 *
 *   npm run test:real -- --count 10 --prefecture 大阪府 --industry manufacturing
 *
 * 検索ジョブを1件作成し、完了するまでジョブランナーを回してから検証レポートを表示する。
 * DATA_MODE=live のときのみ実APIを使用する（mock でも動作確認用に実行可能）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { createSearchJob } from "../src/lib/jobs/enqueue";
import { processJobs } from "../src/lib/jobs/runner";
import { getSearchJobProgress } from "../src/lib/jobs/status";
import { getDataMode } from "../src/lib/config/env";
import { describeConditions } from "../src/lib/jobs/search-conditions";
import { reportVerification } from "./lib/verify-report";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const db = getDb();
  const count = Number(arg("count", "10"));
  const conditions = {
    prefecture: arg("prefecture", "大阪府"),
    city: arg("city"),
    industry: arg("industry", "manufacturing"),
    keyword: arg("keyword"),
    employeeMin: arg("employeeMin") ? Number(arg("employeeMin")) : undefined,
    employeeMax: arg("employeeMax") ? Number(arg("employeeMax")) : undefined,
    requestedCount: count,
    requireWebsite: process.argv.includes("--require-website"),
    requireRecruiting: false,
  };

  console.log("=== 実企業テスト ===");
  console.log(`DATA_MODE: ${getDataMode()}${getDataMode() === "mock" ? "（モックデータ。実企業テストには live が必要）" : ""}`);
  console.log(`条件: ${describeConditions(conditions)}\n`);

  const started = Date.now();
  const jobId = await createSearchJob(db, conditions, { name: `Phase3.5 実企業テスト ${count}社`, provider: getDataMode() === "live" ? "gbiz" : "mock" });
  console.log(`検索ジョブを作成: ${jobId}\n`);

  // 完了するまでジョブを処理（クロール・AI分析は1社ずつ順に進む）
  for (let pass = 1; pass <= 200; pass++) {
    const stats = await processJobs({ db, maxRuntimeMs: 55_000 });
    const p = await getSearchJobProgress(db, jobId);
    const line = `pass ${pass}: 登録 ${p?.job.registered_count ?? 0}/${count} · 新規 ${p?.job.new_count ?? 0} · 重複 ${p?.job.duplicate_count ?? 0} · クロール ${p?.crawl.completed ?? 0}/${p?.crawl.total ?? 0} · 分析 ${p?.analysis.completed ?? 0}/${p?.analysis.total ?? 0} · 失敗 ${(p?.crawl.failed ?? 0) + (p?.analysis.failed ?? 0)}`;
    console.log(line);
    if (p?.isFinished) break;
    if (stats.stoppedReason === "empty" && stats.searchSteps + stats.crawlJobs + stats.analysisJobs === 0) break;
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`\n処理時間: ${elapsed}秒\n`);
  await reportVerification(db, jobId);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
