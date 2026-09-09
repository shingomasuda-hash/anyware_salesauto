import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DiscoveryRunStatusBadge, JobStatusBadge } from "@/components/companies/badges";
import { getDb } from "@/db";
import { listDiscoveryRuns } from "@/db/repositories/discovery";
import { listSearchJobs } from "@/db/repositories/jobs";
import { getProviderAvailability } from "@/lib/discovery/providers";
import { formatDate } from "@/lib/utils/format";
import { SearchForm } from "./search-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "企業を探す" };

export default async function SearchPage() {
  const db = getDb();
  const [runs, jobs] = await Promise.all([listDiscoveryRuns(db, 10), listSearchJobs(db, 5)]);
  const availability = getProviderAvailability();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <PageHeader
          title="企業を探す"
          description="複数の情報源（GビズINFO / Google Places / Web検索 / EDINET）から企業候補を発見し、情報を統合 → 本人確認 → 重複排除 → 公式サイト確認まで行います。確認できた企業だけが営業候補として登録されます。"
        />
        <SearchForm availability={availability} />
      </div>
      <div className="lg:pt-14">
        <h2 className="mb-2 text-sm font-semibold">最近の探索</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>条件</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="text-right">確認済/要確認</TableHead>
                <TableHead>日時</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    履歴はありません
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/discovery/${r.id}`} className="hover:underline">
                        {r.name ?? "(条件なし)"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <DiscoveryRunStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.verified_count}/{r.needs_review_count}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.created_at, true)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {jobs.length > 0 ? (
          <>
            <h2 className="mt-8 mb-2 text-sm font-semibold">以前の検索（GビズINFO 単独）</h2>
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
                  {jobs.map((j) => (
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
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
