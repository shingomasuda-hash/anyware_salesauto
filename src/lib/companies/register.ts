import type { Db } from "@/db";
import { getCompanyById, insertCompany } from "@/db/repositories/companies";
import type { CompanyRow, CompanySource, Json } from "@/db/types";
import { Logger } from "@/lib/logging/logger";
import { isUniqueViolation } from "@/db/errors";
import { employeeRangeFromCount } from "./constants";
import { findDuplicateCompany, type DedupeMatchReason } from "./dedupe";
import { extractCity, extractDomain, extractPrefecture, normalizeAddress, normalizeCompanyName, normalizePhone, normalizeUrl } from "./normalize";

export interface CompanyInput {
  corporateNumber?: string | null;
  companyName: string;
  companyNameKana?: string | null;
  address?: string | null;
  prefecture?: string | null;
  city?: string | null;
  postalCode?: string | null;
  industry?: string | null;
  industryDetail?: string | null;
  employeeCount?: number | null;
  capital?: number | null;
  establishedDate?: string | null;
  representativeName?: string | null;
  phone?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  source: CompanySource;
  sourceRaw?: unknown;
  createdBy?: string | null;
}

export type RegisterResult =
  | { status: "new"; company: CompanyRow }
  | { status: "duplicate"; company: CompanyRow; reason: DedupeMatchReason };

/**
 * 企業を登録する。重複判定（法人番号 > ドメイン > 企業名+所在地）を行い、
 * 既存があれば新規登録せず既存企業を返す。
 * websiteUrl は "候補" として website_candidates に保存し、公式判定はクロールジョブで行う。
 */
export async function registerCompany(db: Db, input: CompanyInput, logger: Logger): Promise<RegisterResult> {
  const name = input.companyName.trim();
  if (!name) throw new Error("企業名は必須です");

  const websiteUrl = normalizeUrl(input.websiteUrl);
  const domain = extractDomain(websiteUrl);
  const prefecture = input.prefecture ?? extractPrefecture(input.address);
  const address = input.address?.trim() || null;
  const dedupeKey = { corporateNumber: input.corporateNumber ?? null, websiteDomain: domain, companyName: name, address };

  const duplicate = await findDuplicateCompany(db, dedupeKey);
  if (duplicate) {
    const existing = await getCompanyById(db, duplicate.id);
    if (existing) {
      await logger.info("重複企業のためスキップ", { companyName: name, reason: duplicate.reason, existingId: duplicate.id });
      return { status: "duplicate", company: existing, reason: duplicate.reason };
    }
  }

  const candidates = websiteUrl ? [{ url: websiteUrl, source: input.source === "manual" ? "manual" : input.source === "gbiz" ? "gbiz" : "search" }] : [];

  try {
    const company = await insertCompany(db, {
      corporate_number: input.corporateNumber ?? null,
      company_name: name,
      company_name_kana: input.companyNameKana ?? null,
      company_name_normalized: normalizeCompanyName(name),
      prefecture,
      city: input.city ?? extractCity(address, prefecture),
      address,
      address_normalized: normalizeAddress(address),
      postal_code: input.postalCode ?? null,
      industry: input.industry ?? null,
      industry_detail: input.industryDetail ?? null,
      employee_count: input.employeeCount ?? null,
      employee_range: employeeRangeFromCount(input.employeeCount),
      capital: input.capital ?? null,
      established_date: input.establishedDate ?? null,
      representative_name: input.representativeName ?? null,
      phone: normalizePhone(input.phone),
      description: input.description ?? null,
      // 公式判定前なので website_url は未設定。候補として保持する
      website_url: null,
      website_domain: null,
      website_candidates: candidates as unknown as Json,
      source: input.source,
      source_raw: (input.sourceRaw ?? null) as Json,
      verification_status: websiteUrl ? "unverified" : "no_website",
      crawl_status: websiteUrl ? "not_crawled" : "no_website",
      created_by: input.createdBy ?? null,
    });
    await logger.info("企業を新規登録", { companyId: company.id, companyName: name, source: input.source });
    return { status: "new", company };
  } catch (err) {
    // 同時実行によるユニーク制約違反 → 既存を返す
    if (isUniqueViolation(err)) {
      const again = await findDuplicateCompany(db, dedupeKey);
      if (again) {
        const existing = await getCompanyById(db, again.id);
        if (existing) return { status: "duplicate", company: existing, reason: again.reason };
      }
    }
    throw new Error(`企業登録に失敗: ${err instanceof Error ? err.message : String(err)}`);
  }
}
