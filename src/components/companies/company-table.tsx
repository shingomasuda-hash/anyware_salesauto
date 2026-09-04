import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactAllowedBadge, RankBadge, ScoreCell, YesNo } from "./badges";
import { employeeRangeLabel, industryLabel } from "@/lib/companies/constants";
import type { CompanyOverviewRow } from "@/db/types";
import { formatDate } from "@/lib/utils/format";

export function CompanyTable({ rows }: { rows: CompanyOverviewRow[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">企業名</TableHead>
            <TableHead>都道府県</TableHead>
            <TableHead>業種</TableHead>
            <TableHead>従業員規模</TableHead>
            <TableHead className="text-center">HP</TableHead>
            <TableHead className="text-center">採用</TableHead>
            <TableHead className="text-center">SNS</TableHead>
            <TableHead>採用課題</TableHead>
            <TableHead>Web</TableHead>
            <TableHead>SNS</TableHead>
            <TableHead>営業</TableHead>
            <TableHead>ランク</TableHead>
            <TableHead>連絡可否</TableHead>
            <TableHead>解析日</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={14} className="py-10 text-center text-muted-foreground">
                条件に一致する企業がありません
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Link href={`/companies/${r.id}`} className="max-w-64 truncate font-medium hover:underline" title={r.company_name}>
                      {r.company_name}
                    </Link>
                    {r.website_url ? (
                      <a href={r.website_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" title={r.website_url}>
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                  {r.verification_status === "needs_review" ? <div className="text-xs text-amber-700">公式サイト要確認</div> : null}
                </TableCell>
                <TableCell>{r.prefecture ?? "—"}</TableCell>
                <TableCell className="max-w-32 truncate" title={r.industry_detail ?? undefined}>
                  {industryLabel(r.industry) ?? r.industry ?? "—"}
                </TableCell>
                <TableCell className="tabular-nums">{r.employee_count !== null ? `${r.employee_count}名` : employeeRangeLabel(r.employee_range)}</TableCell>
                <TableCell className="text-center">
                  <YesNo value={r.has_website} />
                </TableCell>
                <TableCell className="text-center">
                  <YesNo value={r.recruiting_status ? r.recruiting_status === "active" : r.has_recruit_page ? true : null} />
                </TableCell>
                <TableCell className="text-center">
                  <YesNo value={r.has_sns} />
                </TableCell>
                <TableCell>
                  <ScoreCell value={r.recruitment_issue_score} />
                </TableCell>
                <TableCell>
                  <ScoreCell value={r.web_quality_score} />
                </TableCell>
                <TableCell>
                  <ScoreCell value={r.sns_activity_score} />
                </TableCell>
                <TableCell>
                  <ScoreCell value={r.sales_priority_score} />
                </TableCell>
                <TableCell>
                  <RankBadge rank={r.sales_priority_rank} />
                </TableCell>
                <TableCell>
                  <ContactAllowedBadge value={r.sales_contact_allowed} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(r.analyzed_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
