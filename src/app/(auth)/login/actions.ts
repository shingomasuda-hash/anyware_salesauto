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

  let result: { error?: { message?: string; status?: number; code?: string } | null };
  try {
    result = await getAuth().signIn.email({ email, password });
  } catch (err) {
    console.error("[auth] signIn.email threw", err);
    return { error: `Neon Auth への接続に失敗しました: ${err instanceof Error ? err.message : String(err)}`, email };
  }
  if (result.error) {
    const msg = result.error.message ?? "";
    console.error("[auth] signIn.email failed", { status: result.error.status, code: result.error.code, message: msg });
    if (/invalid (email|password|credential)|invalid_email_or_password|user not found|incorrect/i.test(msg) || result.error.code === "INVALID_EMAIL_OR_PASSWORD") {
      return { error: "メールアドレスまたはパスワードが正しくありません", email };
    }
    if (/verif/i.test(msg) || result.error.code === "EMAIL_NOT_VERIFIED") {
      return { error: "メールアドレスが未確認です。Neon Console → Auth → Configuration でメール確認の必須設定をオフにするか、確認メールの手続きを行ってください。", email };
    }
    return { error: `ログインに失敗しました（${result.error.status ?? "-"} ${result.error.code ?? ""}）: ${msg || "不明なエラー"}`, email };
  }
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
