import type { Db } from "@/db";
import type { AnalysisJobRow, CompanyAnalysisEvidenceRow, CompanyAnalysisRow, CompanyOverviewRow, CompanyPageRow, CompanyRow, CrawlJobRow, DashboardStats } from "@/db/types";
import { getCompanyById, getDashboardStats as repoDashboardStats, listCompanyOverview, listCompanyOverviewAll } from "@/db/repositories/companies";
import { getAnalysisById, listAnalysisHistory, listEvidence } from "@/db/repositories/analysis";
import { listCompanyPages } from "@/db/repositories/pages";
import { listCompanyJobs } from "@/db/repositories/jobs";
import { buildOverviewQuery, type CompanyFilters } from "./filters";

export interface CompanyListResult {
  rows: CompanyOverviewRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listCompanies(db: Db, filters: CompanyFilters): Promise<CompanyListResult> {
  const { rows, total } = await listCompanyOverview(db, buildOverviewQuery(filters, { paginate: true }));
  return { rows, total, page: filters.page, perPage: filters.perPage, totalPages: Math.max(1, Math.ceil(total / filters.perPage)) };
}

/** CSV 用: ページングなしで最大 limit 件 */
export async function listCompaniesForExport(db: Db, filters: CompanyFilters, limit = 5000): Promise<CompanyOverviewRow[]> {
  return listCompanyOverviewAll(db, buildOverviewQuery(filters, { paginate: false, limit }));
}

export interface CompanyDetail {
  company: CompanyRow;
  analysis: CompanyAnalysisRow | null;
  evidence: CompanyAnalysisEvidenceRow[];
  pages: CompanyPageRow[];
  crawlJobs: CrawlJobRow[];
  analysisJobs: AnalysisJobRow[];
  analysisHistory: Pick<CompanyAnalysisRow, "id" | "analyzed_at" | "sales_priority_rank" | "sales_priority_score" | "model">[];
}

export async function getCompanyDetail(db: Db, id: string): Promise<CompanyDetail | null> {
  const company = await getCompanyById(db, id);
  if (!company) return null;
  const [analysis, pages, crawlJobs, analysisJobs, analysisHistory] = await Promise.all([
    company.latest_analysis_id ? getAnalysisById(db, company.latest_analysis_id) : Promise.resolve(null),
    listCompanyPages(db, id),
    listCompanyJobs(db, "crawl", id, 5),
    listCompanyJobs(db, "analysis", id, 5),
    listAnalysisHistory(db, id, 10),
  ]);
  const evidence = analysis ? await listEvidence(db, analysis.id) : [];
  return { company, analysis, evidence, pages, crawlJobs, analysisJobs, analysisHistory };
}

export async function getDashboardStats(db: Db): Promise<DashboardStats> {
  return repoDashboardStats(db);
}
