import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getEnv, hasNeonAuthConfig } from "@/lib/config/env";

let cached: NeonAuth | null = null;

/**
 * Neon Auth サーバーインスタンス（Server Components / Server Actions / Route Handlers / proxy 用）。
 * - `.handler()`  : /api/auth/[...path] のルートハンドラ
 * - `.middleware()`: 未ログインリダイレクト
 * - `.getSession()` / `.signIn.email()` / `.signOut()` など
 * 環境変数が未設定の場合は呼び出し時にエラー（AUTH_MODE=disabled の開発時は呼ばれない）。
 */
export function getAuth(): NeonAuth {
  if (cached) return cached;
  if (!hasNeonAuthConfig()) {
    throw new Error("NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET（32文字以上）が設定されていません。.env.local を確認してください。");
  }
  const env = getEnv();
  cached = createNeonAuth({
    baseUrl: env.NEON_AUTH_BASE_URL!,
    cookies: {
      secret: env.NEON_AUTH_COOKIE_SECRET!,
      sessionDataTtl: 300,
    },
  });
  return cached;
}
