import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JobStatusBadge, RankBadge } from "@/components/companies/badges";
import { getDashboardStats } from "@/lib/companies/queries";
import { getRequestDb } from "@/lib/supabase/request-db";
import { formatDate } from "@/lib/utils/format";
import { industryLabel } from "@/lib/companies/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = await getRequestDb();
  const [stats, recentJobs, topCompanies] = await Promise.all([
    getDashboardStats(db),
    db.from("search_jobs").select("id, name, status, requested_count, registered_count, new_count, created_at").order("created_at", { ascending: false }).limit(5),
    db.from("company_overview").select("id, company_name, prefecture, industry, sales_priority_score, sales_priority_rank, sales_contact_allowed, analyzed_at").not("sales_priority_score", "is", null).order("sales_priority_score", { ascending: false }).limit(8),
  ]);

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        description="企業リストの蓄積状況と営業優先度の概要"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/companies">企業一覧</Link>
            </Button>
            <Button asChild>
              <Link href="/search">企業を探す</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="登録企業数" value={stats.total_companies} href="/companies" />
        <StatCard label="今週追加企業" value={stats.added_this_week} href="/companies?sort=newest" />
        <StatCard label="Aランク企業" value={stats.rank_a} href="/companies?rank=A" />
        <StatCard label="Bランク企業" value={stats.rank_b} href="/companies?rank=B" />
        <StatCard label="未分析企業" value={stats.unanalyzed} href="/companies?unanalyzed=1" tone={stats.unanalyzed > 0 ? "warning" : "default"} />
        <StatCard label="営業拒否企業" value={stats.sales_restricted} hint="自動送信対象から除外" tone={stats.sales_restricted > 0 ? "danger" : "default"} />
        <StatCard label="公式サイト未確認" value={stats.website_unverified} href="/companies?needsReview=1" tone={stats.website_unverified > 0 ? "warning" : "default"} />
        <StatCard label="処理待ちジョブ" value={stats.pending_jobs} href="/jobs" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">営業優先度の高い企業</h2>
            <Link href="/companies?sort=priority" className="text-xs text-muted-foreground hover:underline">
              すべて見る
            </Link>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>企業名</TableHead>
                  <TableHead>都道府県</TableHead>
                  <TableHead>業種</TableHead>
                  <TableHead className="text-right">営業スコア</TableHead>
                  <TableHead>ランク</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(topCompanies.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      まだ分析済みの企業がありません
                    </TableCell>
                  </TableRow>
                ) : (
                  (topCompanies.data ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                          {c.company_name}
                        </Link>
                        {c.sales_contact_allowed === "false" ? <span className="ml-2 text-xs text-red-700">営業不可</span> : null}
                      </TableCell>
                      <TableCell>{c.prefecture ?? "—"}</TableCell>
                      <TableCell>{industryLabel(c.industry) ?? c.industry ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.sales_priority_score ?? "—"}</TableCell>
                      <TableCell>
                        <RankBadge rank={c.sales_priority_rank} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">最近の企業検索</h2>
            <Link href="/jobs" className="text-xs text-muted-foreground hover:underline">
              ジョブ一覧
            </Link>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>条件</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="text-right">登録 / 新規</TableHead>
                  <TableHead>作成日</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentJobs.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      まだ検索を実行していません
                    </TableCell>
                  </TableRow>
                ) : (
                  (recentJobs.data ?? []).map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <Link href={`/search/${j.id}`} className="hover:underline">
                          {j.name ?? "(条件なし)"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.registered_count} / {j.new_count}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(j.created_at, true)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
