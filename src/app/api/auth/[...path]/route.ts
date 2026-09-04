import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * Neon Auth のプロキシハンドラ。
 * クライアント（ログインフォーム等）からの認証リクエストを Neon Auth へ中継し、セッション Cookie を管理する。
 */
function handlers() {
  if (isAuthDisabled() || !hasNeonAuthConfig()) {
    const notConfigured = () => NextResponse.json({ error: "Neon Auth is not configured" }, { status: 503 });
    return { GET: notConfigured, POST: notConfigured };
  }
  return getAuth().handler();
}

const h = handlers();
export const GET = h.GET;
export const POST = h.POST;
