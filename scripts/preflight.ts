/**
 * 実API接続の事前診断。
 *
 *   npm run preflight
 *
 * DATABASE_URL / Claude / GビズINFO / Google Places / Brave Search / EDINET に最小リクエストを1回ずつ行い、
 * 「キーが有効か」「応答形式が想定どおりか」を確認する。
 * 秘密情報（キー・接続文字列）は一切表示しない。Claude はトークンを消費しない Models API を使う。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { getDb, isNeonDatabaseUrl, rawRows } from "../src/db";
import { getAiConfig } from "../src/lib/config/ai";
import { getDataMode, getEnv } from "../src/lib/config/env";
import { GbizClient } from "../src/lib/integrations/gbiz/client";
import { getDiscoveryConfig } from "../src/lib/config/discovery";
import { getProviderAvailability } from "../src/lib/discovery/providers";
import { PROVIDER_LABELS } from "../src/lib/discovery/criteria";

type Status = "OK" | "NG" | "SKIP";
const results: { name: string; status: Status; detail: string }[] = [];

function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  const mark = status === "OK" ? "✅" : status === "NG" ? "❌" : "⏭️";
  console.log(`${mark} ${name}: ${detail}`);
}

/** 秘密情報がエラー文に混ざらないようにしつつ、原因（cause）まで含める */
function safe(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 3 && current; i++) {
    const msg = current instanceof Error ? current.message : String(current);
    if (msg && !parts.includes(msg)) parts.push(msg);
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts
    .join(" / ")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function checkDatabase() {
  const env = getEnv();
  if (!env.DATABASE_URL) return record("DATABASE_URL", "NG", "未設定");
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const rows = await rawRows<{ tables: number | string; funcs: number | string }>(
      db,
      sql`select
            (select count(*) from information_schema.tables where table_schema='public' and table_name in ('companies','company_analysis','search_jobs','crawl_jobs','analysis_jobs','discovery_runs','discovery_candidates','company_sources'))::int as tables,
            (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_job','dashboard_stats','increment_search_job_counters'))::int as funcs`,
    );
    const tables = Number(rows[0]?.tables ?? 0);
    const funcs = Number(rows[0]?.funcs ?? 0);
    const driver = isNeonDatabaseUrl(env.DATABASE_URL) ? "Neon HTTP" : "node-postgres";
    if (tables === 8 && funcs === 3) record("DATABASE_URL", "OK", `接続成功（${driver}）・マイグレーション適用済み`);
    else record("DATABASE_URL", "NG", `接続はできたがマイグレーション未完了（テーブル ${tables}/8・関数 ${funcs}/3）。npm run db:migrate を実行してください`);
  } catch (err) {
    record("DATABASE_URL", "NG", `接続失敗: ${safe(err)}`);
  }
}

async function checkAnthropic() {
  const env = getEnv();
  const cfg = getAiConfig();
  if (!env.ANTHROPIC_API_KEY) return record("ANTHROPIC_API_KEY", "NG", "未設定（DATA_MODE=live では必須）");
  try {
    // Models API はトークンを消費しない。キーの有効性とモデル名の存在を同時に確認できる。
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 30_000 });
    const model = await client.models.retrieve(cfg.model);
    record("ANTHROPIC_API_KEY", "OK", `キー有効・モデル利用可: ${model.id}`);
  } catch (err) {
    const msg = safe(err);
    if (/401|authentication/i.test(msg)) record("ANTHROPIC_API_KEY", "NG", "キーが無効です（401）");
    else if (/404|not_found/i.test(msg)) record("ANTHROPIC_API_KEY", "NG", `モデル名 ${cfg.model} が見つかりません。ANTHROPIC_MODEL を確認してください`);
    else record("ANTHROPIC_API_KEY", "NG", msg);
  }
}

async function checkGbiz() {
  const env = getEnv();
  if (!env.GBIZ_API_KEY) return record("GBIZ_API_KEY", "NG", "未設定（DATA_MODE=live では必須）");
  try {
    const client = new GbizClient(env.GBIZ_API_KEY);
    const page = await client.search({ prefecture: "大阪府", requestedCount: 1 }, 1, 1);
    const sample = page.items[0];
    if (!sample) {
      return record("GBIZ_API_KEY", "NG", "認証は通りましたが企業を1件も取得できませんでした（条件またはAPI仕様を確認してください）");
    }
    const fields = Object.keys(sample).filter((k) => sample[k as keyof typeof sample] !== null).slice(0, 8).join(", ");
    // totalCount は API が返さない場合があるため、実際に取得できた件数を主に報告する
    const total = page.totalCount > 0 ? `総件数 ${page.totalCount}` : "総件数の申告なし（APIが返さないため件数上限は使いません）";
    record("GBIZ_API_KEY", "OK", `検索成功（取得 ${page.items.length}件 / ${total}）。取得できた項目例: ${fields}`);
    if (sample && !sample.company_url) {
      console.log("   ℹ️ 1件目に company_url がありません。URL 未登録の法人は Google Places で公式サイトを探索します（GOOGLE_MAPS_API_KEY 推奨）");
    }
  } catch (err) {
    record("GBIZ_API_KEY", "NG", safe(err));
  }
}

async function checkGooglePlaces() {
  const env = getEnv();
  if (!env.GOOGLE_MAPS_API_KEY) return record("GOOGLE_MAPS_API_KEY", "SKIP", "未設定（任意。地域企業の発見・公式サイト探索の補助）");
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: "大阪 製造業", languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return record("GOOGLE_MAPS_API_KEY", "NG", `HTTP ${res.status} ${text.replace(/key=[^&"]+/gi, "key=***").slice(0, 150)}`);
    }
    const json = (await res.json()) as { places?: unknown[] };
    record("GOOGLE_MAPS_API_KEY", "OK", `Places API 応答あり（${json.places?.length ?? 0}件）`);
  } catch (err) {
    record("GOOGLE_MAPS_API_KEY", "NG", safe(err));
  }
}

async function checkBraveSearch() {
  const env = getEnv();
  if (!env.BRAVE_SEARCH_API_KEY) return record("BRAVE_SEARCH_API_KEY", "SKIP", "未設定（任意。Web検索での企業発見に使用）");
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", "大阪府 金属加工 製造");
    url.searchParams.set("count", "1");
    url.searchParams.set("country", "JP");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return record("BRAVE_SEARCH_API_KEY", "NG", `HTTP ${res.status} ${text.slice(0, 150)}`);
    }
    const json = (await res.json()) as { web?: { results?: unknown[] } };
    record("BRAVE_SEARCH_API_KEY", "OK", `検索成功（${json.web?.results?.length ?? 0}件）`);
  } catch (err) {
    record("BRAVE_SEARCH_API_KEY", "NG", safe(err));
  }
}

async function checkEdinet() {
  const env = getEnv();
  if (!env.EDINET_API_KEY) return record("EDINET_API_KEY", "SKIP", "未設定（任意。上場企業の裏付けに使用）");
  try {
    const url = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
    url.searchParams.set("date", new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10));
    url.searchParams.set("type", "1");
    url.searchParams.set("Subscription-Key", env.EDINET_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return record("EDINET_API_KEY", "NG", `HTTP ${res.status}`);
    const json = (await res.json()) as { results?: unknown[] };
    record("EDINET_API_KEY", "OK", `一覧取得成功（${json.results?.length ?? 0}件）`);
  } catch (err) {
    record("EDINET_API_KEY", "NG", safe(err));
  }
}

/** 探索設定（DISCOVERY_MODE と Provider の利用可否）を表示する。秘密情報は出さない */
function checkDiscoveryConfig() {
  const cfg = getDiscoveryConfig();
  const availability = getProviderAvailability();
  const usable = availability.filter((a) => a.available).map((a) => PROVIDER_LABELS[a.name] ?? a.name);
  const status: Status = usable.length > 1 ? "OK" : usable.length === 1 ? "SKIP" : "NG";
  record("DISCOVERY_MODE", status, `${cfg.mode} / 利用できる情報源: ${usable.join(", ") || "なし"}`);
  for (const a of availability.filter((x) => !x.available)) {
    console.log(`   ℹ️ ${PROVIDER_LABELS[a.name] ?? a.name}: ${a.reason}`);
  }
  console.log(`   ℹ️ 本人確認しきい値: verified ${cfg.thresholds.verified}点 / needs_review ${cfg.thresholds.needsReview}点`);
  console.log(`   ℹ️ 1回の探索の上限: Provider ${cfg.budget.maxProviderRequests}回 / 候補 ${cfg.budget.maxCandidates}件 / 確認 ${cfg.budget.maxVerificationRequests}回 / ${cfg.budget.maxExecutionMinutes}分`);
}

/**
 * クローラーが外部サイトへ到達できるかを確認する。
 * 1 サイトだけで判定すると、そのサイトが Bot を弾いているだけの場合に
 * 「クロールできない」と誤判定するため、複数サイトで確認する。
 */
async function checkCrawlerEgress() {
  const targets = ["https://www.example.com/", "https://www.iij.ad.jp/robots.txt", "https://www.meti.go.jp/robots.txt"];
  const ua = getEnv().CRAWL_USER_AGENT;
  const results: { host: string; detail: string; ok: boolean }[] = [];

  for (const url of targets) {
    const host = new URL(url).host;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": ua } });
      results.push({ host, detail: `HTTP ${res.status}`, ok: res.ok });
    } catch (err) {
      results.push({ host, detail: safe(err), ok: false });
    }
  }

  const reachable = results.filter((r) => r.ok);
  if (reachable.length > 0) {
    record("外部サイトへの到達性", "OK", `${reachable.length}/${results.length} サイトに接続できました`);
    const blocked = results.filter((r) => !r.ok);
    if (blocked.length > 0) {
      console.log(`   ℹ️ 接続できなかったサイト: ${blocked.map((b) => `${b.host} (${b.detail})`).join(", ")}`);
      console.log("   ℹ️ 一部サイトが Bot を拒否するのは正常です。全滅でなければクロールは可能です");
    }
  } else {
    record("外部サイトへの到達性", "NG", `全 ${results.length} サイトに接続できません: ${results.map((r) => `${r.host}=${r.detail}`).join(", ")}`);
    console.log("   ℹ️ ネットワーク / プロキシ / VPN の設定を確認してください");
  }
}

async function main() {
  console.log("=== 実API接続の事前診断 ===");
  console.log(`DATA_MODE: ${getDataMode()}（live で実APIを使用）`);
  console.log(`ANTHROPIC_MODEL: ${getAiConfig().model}\n`);

  await checkDatabase();
  await checkAnthropic();
  await checkGbiz();
  await checkGooglePlaces();
  await checkBraveSearch();
  await checkEdinet();
  checkDiscoveryConfig();
  await checkCrawlerEgress();

  const ng = results.filter((r) => r.status === "NG");
  console.log("\n=== 結果 ===");
  if (getDataMode() !== "live") {
    console.log("⚠️ DATA_MODE が live ではありません。実企業テストの前に .env.local を DATA_MODE=live にしてください。");
  }
  if (ng.length === 0) {
    console.log("すべて OK。実企業テストを開始できます:");
    console.log("  npm run discovery -- --prefecture 大阪府 --industry manufacturing --count 20");
    console.log("  npm run test:real -- --count 10");
  } else {
    console.log(`${ng.length}件の問題があります。上記の NG を解消してから再実行してください。`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(safe(err));
  process.exit(1);
});
