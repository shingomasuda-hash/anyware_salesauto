/**
 * 実行済みの探索ラン（discovery_runs）の検証レポートを表示する。
 *
 *   npm run discovery:verify                 … 直近のランを検証
 *   npm run discovery:verify -- --run <id>   … ランIDを指定
 *
 * 企業ごとの取得結果・精度指標・Provider別貢献・安全設計の検査を出力する。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { listDiscoveryRuns } from "../src/db/repositories/discovery";
import { reportDiscoveryRun } from "./lib/discovery-report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  let runId = arg("run");
  if (!runId) {
    const runs = await listDiscoveryRuns(db, 1);
    if (runs.length === 0) throw new Error("探索ランがありません。先に npm run discovery を実行してください");
    runId = runs[0].id;
    console.log(`（直近の探索ランを検証します: ${runs[0].name ?? runId}）`);
  }
  await reportDiscoveryRun(db, runId);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
