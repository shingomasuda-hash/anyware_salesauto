import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isNeonDatabaseUrl } from "@/db";
import { checkRequiredSchema } from "@/db/required-columns";
import { getDataMode, getEnv, hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";
import { getDiscoveryConfig } from "@/lib/config/discovery";
import { getOutreachConfig } from "@/lib/config/outreach";

export const dynamic = "force-dynamic";

/** 秘密情報（URL・パスワード・トークン）をエラー文から除去 */
function sanitize(message: string): string {
  return message.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***").replace(/https?:\/\/\S+/gi, "https://***").slice(0, 300);
}

/**
 * 設定診断（ログイン不要・秘密情報は返さない）。
 * デプロイ直後に「どの設定が欠けているか」「DB に接続できるか」を確認するために使う。
 */
export async function GET() {
  const env = getEnv();
  const result: Record<string, unknown> = {
    ok: true,
    nodeEnv: env.NODE_ENV,
    dataMode: getDataMode(),
    authMode: isAuthDisabled() ? "disabled" : "neon",
    // 値は返さない（設定されているかどうかだけ）
    env: {
      DATABASE_URL: Boolean(env.DATABASE_URL),
      DATABASE_URL_isNeonHost: env.DATABASE_URL ? isNeonDatabaseUrl(env.DATABASE_URL) : false,
      NEON_AUTH_BASE_URL: Boolean(env.NEON_AUTH_BASE_URL),
      NEON_AUTH_COOKIE_SECRET: Boolean(env.NEON_AUTH_COOKIE_SECRET) && (env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= 32,
      ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
      GBIZ_API_KEY: Boolean(env.GBIZ_API_KEY),
      BRAVE_SEARCH_API_KEY: Boolean(env.BRAVE_SEARCH_API_KEY),
      GOOGLE_MAPS_API_KEY: Boolean(env.GOOGLE_MAPS_API_KEY),
      EDINET_API_KEY: Boolean(env.EDINET_API_KEY),
      CRON_SECRET: Boolean(env.CRON_SECRET),
      JOB_SECRET: Boolean(env.JOB_SECRET),
    },
    neonAuthConfigured: hasNeonAuthConfig(),
    // 探索と費用の設定（秘密ではない）
    discovery: {
      mode: getDiscoveryConfig().mode,
      providersAvailable: [Boolean(env.GBIZ_API_KEY) && "gbiz", Boolean(env.GOOGLE_MAPS_API_KEY) && "google_places", Boolean(env.BRAVE_SEARCH_API_KEY) && "web_search"].filter(Boolean),
    },
    ai: {
      monthlyBudgetJpy: env.AI_MONTHLY_BUDGET_JPY,
      maxContextChars: env.ANTHROPIC_MAX_CONTEXT_CHARS,
      effort: env.ANTHROPIC_EFFORT,
      requireRecruitSignal: env.ANALYSIS_REQUIRE_RECRUIT_SIGNAL,
    },
    // 取材テーマ等の本文は返さず、生成できる状態かだけを返す
    outreach: { purpose: getOutreachConfig().purpose, configured: getOutreachConfig().configured },
  };

  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    // テーブルの数ではなく「アプリが参照する列」を見る。
    // マイグレーションは一部だけ失敗することがあり、表の有無では検知できない。
    const schema = await checkRequiredSchema(db);
    result.db = {
      connected: true,
      migrated: schema.ok,
      missingColumns: schema.missingColumns,
      missingFunctions: schema.missingFunctions,
    };
    if (!schema.ok) result.ok = false;
  } catch (err) {
    result.ok = false;
    result.db = { connected: false, error: sanitize(err instanceof Error ? err.message : String(err)) };
  }
  if (!hasNeonAuthConfig() && !isAuthDisabled()) result.ok = false;

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
