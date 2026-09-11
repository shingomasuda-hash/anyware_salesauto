import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { companyOverview } from "@/db/schema";
import { MIN_ANALYSIS_CONFIDENCE } from "./constants";
import type { OverviewQuery } from "@/db/repositories/companies";

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
  /**
   * 採用ページを確認できなかった企業も表示する。
   * 営業リストの既定は「採用ページのある企業のみ」なので、この明示チェックで初めて全件になる
   * （既定 ON のチェックボックスにすると GET フォームで「外した」状態を表現できないため、
   *   条件をゆるめる側をフラグにしている）。
   */
  includeNoRecruitPage: flag,
  hasWebsite: flag,
  hasContact: flag,
  hasEmail: flag,
  /** 文面（取材依頼 / 営業）の下書きがある企業だけ（AI分析まで進んだ企業） */
  hasOutreach: flag,
  /**
   * AI が判断しきれなかった企業（確度が低い / ランクが付かない）も表示する。
   * 既定では除外する。まだ分析していない企業は既定でも表示する。
   */
  includeLowConfidence: flag,
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

const v = companyOverview;

/** フィルタ → WHERE 条件（company_overview ビュー） */
export function buildCompanyWhere(f: CompanyFilters): SQL | undefined {
  const c: SQL[] = [];
  if (f.q) {
    const term = f.q.replace(/[%_]/g, " ").trim();
    if (term) {
      const like = `%${term}%`;
      const parts: SQL[] = [ilike(v.company_name, like), ilike(v.website_domain, like)];
      if (/^\d{13}$/.test(term)) parts.push(eq(v.corporate_number, term));
      c.push(or(...parts)!);
    }
  }
  if (f.prefecture) c.push(eq(v.prefecture, f.prefecture));
  if (f.industry) c.push(eq(v.industry, f.industry));
  if (f.employeeRange) c.push(eq(v.employee_range, f.employeeRange));
  if (f.rank) c.push(eq(v.sales_priority_rank, f.rank as "A" | "B" | "C" | "D"));
  if (f.minPriority !== undefined) c.push(gte(v.sales_priority_score, f.minPriority));
  if (f.minRecruitIssue !== undefined) c.push(gte(v.recruitment_issue_score, f.minRecruitIssue));
  if (f.maxSns !== undefined) c.push(lte(v.sns_activity_score, f.maxSns));
  if (f.maxWeb !== undefined) c.push(lte(v.web_quality_score, f.maxWeb));
  if (f.recruiting) c.push(eq(v.recruiting_status, "active"));
  // 営業リストの既定は「採用ページのある企業のみ」。
  // 採用ページの有無はクロールで機械的に確認した事実であり、AI の判定ではない。
  if (!f.includeNoRecruitPage) c.push(eq(v.has_recruit_page, true));
  if (f.hasWebsite) c.push(eq(v.has_website, true));
  if (f.hasContact) c.push(eq(v.has_contact, true));
  if (f.hasEmail) c.push(eq(v.has_email, true));
  if (f.hasOutreach) c.push(eq(v.has_outreach, true));
  // 分析したのに判断材料が足りなかった企業は営業リストに出さない。
  // 未分析（analysis_id が null）は対象外 — 機械抽出の情報で絞り込めるため残す。
  if (!f.includeLowConfidence) {
    c.push(or(isNull(v.analysis_id), and(gte(v.confidence_score, MIN_ANALYSIS_CONFIDENCE), isNotNull(v.sales_priority_rank)))!);
  }
  // 営業対象の絞り込みでは「不明（未確認）」も除外する。
  // 営業拒否表記を確認できていない企業を、営業可能として扱わないため。
  if (f.excludeRestricted) c.push(eq(v.sales_contact_allowed, "true"));
  if (f.unanalyzed) c.push(isNull(v.analysis_id));
  if (f.needsReview) c.push(inArray(v.verification_status, ["needs_review", "unverified"]));
  return c.length ? and(...c) : undefined;
}

/** ソート → ORDER BY（NULL は常に末尾） */
export function buildCompanyOrderBy(f: CompanyFilters): SQL[] {
  const sort = SORT_OPTIONS.find((s) => s.key === f.sort) ?? SORT_OPTIONS[0];
  const col = v[sort.column as keyof typeof v] as unknown as SQL.Aliased | undefined;
  const column = col ?? v.sales_priority_score;
  const primary = sort.ascending ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const order: SQL[] = [primary];
  if (sort.column !== "created_at") order.push(desc(v.created_at));
  return order;
}

export function buildOverviewQuery(f: CompanyFilters, options: { paginate: boolean; limit?: number }): OverviewQuery {
  return {
    where: buildCompanyWhere(f),
    orderBy: buildCompanyOrderBy(f),
    limit: options.paginate ? f.perPage : (options.limit ?? 5000),
    offset: options.paginate ? (f.page - 1) * f.perPage : 0,
  };
}

export { asc, desc };
