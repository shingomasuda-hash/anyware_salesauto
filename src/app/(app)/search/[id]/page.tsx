import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchProgress } from "@/components/search/search-progress";
import { getSearchJobProgress } from "@/lib/jobs/status";
import { describeConditions, parseStoredConditions } from "@/lib/jobs/search-conditions";
import { getDb } from "@/db";
import { listSearchJobItemsWithCompany } from "@/db/repositories/jobs";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const ITEM_LABEL: Record<string, { label: string; variant: "success" | "muted" | "warning" | "danger" }> = {
  new: { label: "新規", variant: "success" },
  duplicate: { label: "登録済", variant: "muted" },
  skipped: { label: "対象外", variant: "warning" },
  failed: { label: "失敗", variant: "danger" },
};

export default async function SearchJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const progress = await getSearchJobProgress(db, id);
  if (!progress) notFound();
  const items = await listSearchJobItemsWithCompany(db, id, 500);
  const conditions = parseStoredConditions(progress.job.conditions);

  return (
    <div className="max-w-6xl">
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/search" className="hover:underline">
          企業を探す
        </Link>{" "}
        / 検索結果
      </div>
      <PageHeader title={progress.job.name ?? describeConditions(conditions)} description={`作成 ${formatDate(progress.job.created_at, true)}`} />
      <SearchProgress jobId={id} initial={progress} />

      <h2 className="mt-8 mb-2 text-sm font-semibold">検出した企業（{items.length}）</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>企業名</TableHead>
              <TableHead>登録</TableHead>
              <TableHead>公式HP</TableHead>
              <TableHead>分析</TableHead>
              <TableHead>備考</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  まだ企業が検出されていません
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => {
                const m = ITEM_LABEL[it.status] ?? ITEM_LABEL.skipped;
                const c = it.companies;
                return (
                  <TableRow key={it.id}>
                    <TableCell>
                      {it.company_id ? (
                        <Link href={`/companies/${it.company_id}`} className="font-medium hover:underline">
                          {it.company_name}
                        </Link>
                      ) : (
                        it.company_name
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.variant}>{m.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c ? verificationLabel(c.verification_status) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c ? analysisLabel(c.analysis_status) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {it.reason ?? ""}
                      {c?.sales_contact_allowed === "false" ? <span className="ml-2 text-red-700">営業不可</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function verificationLabel(v: string): string {
  return { verified: "確認済", manual: "手動", needs_review: "要確認", unverified: "未確認", no_website: "なし" }[v] ?? v;
}
function analysisLabel(v: string): string {
  return { analyzed: "完了", analyzing: "分析中", not_analyzed: "未", failed: "失敗" }[v] ?? v;
}
