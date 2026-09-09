/**
 * 開発用シード。
 * DATA_MODE=mock で「大阪府 / 製造業 / 20社」の検索ジョブを作成し、完了まで処理する。
 * ログインユーザーは Neon Console の Auth > Users から作成してください（AUTH_MODE=disabled なら不要）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { createSearchJob } from "../src/lib/jobs/enqueue";
import { processJobs } from "../src/lib/jobs/runner";
import { getDataMode } from "../src/lib/config/env";

async function main() {
  const db = getDb();
  if (getDataMode() !== "mock") {
    console.log("[seed] DATA_MODE=mock ではないため検索シードはスキップします（実API を消費しないため）");
    return;
  }
  const jobId = await createSearchJob(db, { prefecture: "大阪府", industry: "manufacturing", employeeMin: 20, employeeMax: 300, requestedCount: 20 }, { name: "大阪府 / 製造業 / 20社 (seed)", provider: "mock" });
  console.log(`[seed] search job created: ${jobId}`);
  for (let i = 0; i < 30; i++) {
    const stats = await processJobs({ db, maxRuntimeMs: 55_000 });
    console.log(`[seed] pass ${i + 1}: discovery=${stats.discoverySteps} search=${stats.searchSteps} crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures}`);
    if (stats.stoppedReason === "empty") break;
  }
  console.log("[seed] done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
