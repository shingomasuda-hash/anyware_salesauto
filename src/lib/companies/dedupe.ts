import type { Db } from "@/db";
import { findDedupeCandidates } from "@/db/repositories/companies";
import { normalizeAddress, normalizeCompanyName } from "./normalize";

/** 重複判定に必要な最小限の企業情報 */
export interface DedupeCandidate {
  corporateNumber?: string | null;
  websiteDomain?: string | null;
  companyName: string;
  address?: string | null;
}

export interface DedupeExisting {
  id: string;
  corporate_number: string | null;
  website_domain: string | null;
  company_name_normalized: string;
  address_normalized: string | null;
}

export type DedupeMatchReason = "corporate_number" | "website_domain" | "name_address";

export interface DedupeMatch {
  id: string;
  reason: DedupeMatchReason;
}

/**
 * 純粋関数版の重複判定。優先順位: 法人番号 > ドメイン > 企業名+所在地
 * DB クエリを伴う版 (findDuplicateCompany) はこの関数を利用する。
 */
export function matchDuplicate(candidate: DedupeCandidate, existing: DedupeExisting[]): DedupeMatch | null {
  const cn = candidate.corporateNumber ?? null;
  if (cn) {
    const hit = existing.find((e) => e.corporate_number === cn);
    if (hit) return { id: hit.id, reason: "corporate_number" };
  }
  const domain = candidate.websiteDomain ?? null;
  if (domain) {
    const hit = existing.find((e) => e.website_domain === domain);
    if (hit) return { id: hit.id, reason: "website_domain" };
  }
  const nameNorm = normalizeCompanyName(candidate.companyName);
  const addrNorm = normalizeAddress(candidate.address);
  if (nameNorm && addrNorm) {
    const hit = existing.find((e) => e.company_name_normalized === nameNorm && e.address_normalized === addrNorm);
    if (hit) return { id: hit.id, reason: "name_address" };
  }
  return null;
}

/**
 * DB を参照して重複企業を探す。
 * 3条件それぞれで候補を引いてから matchDuplicate で優先順位判定する。
 */
export async function findDuplicateCompany(db: Db, candidate: DedupeCandidate): Promise<DedupeMatch | null> {
  const existing = await findDedupeCandidates(db, {
    corporateNumber: candidate.corporateNumber ?? null,
    domain: candidate.websiteDomain ?? null,
    nameNorm: normalizeCompanyName(candidate.companyName),
    addrNorm: normalizeAddress(candidate.address),
  });
  return matchDuplicate(candidate, existing);
}
