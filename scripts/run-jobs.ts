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

/** 接続できない・応答しない類のエラーか（コードの誤りではなく通信の問題） */
function isConnectionError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Connection error|Connection terminated/i.test(text);
}

/** 長いスタックトレースを出さず、原因が分かる1行にする */
function shortError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `${err.message.split("\n")[0]}${cause}`.slice(0, 300);
}

/** 連続でこの回数失敗したら諦める（同じエラーを出し続けない） */
const MAX_CONSECUTIVE_FAILURES = 5;

async function main() {
  const mode = once ? "1周のみ" : drain ? "キューが空になるまで" : `常駐（${INTERVAL_MS}ms 間隔・Ctrl+C で終了）`;
  console.log(`[jobs] runner started (DATA_MODE=${process.env.DATA_MODE ?? "(default)"}, ${mode})`);
  let consecutiveFailures = 0;
  for (;;) {
    let drained = false;
    try {
      const stats = await processJobs({ maxRuntimeMs: 55_000 });
      consecutiveFailures = 0;
      drained = stats.stoppedReason === "empty";
      if (stats.discoverySteps + stats.searchSteps + stats.crawlJobs + stats.analysisJobs > 0) {
        console.log(`[jobs] discovery=${stats.discoverySteps} search=${stats.searchSteps} crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures} (${stats.durationMs}ms)`);
      }
    } catch (err) {
      consecutiveFailures += 1;
      // 同じ接続エラーで巨大なスタックトレースを何十回も出すと、
      // 本当に見たいログが流れてしまう。1行にまとめる。
      const connection = isConnectionError(err);
      console.error(`[jobs] ${connection ? "接続できません" : "エラー"}（${consecutiveFailures}回目）: ${shortError(err)}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n[jobs] ${MAX_CONSECUTIVE_FAILURES}回続けて失敗したため終了します。`);
        if (connection) {
          console.error("データベースに接続できていません。ネットワークと Neon の状態を確認してください。");
          console.error("処理済みの分は保存されています。復旧後にもう一度実行すれば、残りから再開します。");
        }
        break;
      }
      if (connection) {
        // 相手が落ちているときに叩き続けない
        const backoff = Math.min(30_000, INTERVAL_MS * 2 ** consecutiveFailures);
        console.error(`  ${Math.round(backoff / 1000)}秒待って再試行します。`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
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
