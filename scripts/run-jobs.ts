/**
 * ローカル開発用ジョブランナー。
 * Vercel Cron が無い環境で `npm run jobs:run` を起動しておくと、キューを継続的に処理する。
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { processJobs } from "../src/lib/jobs/runner";

const INTERVAL_MS = Number(process.env.JOB_RUNNER_INTERVAL_MS ?? 5000);
const once = process.argv.includes("--once");

async function main() {
  console.log(`[jobs] runner started (DATA_MODE=${process.env.DATA_MODE ?? "(default)"}, interval=${INTERVAL_MS}ms)`);
  for (;;) {
    try {
      const stats = await processJobs({ maxRuntimeMs: 55_000 });
      if (stats.searchSteps + stats.crawlJobs + stats.analysisJobs > 0) {
        console.log(`[jobs] search=${stats.searchSteps} crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures} (${stats.durationMs}ms)`);
      }
    } catch (err) {
      console.error("[jobs] error", err);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().then(() => process.exit(0));
