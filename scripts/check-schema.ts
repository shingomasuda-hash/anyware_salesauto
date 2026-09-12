/**
 * DB のスキーマがコードの期待と一致しているか確認する。
 *
 *   npm run db:verify
 *
 * マイグレーションが失敗してもツールが黙って終わることがあり、
 * 画面を開いて初めて「column does not exist」で気づくことになる。
 * db:migrate の直後にこれを実行すれば、その場で分かる。
 *
 * 期待する列の定義は src/db/required-columns.ts（/api/health と統合テストも同じものを見る）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { checkRequiredSchema, REQUIRED_COLUMNS, REQUIRED_FUNCTIONS } from "../src/db/required-columns";

async function main() {
  const result = await checkRequiredSchema(getDb());

  console.log("=== スキーマ確認 ===\n");
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const missing = result.missingColumns[table];
    if (!missing) console.log(`✅ ${table}（${columns.length}列）`);
    else console.log(`❌ ${table}: 不足 ${missing.join(", ")}`);
  }
  if (result.missingFunctions.length === 0) console.log(`✅ 関数（${REQUIRED_FUNCTIONS.length}個）`);
  else console.log(`❌ 関数: 不足 ${result.missingFunctions.join(", ")}`);

  if (!result.ok) {
    console.log("\nマイグレーションが適用されていません。");
    console.log("npm run db:migrate を実行し、エラーが出ていないか確認してください。");
    process.exit(1);
  }
  console.log("\nすべて一致しています。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
