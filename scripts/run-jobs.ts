/**
 * ローカル開発用ジョブランナー。
 *
 *   npm run jobs:run            … 常駐して処理し続ける（止めるときは Ctrl+C）
 *   npm run jobs:run -- --drain … キューが空になったら終了する
 *   npm run jobs:run -- --once  … 1周だけ処理して終了する
 *
 * Vercel Cron が無い環境で常駐させておくと、キューを継続的に処理する。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { processJobs } from "../src/lib/jobs/runner";

const INTERVAL_MS = Number(process.env.JOB_RUNNER_INTERVAL_MS ?? 5000);
const once = process.argv.includes("--once");
/** 残ジョブを処理しきったら終了する（検証レポートの前に使う） */
const drain = process.argv.includes("--drain");

async function main() {
  const mode = once ? "1周のみ" : drain ? "キューが空になるまで" : `常駐（${INTERVAL_MS}ms 間隔・Ctrl+C で終了）`;
  console.log(`[jobs] runner started (DATA_MODE=${process.env.DATA_MODE ?? "(default)"}, ${mode})`);
  for (;;) {
    let drained = false;
    try {
      const stats = await processJobs({ maxRuntimeMs: 55_000 });
      drained = stats.stoppedReason === "empty";
      if (stats.discoverySteps + stats.searchSteps + stats.crawlJobs + stats.analysisJobs > 0) {
        console.log(`[jobs] discovery=${stats.discoverySteps} search=${stats.searchSteps} crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures} (${stats.durationMs}ms)`);
      }
    } catch (err) {
      console.error("[jobs] error", err);
    }
    if (once) break;
    if (drain && drained) {
      console.log("[jobs] 残ジョブはありません。終了します。");
      break;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().then(() => process.exit(0));
