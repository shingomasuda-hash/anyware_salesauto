import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Pool } from "pg";
import { requireEnv } from "@/lib/config/env";
import * as schema from "./schema";

/**
 * アプリ全体で使う Drizzle DB 型。
 * neon-http（本番 / Vercel）と node-postgres（ローカル Postgres / テスト）の共通スーパータイプ。
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | null = null;

/** DATABASE_URL が Neon のホストなら HTTP ドライバ、それ以外はローカル Postgres 用に node-postgres */
export function isNeonDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return /\.neon\.tech$|\.neon\.build$/i.test(host) || process.env.DB_DRIVER === "neon";
  } catch {
    return false;
  }
}

/**
 * DB クライアント（プロセス内で 1 つだけ生成）。
 * - Neon: @neondatabase/serverless の HTTP クエリ関数を使用。接続を保持しないため
 *   Vercel の Serverless / Edge でコネクションを無駄に消費しない。
 * - ローカル: pg Pool（max 5）。
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = String(requireEnv("DATABASE_URL"));
  if (isNeonDatabaseUrl(url)) {
    const client = neon(url);
    cached = drizzleNeonHttp(client, { schema }) as unknown as Db;
  } else {
    const pool = new Pool({ connectionString: url, max: 5 });
    cached = drizzleNodePg(pool, { schema }) as unknown as Db;
  }
  return cached;
}

/** 生 SQL を実行して行配列を返す（ドライバ差異を吸収） */
export async function rawRows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

export { schema };
export * from "./types";
