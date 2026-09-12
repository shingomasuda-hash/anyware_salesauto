/**
 * 保守用のコマンドを1本にまとめたもの。
 *
 *   npm run maintain             … 何が起きるかを表示するだけ（DBは変更しない）
 *   npm run maintain -- --apply  … 実際に直して、キューを処理しきる
 *
 * これまで db:verify / db:repair-candidates / db:dedupe-sources / db:recheck-sites /
 * recrawl / jobs:run を手で順番に打つ必要があり、順番を間違えると
 * 「不適切なURLのまま再クロールする」といった無駄が起きていた。
 * 正しい順番はここに固定する。個別のスクリプトは今までどおり単体でも使える。
 *
 * 各ステップは既存スクリプトをそのまま呼ぶ。条件を書き写すと食い違うため、
 * 処理の実体は1か所にしか置かない。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { MAINTENANCE_STEPS } from "../src/lib/maintenance/steps";

const apply = process.argv.includes("--apply");
const skipJobs = process.argv.includes("--no-jobs");

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", path.join("scripts", script), ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log(apply ? "保守処理を実行します（--apply）。" : "保守処理の確認だけを行います（DBは変更しません）。");
  if (!apply) console.log("実際に直すには --apply を付けてください: npm run maintain -- --apply");

  const results: { title: string; status: string }[] = [];

  for (const [i, step] of MAINTENANCE_STEPS.entries()) {
    if (step.applyOnly && !apply) {
      results.push({ title: step.title, status: "スキップ（--apply 時のみ）" });
      continue;
    }
    if (step.applyOnly && skipJobs) {
      results.push({ title: step.title, status: "スキップ（--no-jobs）" });
      continue;
    }
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${i + 1}/${MAINTENANCE_STEPS.length}] ${step.title}`);
    console.log("=".repeat(60));

    const args = [...step.args, ...(apply ? (step.applyArgs ?? []) : [])];
    const code = await run(step.script, args);

    if (code !== 0) {
      results.push({ title: step.title, status: `失敗（終了コード ${code}）` });
      if (step.required) {
        console.log(`\n${step.title} に失敗したため中止します。`);
        console.log("先に npm run db:migrate を実行してください。");
        break;
      }
      continue;
    }
    results.push({ title: step.title, status: apply ? "完了" : "確認のみ" });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("まとめ");
  console.log("=".repeat(60));
  for (const r of results) console.log(`  ${r.status.startsWith("失敗") ? "✗" : "✓"} ${r.title} … ${r.status}`);

  if (!apply) {
    console.log("\n実行するには: npm run maintain -- --apply");
  } else {
    console.log("\n一覧を確認してください: npm run dev → http://localhost:3000/companies");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
