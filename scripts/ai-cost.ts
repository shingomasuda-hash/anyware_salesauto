/**
 * Claude API の実際の使用量と費用を、記録済みのログから集計する。
 *
 *   npm run ai:cost                  … これまでの全期間
 *   npm run ai:cost -- --days 1      … 直近1日
 *   npm run ai:cost -- --project 50  … 50社実行したときの費用を実績から予測
 *
 * 推測ではなく ai_usage_logs に記録した実トークン数から算出する。
 * 請求の正はあくまで Anthropic Console の Billing。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";

/**
 * 公開されている100万トークンあたりの単価（USD）。
 * キャッシュ書き込みは入力の1.25倍、読み込みは0.1倍。
 */
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// rawRows の型制約を満たすため interface ではなく type を使う
type UsageRow = {
  model: string;
  calls: number | string;
  ok: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_read_tokens: number | string;
  cache_creation_tokens: number | string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const usd = (v: number) => `$${v.toFixed(2)}`;

function costOf(row: UsageRow): { total: number; known: boolean } {
  const rate = RATES[row.model];
  if (!rate) return { total: 0, known: false };
  const perToken = (tokens: number, perMillion: number) => (tokens / 1_000_000) * perMillion;
  const total =
    perToken(n(row.input_tokens), rate.input) +
    perToken(n(row.output_tokens), rate.output) +
    perToken(n(row.cache_creation_tokens), rate.input * CACHE_WRITE_MULTIPLIER) +
    perToken(n(row.cache_read_tokens), rate.input * CACHE_READ_MULTIPLIER);
  return { total, known: true };
}

async function main() {
  const db = getDb();
  const days = arg("days") ? Number(arg("days")) : null;
  const project = arg("project") ? Number(arg("project")) : null;

  const where = days ? sql`where created_at >= now() - (${days} || ' days')::interval` : sql``;
  const rows = await rawRows<UsageRow>(
    db,
    sql`select model,
               count(*) as calls,
               count(*) filter (where success) as ok,
               sum(input_tokens) as input_tokens,
               sum(output_tokens) as output_tokens,
               sum(cache_read_tokens) as cache_read_tokens,
               sum(cache_creation_tokens) as cache_creation_tokens
        from ai_usage_logs ${where}
        group by model`,
  );

  console.log(`=== Claude API 使用量${days ? `（直近${days}日）` : "（全期間）"} ===\n`);
  if (rows.length === 0) {
    console.log("記録がありません。DATA_MODE=live でAI分析を実行すると記録されます。");
    return;
  }

  let grandTotal = 0;
  let totalOk = 0;
  let unknownModel = false;

  for (const row of rows) {
    const { total, known } = costOf(row);
    grandTotal += total;
    totalOk += n(row.ok);
    if (!known) unknownModel = true;

    console.log(`モデル: ${row.model}${known ? "" : "（単価不明のため費用は未計上）"}`);
    console.log(`  呼び出し   : ${n(row.calls)}回（成功 ${n(row.ok)}回）`);
    console.log(`  入力       : ${n(row.input_tokens).toLocaleString()} トークン`);
    console.log(`  出力       : ${n(row.output_tokens).toLocaleString()} トークン`);
    console.log(`  キャッシュ : 読み込み ${n(row.cache_read_tokens).toLocaleString()} / 書き込み ${n(row.cache_creation_tokens).toLocaleString()}`);
    if (known) console.log(`  費用       : ${usd(total)}`);
    console.log("");
  }

  console.log(`合計費用     : ${usd(grandTotal)}`);
  if (totalOk > 0) {
    const perCompany = grandTotal / totalOk;
    console.log(`1社あたり    : ${usd(perCompany)}（分析成功 ${totalOk}社の平均）`);
    if (project) {
      console.log(`\n${project}社を分析した場合の予測: ${usd(perCompany * project)}`);
      console.log(`  ※ 実際には公式サイトを確認できず分析に至らない企業があるため、これより安くなります`);
    }
  }
  if (unknownModel) console.log("\n※ 単価が未登録のモデルがあります（scripts/ai-cost.ts の RATES に追加してください）");
  console.log("\n※ 上記は公開単価からの概算です。請求の正は Anthropic Console の Billing を確認してください。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
