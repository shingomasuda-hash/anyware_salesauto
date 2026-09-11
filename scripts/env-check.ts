/**
 * Live 実行に必要な環境変数の充足チェック。
 *
 *   npm run env:check
 *
 * 値そのものは一切表示しない（設定有無・長さ・先頭種別のみ）。
 * DATA_MODE=live / DISCOVERY_MODE=hybrid で動かすために何が足りないかを一覧化する。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

type Need = "required" | "recommended" | "optional";

interface Spec {
  name: string;
  need: Need;
  purpose: string;
  /** 期待値（値ではなく設定内容そのものが仕様の変数のみ表示する） */
  expected?: string;
  /** 値を表示してよい非機密変数か */
  showValue?: boolean;
  /** 未設定でも動作する場合の既定の挙動 */
  fallback?: string;
}

const SPECS: Spec[] = [
  { name: "DATABASE_URL", need: "required", purpose: "Neon PostgreSQL 接続（サーバー専用）" },
  { name: "GBIZ_API_KEY", need: "required", purpose: "GビズINFO（法人番号の Source of Truth）" },
  { name: "ANTHROPIC_API_KEY", need: "required", purpose: "Claude による企業分析" },
  { name: "ANTHROPIC_MODEL", need: "recommended", purpose: "使用モデル", expected: "claude-opus-5", showValue: true },
  { name: "GOOGLE_MAPS_API_KEY", need: "recommended", purpose: "Google Places（地域企業の発見）" },
  { name: "BRAVE_SEARCH_API_KEY", need: "recommended", purpose: "Web検索（取りこぼしの補完）" },
  { name: "EDINET_API_KEY", need: "optional", purpose: "EDINET（上場企業の裏付け）" },
  { name: "DATA_MODE", need: "required", purpose: "実APIを使うか", expected: "live", showValue: true },
  {
    name: "DISCOVERY_MODE",
    need: "recommended",
    purpose: "使用する情報源",
    expected: "hybrid",
    showValue: true,
    fallback: "未設定でも既定の hybrid で動作します（明示設定を推奨）",
  },
  {
    name: "AI_MONTHLY_BUDGET_JPY",
    need: "recommended",
    purpose: "当月のAI費用の上限（円）。到達するとAI分析を自動で見送る",
    showValue: true,
    fallback: "未設定でも既定の 10000円 で動作します",
  },
  {
    name: "ANALYSIS_REQUIRE_RECRUIT_PAGE",
    need: "recommended",
    purpose: "採用ページのある企業だけAI分析する（費用の大半を決める）",
    expected: "true",
    showValue: true,
    fallback: "未設定でも既定の true で動作します",
  },
  // Live Test を成立させるために併せて必要なもの
  { name: "NEON_AUTH_BASE_URL", need: "recommended", purpose: "管理画面のログイン" },
  { name: "NEON_AUTH_COOKIE_SECRET", need: "recommended", purpose: "セッション Cookie 署名" },
];

/** 値を出さずに「設定されているか」だけを表す */
function describe(spec: Spec): { set: boolean; detail: string } {
  const raw = process.env[spec.name];
  const value = (raw ?? "").trim();
  if (!value) return { set: false, detail: spec.fallback ? `未設定 → ${spec.fallback}` : "未設定" };
  if (spec.showValue) {
    const ok = spec.expected ? value === spec.expected : true;
    return { set: true, detail: ok ? `${value}` : `${value}（期待値: ${spec.expected}）` };
  }
  // 機密値は長さのみ。先頭・末尾も出さない
  return { set: true, detail: `設定済み（${value.length}文字）` };
}

function main() {
  console.log("=== Live 実行に必要な環境変数 ===");
  console.log("※ 機密値は表示しません（設定有無と文字数のみ）\n");

  const missing: Spec[] = [];
  const mismatched: Spec[] = [];

  for (const spec of SPECS) {
    const { set, detail } = describe(spec);
    const expectedOk = !spec.expected || !set || (process.env[spec.name] ?? "").trim() === spec.expected;
    const mark = !set ? (spec.need === "required" ? "❌" : spec.need === "recommended" ? "⚠️ " : "⏭️ ") : expectedOk ? "✅" : "⚠️ ";
    const label = spec.need === "required" ? "必須" : spec.need === "recommended" ? "推奨" : "任意";
    console.log(`${mark} ${spec.name.padEnd(26)} [${label}] ${detail}  — ${spec.purpose}`);
    if (!set) missing.push(spec);
    else if (!expectedOk) mismatched.push(spec);
  }

  const missingRequired = missing.filter((m) => m.need === "required");
  const missingRecommended = missing.filter((m) => m.need === "recommended");
  const missingOptional = missing.filter((m) => m.need === "optional");

  console.log("\n=== 不足一覧 ===");
  if (missingRequired.length === 0 && missingRecommended.length === 0 && missingOptional.length === 0 && mismatched.length === 0) {
    console.log("不足なし。Live Test を開始できます。");
  }
  if (missingRequired.length > 0) {
    console.log(`\n[必須・未設定 ${missingRequired.length}件] これが揃うまで Live 実行できません:`);
    for (const m of missingRequired) console.log(`  - ${m.name}（${m.purpose}）`);
  }
  if (missingRecommended.length > 0) {
    console.log(`\n[推奨・未設定 ${missingRecommended.length}件] 無くても動作しますが精度・網羅性が落ちます:`);
    for (const m of missingRecommended) console.log(`  - ${m.name}（${m.purpose}）${m.fallback ? ` ※${m.fallback}` : ""}`);
  }
  if (missingOptional.length > 0) {
    console.log(`\n[任意・未設定 ${missingOptional.length}件]:`);
    for (const m of missingOptional) console.log(`  - ${m.name}（${m.purpose}）`);
  }
  if (mismatched.length > 0) {
    console.log(`\n[値の見直しが必要 ${mismatched.length}件]:`);
    for (const m of mismatched) console.log(`  - ${m.name}: 期待値 ${m.expected}`);
  }

  console.log("\n=== Multi-Source Discovery の成立条件 ===");
  const hasGbiz = Boolean((process.env.GBIZ_API_KEY ?? "").trim());
  const hasPlaces = Boolean((process.env.GOOGLE_MAPS_API_KEY ?? "").trim());
  const hasBrave = Boolean((process.env.BRAVE_SEARCH_API_KEY ?? "").trim());
  const sourceCount = [hasGbiz, hasPlaces, hasBrave].filter(Boolean).length;
  console.log(`発見に使える情報源: ${sourceCount}種（GビズINFO=${hasGbiz ? "有" : "無"} / Places=${hasPlaces ? "有" : "無"} / Web検索=${hasBrave ? "有" : "無"}）`);
  if (sourceCount <= 1) {
    console.log("⚠️  情報源が1種以下です。複数ソースでの突き合わせができないため、");
    console.log("    要確認（needs_review）が増え、Multi-Source 化の効果を測れません。");
  }

  if (missingRequired.length > 0) process.exitCode = 1;
}

main();
