import Link from "next/link";
import { Button } from "@/components/ui/button";
import { filtersToSearchParams, type CompanyFilters } from "@/lib/companies/filters";

export function Pagination({ filters, total, totalPages }: { filters: CompanyFilters; total: number; totalPages: number }) {
  const link = (page: number) => {
    const sp = filtersToSearchParams({ ...filters, page });
    const qs = sp.toString();
    return `/companies${qs ? `?${qs}` : ""}`;
  };
  const from = total === 0 ? 0 : (filters.page - 1) * filters.perPage + 1;
  const to = Math.min(total, filters.page * filters.perPage);
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} / {total}件
      </span>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" disabled={filters.page <= 1}>
          <Link href={link(Math.max(1, filters.page - 1))} aria-disabled={filters.page <= 1} className={filters.page <= 1 ? "pointer-events-none opacity-50" : ""}>
            前へ
          </Link>
        </Button>
        <span className="tabular-nums">
          {filters.page} / {totalPages}
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href={link(Math.min(totalPages, filters.page + 1))} className={filters.page >= totalPages ? "pointer-events-none opacity-50" : ""}>
            次へ
          </Link>
        </Button>
      </div>
    </div>
  );
}
