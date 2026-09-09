import { normalizeAddress } from "@/lib/companies/normalize";
import type { DiscoveryCandidate, DiscoveryProviderName, MergedCandidate } from "./types";

export type DuplicateReason = "corporate_number" | "domain" | "phone" | "name_address" | "name_city" | "fuzzy_name";

export interface DuplicateMatch {
  index: number;
  reason: DuplicateReason;
}

/** レーベンシュタイン距離に基づく類似度（0-1） */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const [s, t] = a.length >= b.length ? [a, b] : [b, a];
  if (s.length - t.length > 4) return 0;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const curr = [i];
    for (let j = 1; j <= t.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return 1 - prev[t.length] / s.length;
}

const FUZZY_THRESHOLD = 0.88;

/**
 * 候補が既存のどれと同一企業かを判定する。
 * 優先順位: 法人番号 > 公式ドメイン > 電話番号 > 会社名+住所 > 会社名+市区町村 > fuzzy
 */
export function findDuplicate(candidate: DiscoveryCandidate, existing: MergedCandidate[]): DuplicateMatch | null {
  if (candidate.corporateNumber) {
    const i = existing.findIndex((e) => e.corporateNumber === candidate.corporateNumber);
    if (i >= 0) return { index: i, reason: "corporate_number" };
  }
  if (candidate.domain) {
    const i = existing.findIndex((e) => e.domain === candidate.domain);
    if (i >= 0) return { index: i, reason: "domain" };
  }
  if (candidate.phone) {
    const digits = candidate.phone.replace(/\D/g, "");
    const i = existing.findIndex((e) => e.phone && e.phone.replace(/\D/g, "") === digits);
    if (i >= 0) return { index: i, reason: "phone" };
  }
  const addr = normalizeAddress(candidate.address);
  if (candidate.normalizedName && addr) {
    const i = existing.findIndex((e) => e.normalizedName === candidate.normalizedName && normalizeAddress(e.address) === addr);
    if (i >= 0) return { index: i, reason: "name_address" };
  }
  if (candidate.normalizedName && candidate.city) {
    const i = existing.findIndex((e) => e.normalizedName === candidate.normalizedName && e.city === candidate.city);
    if (i >= 0) return { index: i, reason: "name_city" };
  }
  // 表記ゆれ（記号・送り仮名の違い等）。同一市区町村内でのみ許可して誤統合を防ぐ
  if (candidate.normalizedName.length >= 4) {
    const i = existing.findIndex(
      (e) =>
        e.normalizedName.length >= 4 &&
        (!candidate.city || !e.city || e.city === candidate.city) &&
        similarity(e.normalizedName, candidate.normalizedName) >= FUZZY_THRESHOLD,
    );
    if (i >= 0) return { index: i, reason: "fuzzy_name" };
  }
  return null;
}

/** 情報の確からしさ。公的情報源を優先し、検索スニペットは最も弱い */
const SOURCE_PRIORITY: Record<DiscoveryProviderName, number> = {
  gbiz: 100,
  edinet: 90,
  official_web: 80,
  google_places: 60,
  web_search: 30,
};

export function sourcePriority(source: DiscoveryProviderName): number {
  return SOURCE_PRIORITY[source] ?? 0;
}

/**
 * 同一企業の複数観測を統合する。
 * 値ごとに「最も信頼できる情報源」を採用し、他の観測は observations に残す
 * （Google の住所で GビズINFO の住所を勝手に上書きしない）。
 */
export function mergeCandidates(base: MergedCandidate, incoming: DiscoveryCandidate): MergedCandidate {
  const all = [...base.observations, incoming];
  const best = <K extends keyof DiscoveryCandidate>(field: K): DiscoveryCandidate[K] => {
    const withValue = all.filter((o) => o[field] !== null && o[field] !== undefined && o[field] !== "");
    if (withValue.length === 0) return base[field] as DiscoveryCandidate[K];
    withValue.sort((a, b) => sourcePriority(b.source) - sourcePriority(a.source) || b.sourceConfidence - a.sourceConfidence);
    return withValue[0][field];
  };

  const primary = [...all].sort((a, b) => sourcePriority(b.source) - sourcePriority(a.source) || b.sourceConfidence - a.sourceConfidence)[0];

  return {
    ...base,
    name: primary.name,
    normalizedName: primary.normalizedName,
    address: best("address"),
    prefecture: best("prefecture"),
    city: best("city"),
    phone: best("phone"),
    website: best("website"),
    domain: best("domain"),
    corporateNumber: best("corporateNumber"),
    industry: best("industry"),
    source: primary.source,
    sourceId: primary.sourceId,
    sourceUrl: primary.sourceUrl,
    sourceConfidence: Math.max(base.sourceConfidence, incoming.sourceConfidence),
    observations: all,
    sources: Array.from(new Set([...base.sources, incoming.source])),
  };
}

export function toMerged(candidate: DiscoveryCandidate): MergedCandidate {
  return { ...candidate, observations: [candidate], sources: [candidate.source] };
}

export interface DedupeResult {
  merged: MergedCandidate[];
  duplicateCount: number;
  reasons: Record<DuplicateReason, number>;
}

/** 候補配列を重複排除して統合する */
export function deduplicate(candidates: DiscoveryCandidate[], seed: MergedCandidate[] = []): DedupeResult {
  const merged: MergedCandidate[] = [...seed];
  const reasons: Record<DuplicateReason, number> = {
    corporate_number: 0,
    domain: 0,
    phone: 0,
    name_address: 0,
    name_city: 0,
    fuzzy_name: 0,
  };
  let duplicateCount = 0;

  for (const c of candidates) {
    const dup = findDuplicate(c, merged);
    if (dup) {
      merged[dup.index] = mergeCandidates(merged[dup.index], c);
      reasons[dup.reason] += 1;
      duplicateCount += 1;
    } else {
      merged.push(toMerged(c));
    }
  }
  return { merged, duplicateCount, reasons };
}
