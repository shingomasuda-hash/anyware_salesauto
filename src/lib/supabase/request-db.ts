import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isAuthDisabled } from "@/lib/config/env";
import { createSupabaseAdminClient } from "./admin";
import { createSupabaseServerClient } from "./server";

/**
 * 画面表示用の DB クライアント。
 * 通常はログインユーザーのセッション（RLS 適用）。AUTH_MODE=disabled の開発時のみ service_role。
 */
export async function getRequestDb(): Promise<SupabaseClient<Database>> {
  if (isAuthDisabled()) return createSupabaseAdminClient();
  return createSupabaseServerClient();
}
