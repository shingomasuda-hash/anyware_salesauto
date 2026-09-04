import { redirect } from "next/navigation";
import { hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";
import { getAuth } from "./server";

export interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
}

/** 現在のユーザーを取得（未ログインなら null）。AUTH_MODE=disabled（開発時）はダミーユーザー */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isAuthDisabled()) {
    return { id: "dev-user", email: "dev@local", name: "Developer" };
  }
  if (!hasNeonAuthConfig()) return null;
  try {
    const { data } = await getAuth().getSession();
    if (!data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, name: data.user.name ?? null };
  } catch (err) {
    console.error("[auth] getSession failed", err);
    return null;
  }
}

/** ページ / Server Action / Route Handler の先頭で呼ぶ。未ログインは /login へ */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
