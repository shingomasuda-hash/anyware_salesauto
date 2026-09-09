import {
  extractCity,
  extractDomain,
  extractPrefecture,
  normalizeAddress,
  normalizeCompanyName,
  normalizeCorporateNumber,
  normalizePhone,
  normalizeUrl,
  toHalfWidth,
} from "@/lib/companies/normalize";
import type { Json } from "@/db/types";
import type { DiscoveryCandidate, DiscoveryProviderName } from "./types";

export interface RawCandidateInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  corporateNumber?: string | null;
  industry?: string | null;
  source: DiscoveryProviderName;
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceConfidence: number;
  rawData?: unknown;
}

/** 会社名から検索結果由来のノイズ（区切り以降の説明文など）を落とす */
export function cleanCompanyName(raw: string): string {
  let name = toHalfWidth(raw).trim();
  // 検索結果タイトルにありがちな区切りで前半のみ採用
  name = name.split(/\s*[|｜/／–—-]\s+/)[0].trim();
  // 末尾の説明的な語を除去
  name = name.replace(/\s*(の求人情報|の会社概要|公式サイト|公式ホームページ|ホームページ|採用情報|求人情報)\s*$/g, "").trim();
  return name.replace(/\s{2,}/g, " ");
}

/**
 * Provider の生データを DiscoveryCandidate へ正規化する。
 * original_name（name）は必ず保持し、照合用に normalizedName を別に持つ。
 */
export function toCandidate(input: RawCandidateInput): DiscoveryCandidate {
  const name = cleanCompanyName(input.name);
  const address = input.address?.trim() || null;
  const prefecture = extractPrefecture(address);
  const website = normalizeUrl(input.website ?? null);
  return {
    name,
    normalizedName: normalizeCompanyName(name),
    address,
    prefecture,
    city: extractCity(address, prefecture),
    phone: normalizePhone(input.phone ?? null),
    website,
    domain: extractDomain(website),
    corporateNumber: normalizeCorporateNumber(input.corporateNumber ?? null),
    industry: input.industry ?? null,
    source: input.source,
    sourceId: input.sourceId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourceConfidence: Math.max(0, Math.min(100, Math.round(input.sourceConfidence))),
    rawData: (input.rawData ?? null) as Json,
    discoveredAt: new Date().toISOString(),
  };
}

/** 企業として扱えない候補（個人名・一般名詞・短すぎる等）を除外する */
export function isPlausibleCompany(candidate: DiscoveryCandidate): boolean {
  const n = candidate.name;
  if (!n || n.length < 2 || n.length > 100) return false;
  // 明らかに企業名でない検索結果（記事タイトル等）
  if (/^(求人|採用|一覧|ランキング|まとめ|比較|おすすめ|【|検索結果)/.test(n)) return false;
  if (/(とは|の方法|について|ガイド|コラム|ニュース)$/.test(n)) return false;
  return true;
}

export { normalizeAddress, normalizeCompanyName };
