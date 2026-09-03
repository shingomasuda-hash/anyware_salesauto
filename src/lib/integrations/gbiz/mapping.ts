import { INDUSTRIES } from "@/lib/companies/constants";
import {
  extractCity,
  extractPrefecture,
  normalizeCorporateNumber,
  normalizeUrl,
  parseEmployeeCount,
  toHalfWidth,
} from "@/lib/companies/normalize";
import type { CompanyInput } from "@/lib/companies/register";
import type { CompanySearchConditions, GbizHojin } from "./types";

/** GビズINFO 法人情報 → 企業登録入力 */
export function mapGbizToCompanyInput(h: GbizHojin, industryKey?: string): CompanyInput {
  const location = h.location ?? null;
  const prefecture = extractPrefecture(location);
  const websiteUrl = normalizeUrl(h.company_url ?? null);
  return {
    corporateNumber: normalizeCorporateNumber(h.corporate_number),
    companyName: (h.name ?? "").trim(),
    companyNameKana: h.kana ?? null,
    address: location,
    prefecture,
    city: extractCity(location, prefecture),
    postalCode: h.postal_code ? toHalfWidth(h.postal_code).replace(/(\d{3})(\d{4})/, "$1-$2") : null,
    industry: industryKey ?? inferIndustryKey(h) ?? null,
    industryDetail: h.business_items?.join(" / ") ?? null,
    employeeCount: parseEmployeeCount(h.employee_number),
    capital: parseCapital(h.capital_stock),
    establishedDate: normalizeDate(h.date_of_establishment),
    representativeName: h.representative_name ?? null,
    description: h.business_summary ?? null,
    websiteUrl,
    source: "gbiz",
    sourceRaw: h,
  };
}

function parseCapital(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(toHalfWidth(String(v)).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function normalizeDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = toHalfWidth(v).replace(/[./年月]/g, "-").replace(/日/g, "").replace(/-+$/, "");
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = m[1];
  const mo = (m[2] ?? "01").padStart(2, "0");
  const d = (m[3] ?? "01").padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function inferIndustryKey(h: GbizHojin): string | undefined {
  const hay = `${h.business_items?.join(" ") ?? ""} ${h.business_summary ?? ""} ${h.name ?? ""}`;
  for (const ind of INDUSTRIES) {
    if (ind.gbizKeywords.some((k) => hay.includes(k))) return ind.key;
  }
  return undefined;
}

/** API で絞れない条件（業種 / 市区町村 / 従業員数）をローカルで判定 */
export function matchesConditions(h: GbizHojin, c: CompanySearchConditions): { ok: boolean; reason?: string } {
  if (h.close_date || (h.status && h.status !== "101" && h.status !== "1")) {
    // status 101 = 登録（GビズINFO）。閉鎖法人は除外
    if (h.close_date) return { ok: false, reason: "閉鎖法人" };
  }
  if (c.city && !(h.location ?? "").includes(c.city)) return { ok: false, reason: "市区町村不一致" };
  if (c.industry && c.industry !== "other") {
    const ind = INDUSTRIES.find((i) => i.key === c.industry);
    const hay = `${h.business_items?.join(" ") ?? ""} ${h.business_summary ?? ""} ${h.name ?? ""}`;
    // 業種情報が全く無い法人は除外せず（後段のAI分析で判断）
    const hasIndustryInfo = (h.business_items && h.business_items.length > 0) || Boolean(h.business_summary);
    if (ind && hasIndustryInfo && !ind.gbizKeywords.some((k) => hay.includes(k))) return { ok: false, reason: "業種不一致" };
  }
  const emp = parseEmployeeCount(h.employee_number);
  if (emp !== null) {
    if (c.employeeMin !== undefined && emp < c.employeeMin) return { ok: false, reason: "従業員数が下限未満" };
    if (c.employeeMax !== undefined && emp > c.employeeMax) return { ok: false, reason: "従業員数が上限超過" };
  }
  return { ok: true };
}
