import { getDiscoveryConfig } from "@/lib/config/discovery";
import { addressAppearsIn, normalizeCompanyName, toHalfWidth } from "@/lib/companies/normalize";
import type { DiscoveryCandidateStatus, DiscoveryProviderName, MergedCandidate } from "./types";

export interface VerificationSignal {
  key: string;
  label: string;
  matched: boolean;
  points: number;
  detail?: string;
}

export interface VerificationResult {
  score: number;
  status: Extract<DiscoveryCandidateStatus, "verified" | "needs_review" | "rejected">;
  signals: VerificationSignal[];
  matched: string[];
  unmatched: string[];
}

/** 公式サイト本文などから照合するための材料 */
export interface VerificationEvidence {
  /** 公式サイト候補のトップ/会社概要のテキスト */
  websiteText?: string | null;
  websiteTitle?: string | null;
  /** 公式サイト判定の信頼度（既存の official-site スコア） */
  officialSiteConfidence?: number | null;
}

const OFFICIAL_SOURCES: DiscoveryProviderName[] = ["gbiz", "edinet"];

/**
 * 企業本人確認スコア（0-100）。
 * 複数 Source の一致・公的情報の裏付け・公式サイトとの照合で加点する。
 * 重みと閾値は src/lib/config/discovery.ts で変更できる。
 */
export function verifyCandidate(candidate: MergedCandidate, evidence: VerificationEvidence = {}): VerificationResult {
  const { weights, thresholds } = getDiscoveryConfig();
  const signals: VerificationSignal[] = [];
  const text = evidence.websiteText ? toHalfWidth(evidence.websiteText) : "";
  const title = evidence.websiteTitle ? toHalfWidth(evidence.websiteTitle) : "";

  const add = (key: string, label: string, matched: boolean, points: number, detail?: string) =>
    signals.push({ key, label, matched, points: matched ? points : 0, detail });

  // 法人番号（GビズINFO 由来が最も強い根拠）
  add("corporate_number", "法人番号あり", Boolean(candidate.corporateNumber), weights.corporateNumber, candidate.corporateNumber ?? undefined);

  // 公的情報源に裏付けがある
  const officialSource = candidate.sources.some((s) => OFFICIAL_SOURCES.includes(s));
  add("official_source", "公的情報源で確認", officialSource, weights.officialSource, candidate.sources.join(", "));

  // 公式サイトのタイトル/本文に会社名が現れる
  const nameNorm = candidate.normalizedName;
  const haystack = normalizeCompanyName(`${title}\n${text.slice(0, 20_000)}`);
  const nameOnSite = Boolean(nameNorm) && haystack.includes(nameNorm);
  add("website_name", "公式サイトに会社名", nameOnSite, weights.websiteNameMatch);

  // 所在地の一致（企業サイトは都道府県を省くことが多いので、市区町村から下でも一致を取る）
  const addressMatch = addressAppearsIn(candidate.address, text);
  add("address", "所在地が一致", addressMatch, weights.addressMatch);

  // 電話番号の一致
  const digits = candidate.phone?.replace(/\D/g, "") ?? "";
  const phoneMatch = digits.length >= 10 && text.replace(/[^\d]/g, "").includes(digits);
  add("phone", "電話番号が一致", phoneMatch, weights.phoneMatch);

  // ドメインが特定できている（公式サイト判定を通過している）
  const domainMatch = Boolean(candidate.domain) && (evidence.officialSiteConfidence ?? 0) >= 60;
  add("domain", "公式ドメイン確認", domainMatch, weights.domainMatch, candidate.domain ?? undefined);

  // 複数 Provider が同一企業を指している
  const multi = candidate.sources.length >= 2;
  add("multi_source", "複数の情報源で一致", multi, weights.multiSource, `${candidate.sources.length}件`);

  const score = Math.max(0, Math.min(100, signals.reduce((sum, s) => sum + s.points, 0)));
  const status = score >= thresholds.verified ? "verified" : score >= thresholds.needsReview ? "needs_review" : "rejected";

  return {
    score,
    status,
    signals,
    matched: signals.filter((s) => s.matched).map((s) => s.label),
    unmatched: signals.filter((s) => !s.matched).map((s) => s.label),
  };
}

/** 検索条件に合致しない候補を落とす（都道府県違い等） */
export function matchesCriteria(candidate: MergedCandidate, criteria: { prefecture?: string; city?: string }): { ok: boolean; reason?: string } {
  if (criteria.prefecture && candidate.prefecture && candidate.prefecture !== criteria.prefecture) {
    return { ok: false, reason: `都道府県が条件と異なる（${candidate.prefecture}）` };
  }
  if (criteria.city && candidate.address && !candidate.address.includes(criteria.city)) {
    return { ok: false, reason: `市区町村が条件と異なる` };
  }
  return { ok: true };
}
