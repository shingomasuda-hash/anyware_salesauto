import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSearchJobProgress } from "@/lib/jobs/status";

export const dynamic = "force-dynamic";

/** 検索ジョブの進捗（進捗画面がポーリング） */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const progress = await getSearchJobProgress(createSupabaseAdminClient(), id);
  if (!progress) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(progress);
}
