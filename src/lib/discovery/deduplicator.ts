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
 * 法人番号が両方に付いていて値が違うなら、別法人と断定できる。
 *
 * 法人番号は Source of Truth。これを見落として社名の類似だけで統合すると、
 * 「増子製作所」のように同名の別法人が1社に畳まれ、8社が営業リストから消える。
 * 実データ検証で東京と大阪の9法人が1社になっていた。
 */
export function isDefinitelyDifferentCompany(
  a: { corporateNumber?: string | null },
  b: { corporateNumber?: string | null },
): boolean {
  return Boolean(a.corporateNumber && b.corporateNumber && a.corporateNumber !== b.corporateNumber);
}

/**
 * 候補が既存のどれと同一企業かを判定する。
 * 優先順位: 法人番号 > 公式ドメイン > 電話番号 > 会社名+住所 > 会社名+市区町村 > fuzzy
 *
 * 法人番号が食い違う相手は、どの根拠でも統合しない。
 */
export function findDuplicate(candidate: DiscoveryCandidate, existing: MergedCandidate[]): DuplicateMatch | null {
  // 別法人と断定できる相手は候補から外す
  const indexed = existing
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => !isDefinitelyDifferentCompany(candidate, e));

  const find = (pred: (e: MergedCandidate) => boolean): number => indexed.find(({ e }) => pred(e))?.index ?? -1;

  if (candidate.corporateNumber) {
    const i = find((e) => e.corporateNumber === candidate.corporateNumber);
    if (i >= 0) return { index: i, reason: "corporate_number" };
  }
  if (candidate.domain) {
    const i = find((e) => e.domain === candidate.domain);
    if (i >= 0) return { index: i, reason: "domain" };
  }
  if (candidate.phone) {
    const digits = candidate.phone.replace(/\D/g, "");
    const i = find((e) => Boolean(e.phone) && e.phone!.replace(/\D/g, "") === digits);
    if (i >= 0) return { index: i, reason: "phone" };
  }
  const addr = normalizeAddress(candidate.address);
  if (candidate.normalizedName && addr) {
    const i = find((e) => e.normalizedName === candidate.normalizedName && normalizeAddress(e.address) === addr);
    if (i >= 0) return { index: i, reason: "name_address" };
  }
  if (candidate.normalizedName && candidate.city) {
    const i = find((e) => e.normalizedName === candidate.normalizedName && e.city === candidate.city);
    if (i >= 0) return { index: i, reason: "name_city" };
  }
  // 表記ゆれ（記号・送り仮名の違い等）。
  // 同名の別法人を畳まないよう、市区町村が両方分かっていて一致することを必須にする。
  if (candidate.normalizedName.length >= 4 && candidate.city) {
    const i = find(
      (e) =>
        e.normalizedName.length >= 4 &&
        e.city === candidate.city &&
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
  const all = dedupeObservations([...base.observations, incoming]);
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

/**
 * 同じ観測の重複を取り除く。
 * 同一企業が複数のクエリで何度もヒットすると、同じ Provider の同じ観測が何十件も積み上がり、
 * company_sources に同じ行が並んでしまうため、情報源としての中身が同じものは 1 件にまとめる。
 */
export function dedupeObservations(observations: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  const result: DiscoveryCandidate[] = [];
  for (const o of observations) {
    const key = [o.source, o.sourceId ?? "", o.sourceUrl ?? "", o.normalizedName ?? o.name, o.address ?? "", o.website ?? "", o.phone ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(o);
  }
  return result;
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
