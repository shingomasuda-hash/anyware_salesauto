"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";

export type LoginState = { error?: string; email?: string } | null;

/** メール + パスワードでログイン（Neon Auth）。成功時はセッション Cookie が設定され、next へ遷移 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (isAuthDisabled()) redirect("/");
  if (!hasNeonAuthConfig()) return { error: "Neon Auth が設定されていません（NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET）" };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください", email };

  const { error } = await getAuth().signIn.email({ email, password });
  if (error) {
    const msg = error.message ?? "";
    return { error: /invalid|credential|password|not found/i.test(msg) ? "メールアドレスまたはパスワードが正しくありません" : msg || "ログインに失敗しました", email };
  }
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
