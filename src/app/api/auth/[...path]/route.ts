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
type Ctx = { params: Promise<{ path: string[] }> };
type Handler = (request: NextRequest, ctx: Ctx) => Promise<Response> | Response;

let cachedHandlers: { GET: Handler; POST: Handler } | null = null;

/** 設定の読み込みはビルド時ではなくリクエスト時に行う（Vercel のビルドで環境変数を評価させない） */
function handlers() {
  if (cachedHandlers) return cachedHandlers;
  if (isAuthDisabled() || !hasNeonAuthConfig()) {
    const notConfigured: Handler = () => NextResponse.json({ error: "Neon Auth is not configured" }, { status: 503 });
    return { GET: notConfigured, POST: notConfigured };
  }
  cachedHandlers = getAuth().handler();
  return cachedHandlers;
}

function guard(method: "GET" | "POST"): Handler {
  return (request, ctx) => {
    if (isBlocked(request)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    return handlers()[method](request, ctx);
  };
}

export const GET = guard("GET");
export const POST = guard("POST");
