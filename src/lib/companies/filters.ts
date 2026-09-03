import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const optionalStr = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional());
const optionalNum = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().min(0).max(100).optional());
const flag = z.preprocess((v) => v === "1" || v === "true" || v === "on" || v === true, z.boolean().default(false));

export const SORT_OPTIONS = [
  { key: "priority", label: "営業優先度順", column: "sales_priority_score", ascending: false },
  { key: "newest", label: "新着順", column: "created_at", ascending: false },
  { key: "recruitment_issue", label: "採用課題順", column: "recruitment_issue_score", ascending: false },
  { key: "sns_issue", label: "SNS課題順（SNSスコア低い順）", column: "sns_activity_score", ascending: true },
  { key: "web_issue", label: "Web課題順（Webスコア低い順）", column: "web_quality_score", ascending: true },
  { key: "dx", label: "DX余地順", column: "dx_opportunity_score", ascending: false },
  { key: "employees", label: "従業員規模順", column: "employee_count", ascending: false },
  { key: "name", label: "企業名順", column: "company_name", ascending: true },
  { key: "analyzed", label: "解析日順", column: "analyzed_at", ascending: false },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

export const companyFilterSchema = z.object({
  q: optionalStr,
  prefecture: optionalStr,
  industry: optionalStr,
  employeeRange: optionalStr,
  rank: optionalStr,
  minPriority: optionalNum,
  minRecruitIssue: optionalNum,
  maxSns: optionalNum,
  maxWeb: optionalNum,
  recruiting: flag,
  hasWebsite: flag,
  hasContact: flag,
  hasEmail: flag,
  excludeRestricted: flag,
  unanalyzed: flag,
  needsReview: flag,
  sort: z.preprocess((v) => (typeof v === "string" && v ? v : "priority"), z.enum(SORT_OPTIONS.map((s) => s.key) as [SortKey, ...SortKey[]])),
  page: z.preprocess((v) => (typeof v === "string" && v ? v : "1"), z.coerce.number().int().min(1).default(1)),
  perPage: z.preprocess((v) => (typeof v === "string" && v ? v : "50"), z.coerce.number().int().min(10).max(200).default(50)),
});

export type CompanyFilters = z.infer<typeof companyFilterSchema>;

export function parseCompanyFilters(params: Record<string, string | string[] | undefined>): CompanyFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = Array.isArray(v) ? v[0] : v;
  const parsed = companyFilterSchema.safeParse(flat);
  return parsed.success ? parsed.data : companyFilterSchema.parse({});
}

export function filtersToSearchParams(filters: Partial<CompanyFilters>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (k === "page" && v === 1) continue;
    if (k === "perPage" && v === 50) continue;
    if (k === "sort" && v === "priority") continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  return sp;
}

type Client = SupabaseClient<Database>;

/** company_overview ビューにフィルタ・ソートを適用したクエリを組み立てる */
export function buildCompanyQuery(db: Client, f: CompanyFilters, options: { count?: boolean; paginate?: boolean } = { count: true, paginate: true }) {
  let q = db.from("company_overview").select("*", options.count ? { count: "exact" } : undefined);
  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`company_name.ilike.%${term}%,website_domain.ilike.%${term}%,corporate_number.eq.${/^\d{13}$/.test(term) ? term : "0"}`);
  }
  if (f.prefecture) q = q.eq("prefecture", f.prefecture);
  if (f.industry) q = q.eq("industry", f.industry);
  if (f.employeeRange) q = q.eq("employee_range", f.employeeRange);
  if (f.rank) q = q.eq("sales_priority_rank", f.rank as "A" | "B" | "C" | "D");
  if (f.minPriority !== undefined) q = q.gte("sales_priority_score", f.minPriority);
  if (f.minRecruitIssue !== undefined) q = q.gte("recruitment_issue_score", f.minRecruitIssue);
  if (f.maxSns !== undefined) q = q.lte("sns_activity_score", f.maxSns);
  if (f.maxWeb !== undefined) q = q.lte("web_quality_score", f.maxWeb);
  if (f.recruiting) q = q.eq("recruiting_status", "active");
  if (f.hasWebsite) q = q.eq("has_website", true);
  if (f.hasContact) q = q.eq("has_contact", true);
  if (f.hasEmail) q = q.eq("has_email", true);
  if (f.excludeRestricted) q = q.neq("sales_contact_allowed", "false");
  if (f.unanalyzed) q = q.is("analysis_id", null);
  if (f.needsReview) q = q.in("verification_status", ["needs_review", "unverified"]);

  const sort = SORT_OPTIONS.find((s) => s.key === f.sort) ?? SORT_OPTIONS[0];
  q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  if (sort.column !== "created_at") q = q.order("created_at", { ascending: false });

  if (options.paginate) {
    const from = (f.page - 1) * f.perPage;
    q = q.range(from, from + f.perPage - 1);
  }
  return q;
}
