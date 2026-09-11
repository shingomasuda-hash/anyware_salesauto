import Link from "next/link";
import { Download, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CompanyFilterForm } from "@/components/companies/company-filters";
import { CompanyTable } from "@/components/companies/company-table";
import { Pagination } from "@/components/companies/pagination";
import { MIN_ANALYSIS_CONFIDENCE } from "@/lib/companies/constants";
import { filtersToSearchParams, parseCompanyFilters } from "@/lib/companies/filters";
import { listCompanies } from "@/lib/companies/queries";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "企業一覧" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = parseCompanyFilters(params);
  const db = getDb();
  const result = await listCompanies(db, filters);
  const exportQs = filtersToSearchParams({ ...filters, page: 1 }).toString();

  return (
    <div>
      <PageHeader
        title="企業一覧"
        description={[
          filters.includeNoRecruitPage ? "採用ページなしを含む全企業" : "採用ページを確認できた企業のみ",
          filters.includeLowConfidence ? "確度が低い企業も含む" : `AIが判断しきれなかった企業（確度${MIN_ANALYSIS_CONFIDENCE}未満）は除外`,
          "企業名をクリックすると公式サイトが開きます。フィルタ条件はそのまま CSV 出力に適用されます。",
        ].join(" / ")}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/companies/export${exportQs ? `?${exportQs}` : ""}`}>
                <Download /> CSVエクスポート
              </a>
            </Button>
            <Button asChild>
              <Link href="/companies/new">
                <PlusCircle /> 企業を手動追加
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <CompanyFilterForm filters={filters} />
        <Pagination filters={filters} total={result.total} totalPages={result.totalPages} />
        <CompanyTable rows={result.rows} />
        <Pagination filters={filters} total={result.total} totalPages={result.totalPages} />
      </div>
    </div>
  );
}
