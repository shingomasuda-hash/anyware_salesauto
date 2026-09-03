import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCompanyFilters } from "@/lib/companies/filters";
import { companiesToCsv } from "@/lib/companies/csv";
import { listCompaniesForExport } from "@/lib/companies/queries";

export const dynamic = "force-dynamic";

/** 企業一覧 CSV エクスポート（一覧画面と同じフィルタを適用） */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  const filters = parseCompanyFilters(params);
  const rows = await listCompaniesForExport(createSupabaseAdminClient(), filters);
  const csv = companiesToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="companies_${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
