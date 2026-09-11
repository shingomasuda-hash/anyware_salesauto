import type { DiscoveryCandidateRow, DiscoveryProviderName } from "@/db/types";
import { similarity } from "./deduplicator";

export type ReconcileReason = "corporate_number" | "domain";

export interface ReconcileGroup {
  /** 情報を集約する側の候補 ID */
  survivorId: string;
  /** 重複として畳む候補 ID と、その根拠 */
  duplicates: { id: string; reason: ReconcileReason }[];
}

/**
 * 本人確認の結果として新しく判明した識別子（法人番号・公式ドメイン）で、
 * 発見時には結び付けられなかった候補同士を突き合わせる。
 *
 * 発見時点では GビズINFO の候補にドメインが無く、Web 検索の候補に住所・法人番号が無いため、
 * 「同じ会社を別の情報源が見つけていた」ことが分からない。公式サイト確認と法人番号照会の後で
 * もう一度だけ突き合わせることで、複数ソースの裏付けを実際に得られるようにする。
 *
 * 誤統合を防ぐため、ドメイン一致では
 * 「法人番号が矛盾していない」かつ「会社名が関連している」ことを必須にする。
 */
export function planReconciliation(rows: DiscoveryCandidateRow[]): ReconcileGroup[] {
  // 既に重複と分かっているもの（既存企業と一致）は対象外
  const eligible = rows.filter((r) => r.status !== "duplicate");
  if (eligible.length < 2) return [];
  const byId = new Map(eligible.map((r) => [r.id, r]));

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) && parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(rb, ra);
    return true;
  };
  for (const r of eligible) parent.set(r.id, r.id);

  const reasons = new Map<string, ReconcileReason>();

  const byCorp = new Map<string, string>();
  for (const r of eligible) {
    if (!r.corporate_number) continue;
    const prev = byCorp.get(r.corporate_number);
    if (!prev) {
      byCorp.set(r.corporate_number, r.id);
      continue;
    }
    if (union(prev, r.id)) reasons.set(r.id, "corporate_number");
  }

  const byDomain = new Map<string, string>();
  for (const r of eligible) {
    if (!r.domain) continue;
    const prev = byDomain.get(r.domain);
    if (!prev) {
      byDomain.set(r.domain, r.id);
      continue;
    }
    const other = byId.get(prev)!;
    // 法人番号が食い違う 2 社を同じドメインで束ねてはいけない（公式サイト誤判定の伝播）
    if (r.corporate_number && other.corporate_number && r.corporate_number !== other.corporate_number) continue;
    if (!namesLookRelated(other.normalized_name, r.normalized_name)) continue;
    if (union(prev, r.id)) reasons.set(r.id, "domain");
  }

  const groups = new Map<string, DiscoveryCandidateRow[]>();
  for (const r of eligible) {
    const root = find(r.id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(r);
  }

  const result: ReconcileGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(compareSurvivor);
    const survivor = sorted[0];
    result.push({
      survivorId: survivor.id,
      duplicates: sorted.slice(1).map((m) => ({ id: m.id, reason: reasons.get(m.id) ?? "domain" })),
    });
  }
  return result;
}

/** 会社名が同一企業と見なせる程度に関連しているか */
export function namesLookRelated(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return similarity(a, b) >= 0.6;
}

/** 情報を集約する側（残す側）を決める。確認済み > スコア > 情報源の数 > 発見が早い */
const STATUS_RANK: Record<string, number> = {
  verified: 5,
  needs_review: 4,
  discovered: 3,
  verifying: 3,
  rejected: 2,
  failed: 1,
  duplicate: 0,
};

function compareSurvivor(a: DiscoveryCandidateRow, b: DiscoveryCandidateRow): number {
  const rank = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0);
  if (rank !== 0) return rank;
  const score = (b.verification_score ?? 0) - (a.verification_score ?? 0);
  if (score !== 0) return score;
  const sources = sourceCount(b) - sourceCount(a);
  if (sources !== 0) return sources;
  return String(a.created_at).localeCompare(String(b.created_at));
}

function sourceCount(row: DiscoveryCandidateRow): number {
  return Array.isArray(row.sources) ? (row.sources as DiscoveryProviderName[]).length : 0;
}

export const RECONCILE_REASON_LABEL: Record<ReconcileReason, string> = {
  corporate_number: "法人番号が一致",
  domain: "公式ドメインが一致",
};
