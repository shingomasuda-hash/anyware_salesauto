import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JobStatusBadge } from "@/components/companies/badges";
import { getDb } from "@/db";
import { listSearchJobs } from "@/db/repositories/jobs";
import { formatDate } from "@/lib/utils/format";
import { SearchForm } from "./search-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "企業を探す" };

export default async function SearchPage() {
  const jobs = await listSearchJobs(getDb(), 10);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <PageHeader title="企業を探す" description="条件を指定して営業対象企業を自動収集します。GビズINFOから候補を取得し、重複排除 → 公式サイト特定 → クロール → AI分析まで自動で進みます。" />
        <SearchForm />
      </div>
      <div className="lg:pt-14">
        <h2 className="mb-2 text-sm font-semibold">最近の検索</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>条件</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="text-right">登録/新規</TableHead>
                <TableHead>日時</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    履歴はありません
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((j) => (
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
                      {j.registered_count}/{j.new_count}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(j.created_at, true)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
