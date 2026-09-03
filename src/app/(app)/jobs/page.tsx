import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JobStatusBadge } from "@/components/companies/badges";
import { JobsToolbar } from "@/components/jobs/jobs-toolbar";
import { getRequestDb } from "@/lib/supabase/request-db";
import { formatDate } from "@/lib/utils/format";
import type { JobStatus } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "ジョブ" };

const STATUSES: JobStatus[] = ["pending", "processing", "retrying", "completed", "failed", "cancelled"];

export default async function JobsPage() {
  const db = await getRequestDb();
  const [searchJobs, crawl, analysis, failedCrawl, failedAnalysis] = await Promise.all([
    db.from("search_jobs").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("crawl_jobs").select("status"),
    db.from("analysis_jobs").select("status"),
    db.from("crawl_jobs").select("id, company_id, error, attempts, updated_at, companies(company_name)").eq("status", "failed").order("updated_at", { ascending: false }).limit(20),
    db.from("analysis_jobs").select("id, company_id, error, attempts, updated_at, companies(company_name)").eq("status", "failed").order("updated_at", { ascending: false }).limit(20),
  ]);
  const countBy = (rows: { status: string }[] | null) => Object.fromEntries(STATUSES.map((s) => [s, (rows ?? []).filter((r) => r.status === s).length])) as Record<JobStatus, number>;
  const crawlCounts = countBy(crawl.data);
  const analysisCounts = countBy(analysis.data);

  return (
    <div>
      <PageHeader title="ジョブ" description="検索 / クロール / AI分析 のキュー状況。失敗した企業のみ再実行できます。" actions={<JobsToolbar failedCount={crawlCounts.failed + analysisCounts.failed} />} />

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { title: "クロールジョブ", counts: crawlCounts },
          { title: "AI分析ジョブ", counts: analysisCounts },
        ].map((q) => (
          <div key={q.title} className="rounded-lg border px-4 py-3">
            <div className="mb-2 text-sm font-medium">{q.title}</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {STATUSES.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <JobStatusBadge status={s} />
                  <span className="tabular-nums">{q.counts[s]}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold">検索ジョブ</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>条件</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">発見</TableHead>
              <TableHead className="text-right">登録</TableHead>
              <TableHead className="text-right">新規</TableHead>
              <TableHead className="text-right">重複</TableHead>
              <TableHead className="text-right">対象外</TableHead>
              <TableHead>プロバイダ</TableHead>
              <TableHead>作成</TableHead>
              <TableHead>完了</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(searchJobs.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  検索ジョブはありません
                </TableCell>
              </TableRow>
            ) : (
              (searchJobs.data ?? []).map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    <Link href={`/search/${j.id}`} className="hover:underline">
                      {j.name ?? "(条件なし)"}
                    </Link>
                    {j.error ? <div className="max-w-md truncate text-xs text-red-700">{j.error}</div> : null}
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{j.found_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {j.registered_count}/{j.requested_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{j.new_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.duplicate_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.skipped_count}</TableCell>
                  <TableCell className="text-muted-foreground">{j.provider ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(j.created_at, true)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(j.completed_at, true)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {[
        { title: "失敗したクロール", rows: failedCrawl.data ?? [] },
        { title: "失敗したAI分析", rows: failedAnalysis.data ?? [] },
      ].map((sec) =>
        sec.rows.length > 0 ? (
          <div key={sec.title}>
            <h2 className="mt-8 mb-2 text-sm font-semibold">{sec.title}</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>企業</TableHead>
                    <TableHead>エラー</TableHead>
                    <TableHead className="text-right">試行</TableHead>
                    <TableHead>更新</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sec.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/companies/${r.company_id}`} className="hover:underline">
                          {r.companies?.company_name ?? r.company_id}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-lg truncate text-red-700" title={r.error ?? undefined}>
                        {r.error}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(r.updated_at, true)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}
