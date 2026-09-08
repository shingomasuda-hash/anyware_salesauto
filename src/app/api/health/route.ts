import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isNeonDatabaseUrl, rawRows } from "@/db";
import { getDataMode, getEnv, hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";

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
    env: {
      DATABASE_URL: Boolean(env.DATABASE_URL),
      DATABASE_URL_isNeonHost: env.DATABASE_URL ? isNeonDatabaseUrl(env.DATABASE_URL) : false,
      NEON_AUTH_BASE_URL: Boolean(env.NEON_AUTH_BASE_URL),
      NEON_AUTH_COOKIE_SECRET: Boolean(env.NEON_AUTH_COOKIE_SECRET) && (env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= 32,
      ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
      GBIZ_API_KEY: Boolean(env.GBIZ_API_KEY),
      CRON_SECRET: Boolean(env.CRON_SECRET),
      JOB_SECRET: Boolean(env.JOB_SECRET),
    },
    neonAuthConfigured: hasNeonAuthConfig(),
  };

  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const tables = await rawRows<{ count: number | string }>(db, sql`select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name in ('companies','company_analysis','search_jobs','crawl_jobs','analysis_jobs')`);
    const functions = await rawRows<{ count: number | string }>(db, sql`select count(*)::int as count from pg_proc where pronamespace = 'public'::regnamespace and proname in ('claim_job','dashboard_stats','increment_search_job_counters')`);
    const views = await rawRows<{ count: number | string }>(db, sql`select count(*)::int as count from information_schema.views where table_schema = 'public' and table_name = 'company_overview'`);
    result.db = {
      connected: true,
      coreTables: Number(tables[0]?.count ?? 0),
      functions: Number(functions[0]?.count ?? 0),
      overviewView: Number(views[0]?.count ?? 0) === 1,
      migrated: Number(tables[0]?.count ?? 0) === 5 && Number(functions[0]?.count ?? 0) === 3 && Number(views[0]?.count ?? 0) === 1,
    };
    if (!(result.db as { migrated: boolean }).migrated) result.ok = false;
  } catch (err) {
    result.ok = false;
    result.db = { connected: false, error: sanitize(err instanceof Error ? err.message : String(err)) };
  }
  if (!hasNeonAuthConfig() && !isAuthDisabled()) result.ok = false;

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
