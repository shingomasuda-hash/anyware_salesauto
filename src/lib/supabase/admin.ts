import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/config/env";
import type { Database } from "@/lib/db/types";

export type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

/**
 * service_role を使う管理クライアント。RLS をバイパスするため
 * バックグラウンドジョブ / Cron / ログ書き込みなどサーバー内部処理でのみ使用する。
 * 絶対にクライアントへ渡さないこと。
 */
export function createSupabaseAdminClient(): AdminClient {
  if (cached) return cached;
  cached = createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
