import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

/**
 * Neon Auth によるルート保護 + セッション更新。
 * - /login と /api/* は対象外（API は各ハンドラで認証 or secret を検証）
 * - AUTH_MODE=disabled（development のみ）では素通し
 * - Neon Auth 未設定時は /login で設定不備を案内する
 */
const PUBLIC_PREFIXES = ["/login", "/api/", "/auth/"]; // /api/health も含む（診断用・秘密情報なし）

export async function proxy(request: NextRequest) {
  const authDisabled = process.env.AUTH_MODE === "disabled" && process.env.NODE_ENV !== "production";
  const configured = Boolean(process.env.NEON_AUTH_BASE_URL && (process.env.NEON_AUTH_COOKIE_SECRET ?? "").length >= 32);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (authDisabled) return NextResponse.next({ request });
  if (!configured) {
    if (isPublic) return NextResponse.next({ request });
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }
  if (isPublic) return NextResponse.next({ request });

  // Neon Auth middleware: 未ログインなら /login?next=<元のパス> へ、ログイン済みならセッションを更新して通す
  const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  const middleware = getAuth().middleware({ loginUrl: `/login${next}` });
  return middleware(request);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
