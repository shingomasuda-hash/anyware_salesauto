import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyAnalysisEvidenceRow, CompanyAnalysisRow, CompanyOverviewRow, CompanyPageRow, CompanyRow, CrawlJobRow, AnalysisJobRow, DashboardStats, Database } from "@/lib/db/types";
import { buildCompanyQuery, type CompanyFilters } from "./filters";

type Client = SupabaseClient<Database>;

export interface CompanyListResult {
  rows: CompanyOverviewRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listCompanies(db: Client, filters: CompanyFilters): Promise<CompanyListResult> {
  const { data, error, count } = await buildCompanyQuery(db, filters, { count: true, paginate: true });
  if (error) throw new Error(`企業一覧の取得に失敗: ${error.message}`);
  const total = count ?? 0;
  return { rows: data ?? [], total, page: filters.page, perPage: filters.perPage, totalPages: Math.max(1, Math.ceil(total / filters.perPage)) };
}

/** CSV 用: ページングなしで最大 limit 件 */
export async function listCompaniesForExport(db: Client, filters: CompanyFilters, limit = 5000): Promise<CompanyOverviewRow[]> {
  const q = buildCompanyQuery(db, filters, { count: false, paginate: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(`CSV データの取得に失敗: ${error.message}`);
  return data ?? [];
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

export async function getCompanyDetail(db: Client, id: string): Promise<CompanyDetail | null> {
  const { data: company } = await db.from("companies").select("*").eq("id", id).single();
  if (!company) return null;
  const [analysisRes, pagesRes, crawlRes, analysisJobsRes, historyRes] = await Promise.all([
    company.latest_analysis_id ? db.from("company_analysis").select("*").eq("id", company.latest_analysis_id).single() : Promise.resolve({ data: null }),
    db.from("company_pages").select("*").eq("company_id", id).order("crawled_at", { ascending: false }).order("page_type"),
    db.from("crawl_jobs").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(5),
    db.from("analysis_jobs").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(5),
    db.from("company_analysis").select("id, analyzed_at, sales_priority_rank, sales_priority_score, model").eq("company_id", id).order("analyzed_at", { ascending: false }).limit(10),
  ]);
  const analysis = analysisRes.data ?? null;
  const evidence = analysis ? (await db.from("company_analysis_evidence").select("*").eq("analysis_id", analysis.id).order("category")).data ?? [] : [];
  return {
    company,
    analysis,
    evidence,
    pages: pagesRes.data ?? [],
    crawlJobs: crawlRes.data ?? [],
    analysisJobs: analysisJobsRes.data ?? [],
    analysisHistory: historyRes.data ?? [],
  };
}

export async function getDashboardStats(db: Client): Promise<DashboardStats> {
  const { data, error } = await db.rpc("dashboard_stats");
  if (error) throw new Error(`ダッシュボード集計に失敗: ${error.message}`);
  const d = (data ?? {}) as Partial<DashboardStats>;
  return {
    total_companies: d.total_companies ?? 0,
    added_this_week: d.added_this_week ?? 0,
    rank_a: d.rank_a ?? 0,
    rank_b: d.rank_b ?? 0,
    unanalyzed: d.unanalyzed ?? 0,
    sales_restricted: d.sales_restricted ?? 0,
    website_unverified: d.website_unverified ?? 0,
    pending_jobs: d.pending_jobs ?? 0,
  };
}
