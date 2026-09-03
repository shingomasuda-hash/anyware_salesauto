import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api/auth";
import { getEnv } from "@/lib/config/env";
import { processJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ジョブ処理エンドポイント。
 * - 進捗画面からのポーリング（ログインユーザー）
 * - 外部スケジューラ（Authorization: Bearer JOB_SECRET）
 */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, { allowSecrets: ["JOB_SECRET", "CRON_SECRET"] });
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  let maxRuntimeMs = getEnv().JOB_MAX_RUNTIME_MS;
  try {
    const body = (await request.json().catch(() => ({}))) as { maxRuntimeMs?: number };
    if (typeof body.maxRuntimeMs === "number" && body.maxRuntimeMs > 0) maxRuntimeMs = Math.min(body.maxRuntimeMs, 280_000);
  } catch {
    /* no body */
  }
  try {
    const stats = await processJobs({ maxRuntimeMs });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
