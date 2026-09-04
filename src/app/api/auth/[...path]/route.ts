import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * 社内ツールのため、外部からのアカウント作成・パスワードリセット等は受け付けない。
 * ユーザーは Neon Console (Auth > Users) からのみ作成する。
 */
const BLOCKED_PATH_PATTERNS = [/\/sign-up(\/|$)/, /\/forget-password|\/forgot-password|\/reset-password/, /\/magic-link/, /\/email-otp/, /\/delete-user/];

function isBlocked(request: NextRequest): boolean {
  const path = request.nextUrl.pathname.replace(/^\/api\/auth/, "");
  return BLOCKED_PATH_PATTERNS.some((re) => re.test(path));
}

/**
 * Neon Auth のプロキシハンドラ。
 * クライアントからの認証リクエストを Neon Auth へ中継し、セッション Cookie を管理する。
 */
function handlers() {
  if (isAuthDisabled() || !hasNeonAuthConfig()) {
    const notConfigured = () => NextResponse.json({ error: "Neon Auth is not configured" }, { status: 503 });
    return { GET: notConfigured, POST: notConfigured };
  }
  const h = getAuth().handler();
  return {
    GET: (request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
      isBlocked(request) ? NextResponse.json({ error: "Not allowed" }, { status: 403 }) : h.GET(request, ctx),
    POST: (request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
      isBlocked(request) ? NextResponse.json({ error: "Not allowed" }, { status: 403 }) : h.POST(request, ctx),
  };
}

const h = handlers();
export const GET = h.GET;
export const POST = h.POST;
