import { redirect } from "next/navigation";
import { isAuthDisabled } from "@/lib/config/env";
import { createSupabaseServerClient } from "./server";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/** 現在のユーザーを取得（未ログインなら null）。AUTH_MODE=disabled の場合はダミーユーザー */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isAuthDisabled()) {
    return { id: "00000000-0000-0000-0000-000000000000", email: "dev@local" };
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** ページ / Server Action の先頭で呼ぶ。未ログインは /login へ */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
