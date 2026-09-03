import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { processJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron 用（Authorization: Bearer CRON_SECRET が自動付与される） */
export async function GET(request: Request) {
  const env = getEnv();
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const stats = await processJobs({ maxRuntimeMs: Math.min(env.JOB_MAX_RUNTIME_MS, 280_000) });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
