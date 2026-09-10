import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CandidateStatusBadge } from "@/components/companies/badges";
import { DiscoveryProgress } from "@/components/discovery/discovery-progress";
import { getDb } from "@/db";
import { listCandidatesByRun } from "@/db/repositories/discovery";
import { PROVIDER_LABELS, describeDiscoveryCriteria, parseStoredCriteria } from "@/lib/discovery/criteria";
import { getDiscoveryRunProgress } from "@/lib/discovery/status";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function DiscoveryRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const progress = await getDiscoveryRunProgress(db, id);
  if (!progress) notFound();
  const candidates = await listCandidatesByRun(db, id, undefined, 300);
  const criteria = parseStoredCriteria(progress.run.criteria);
  const duplicateCount = candidates.filter((c) => c.status === "duplicate").length;

  return (
    <div className="max-w-6xl">
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/search" className="hover:underline">
          企業を探す
        </Link>{" "}
        / 探索結果
      </div>
      <PageHeader
        title={progress.run.name ?? describeDiscoveryCriteria(criteria)}
        description={`作成 ${formatDate(progress.run.created_at, true)} ／ 探索方法: ${progress.run.mode}`}
      />
      <DiscoveryProgress runId={id} initial={progress} />

      <h2 className="mt-8 mb-2 text-sm font-semibold">
        発見した企業候補（全{candidates.length}件：新規{candidates.length - duplicateCount}件 ＋ 重複{duplicateCount}件）
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        「重複」は既に企業一覧へ登録済みのため、上の進捗にある新規候補数には含めていません。
        本人確認を通過した候補だけが企業として登録されます。要確認の候補は
        <Link href="/review" className="mx-1 underline">
          確認待ちリスト
        </Link>
        で承認できます。
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>企業名</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">確認スコア</TableHead>
              <TableHead>情報源</TableHead>
              <TableHead>公式サイト</TableHead>
              <TableHead>備考</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  まだ候補が見つかっていません
                </TableCell>
              </TableRow>
            ) : (
              candidates.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.company_id ? (
                      <Link href={`/companies/${c.company_id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{c.name}</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {c.prefecture ?? ""}
                      {c.city ?? ""}
                      {c.corporate_number ? ` ／ 法人番号 ${c.corporate_number}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CandidateStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.verification_score ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(c.sources.length > 0 ? c.sources : [c.primary_source]).map((s) => PROVIDER_LABELS[s] ?? s).join(" / ")}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs">
                    {c.website ? (
                      <a href={c.website} target="_blank" rel="noreferrer noopener" className="underline">
                        {c.website}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.reject_reason ?? ""}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
