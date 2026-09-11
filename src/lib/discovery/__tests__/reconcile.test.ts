/**
 * 本人確認後のクロスソース突き合わせ。
 *
 * 発見時点では GビズINFO 側に公式ドメインが無く、Web 検索側に法人番号・住所が無いため、
 * 同じ会社でも別候補として保存される。公式サイト確認と法人番号照会の後で突き合わせて、
 * 「複数ソースで裏付けが取れた」状態を実際に作れることを固定する。
 */
import { describe, expect, it } from "vitest";
import type { DiscoveryCandidateRow, DiscoveryCandidateStatus, DiscoveryProviderName } from "@/db/types";
import { namesLookRelated, planReconciliation } from "../reconcile";

let seq = 0;

function row(partial: Partial<DiscoveryCandidateRow> & { name: string }): DiscoveryCandidateRow {
  seq += 1;
  return {
    id: partial.id ?? `c${seq}`,
    run_id: "run1",
    normalized_name: partial.normalized_name ?? partial.name,
    address: null,
    address_normalized: null,
    prefecture: null,
    city: null,
    phone: null,
    website: null,
    domain: null,
    corporate_number: null,
    industry: null,
    primary_source: "gbiz" as DiscoveryProviderName,
    sources: ["gbiz"] as DiscoveryProviderName[],
    source_confidence: 80,
    status: "verified" as DiscoveryCandidateStatus,
    verification_score: 70,
    verification_signals: null,
    official_site_confidence: null,
    recruiting_signal: "unknown",
    reject_reason: null,
    company_id: null,
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    raw_data: null,
    created_at: `2026-01-0${(seq % 9) + 1}T00:00:00.000Z`,
    updated_at: null,
    locked_at: null,
    ...partial,
  } as DiscoveryCandidateRow;
}

describe("本人確認後の突き合わせ", () => {
  it("公式ドメインが一致した別ソースの候補を1社に畳む", () => {
    const gbiz = row({ id: "a", name: "株式会社山田製作所", normalized_name: "山田製作所", domain: "yamada-ss.co.jp", corporate_number: "1234567890123", verification_score: 85 });
    const web = row({
      id: "b",
      name: "山田製作所",
      normalized_name: "山田製作所",
      domain: "yamada-ss.co.jp",
      primary_source: "web_search",
      sources: ["web_search"],
      status: "needs_review",
      verification_score: 55,
    });

    const groups = planReconciliation([gbiz, web]);
    expect(groups).toHaveLength(1);
    // 確認済み・高スコア側を残す
    expect(groups[0].survivorId).toBe("a");
    expect(groups[0].duplicates).toEqual([{ id: "b", reason: "domain" }]);
  });

  it("法人番号が一致すれば住所やドメインが無くても畳む", () => {
    const a = row({ id: "a", name: "眞木鉄工所", corporate_number: "9876543210987" });
    const b = row({ id: "b", name: "まき鉄工所", corporate_number: "9876543210987", primary_source: "web_search", sources: ["web_search"], status: "rejected", verification_score: 10 });
    const groups = planReconciliation([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].survivorId).toBe("a");
    expect(groups[0].duplicates[0].reason).toBe("corporate_number");
  });

  it("同じドメインでも法人番号が食い違えば畳まない（公式サイト誤判定の伝播を防ぐ）", () => {
    const a = row({ id: "a", name: "大和金属工業", domain: "example.co.jp", corporate_number: "1111111111111" });
    const b = row({ id: "b", name: "大和金属工業所", domain: "example.co.jp", corporate_number: "2222222222222" });
    expect(planReconciliation([a, b])).toHaveLength(0);
  });

  it("同じドメインでも社名が無関係なら畳まない", () => {
    const a = row({ id: "a", name: "木村精機", normalized_name: "木村精機", domain: "houjinbase.example.jp" });
    const b = row({ id: "b", name: "浪速樹脂工業", normalized_name: "浪速樹脂工業", domain: "houjinbase.example.jp" });
    expect(planReconciliation([a, b])).toHaveLength(0);
  });

  it("既に重複と判定された候補は突き合わせ対象にしない", () => {
    const a = row({ id: "a", name: "高千穂精機", domain: "takachiho.example.jp", status: "duplicate" });
    const b = row({ id: "b", name: "高千穂精機", domain: "takachiho.example.jp" });
    expect(planReconciliation([a, b])).toHaveLength(0);
  });

  it("3件以上が同じ企業を指す場合も1件だけ残す", () => {
    const a = row({ id: "a", name: "旭化学工業", domain: "asahi-chemi.example.jp", verification_score: 90 });
    const b = row({ id: "b", name: "旭化学工業株式会社", normalized_name: "旭化学工業", domain: "asahi-chemi.example.jp", status: "needs_review", verification_score: 50 });
    const c = row({ id: "c", name: "旭化学工業", domain: "asahi-chemi.example.jp", status: "rejected", verification_score: 20 });
    const groups = planReconciliation([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].survivorId).toBe("a");
    expect(groups[0].duplicates.map((d) => d.id).sort()).toEqual(["b", "c"]);
  });

  it("識別子が無い候補は畳まない（名前だけで統合しない）", () => {
    const a = row({ id: "a", name: "山田製作所", normalized_name: "山田製作所" });
    const b = row({ id: "b", name: "山田製作所", normalized_name: "山田製作所", primary_source: "web_search", sources: ["web_search"] });
    expect(planReconciliation([a, b])).toHaveLength(0);
  });
});

describe("社名の関連判定", () => {
  it("片方が他方を含む場合は関連とみなす", () => {
    expect(namesLookRelated("山田製作所", "山田製作所大阪工場")).toBe(true);
  });
  it("表記ゆれは関連とみなす", () => {
    expect(namesLookRelated("眞木鉄工所", "真木鉄工所")).toBe(true);
  });
  it("無関係な社名は関連としない", () => {
    expect(namesLookRelated("木村精機", "浪速樹脂工業")).toBe(false);
  });
  it("片方が空なら関連としない", () => {
    expect(namesLookRelated(null, "山田製作所")).toBe(false);
  });
});
