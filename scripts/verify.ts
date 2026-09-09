/**
 * 保存済みデータの検証レポートのみを表示する（新規の取得は行わない）。
 *
 *   npm run verify                      # 全企業
 *   npm run verify -- --job <検索ジョブID>  # 特定の検索ジョブの企業のみ
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { reportVerification } from "./lib/verify-report";

const i = process.argv.indexOf("--job");
const jobId = i >= 0 ? process.argv[i + 1] : undefined;

reportVerification(getDb(), jobId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
