import { describe, expect, it } from "vitest";
import { dedupeObservations, deduplicate, findDuplicate, mergeCandidates, similarity, sourcePriority, toMerged } from "../deduplicator";
import { cleanCompanyName, isPlausibleCompany, toCandidate } from "../normalizer";
import type { DiscoveryCandidate, DiscoveryProviderName } from "../types";

function make(overrides: Partial<Parameters<typeof toCandidate>[0]> & { name: string; source?: DiscoveryProviderName }): DiscoveryCandidate {
  return toCandidate({ sourceConfidence: 50, source: "web_search", ...overrides });
}

describe("cleanCompanyName", () => {
  it("検索結果タイトルの説明部分を落とす", () => {
    expect(cleanCompanyName("株式会社山田製作所 | 大阪の金属加工")).toBe("株式会社山田製作所");
    expect(cleanCompanyName("株式会社山田製作所の求人情報")).toBe("株式会社山田製作所");
    expect(cleanCompanyName("株式会社山田製作所 公式サイト")).toBe("株式会社山田製作所");
  });
});

describe("isPlausibleCompany", () => {
  it("記事タイトルのような候補を除外する", () => {
    expect(isPlausibleCompany(make({ name: "求人ランキング2026" }))).toBe(false);
    expect(isPlausibleCompany(make({ name: "金属加工とは" }))).toBe(false);
    expect(isPlausibleCompany(make({ name: "あ" }))).toBe(false);
    expect(isPlausibleCompany(make({ name: "株式会社山田製作所" }))).toBe(true);
  });
});

describe("similarity", () => {
  it("同一なら 1、無関係なら低い", () => {
    expect(similarity("山田製作所", "山田製作所")).toBe(1);
    expect(similarity("山田製作所", "山田製作")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("山田製作所", "鈴木工業")).toBeLessThan(0.4);
  });
});

describe("findDuplicate", () => {
  const existing = [
    toMerged(make({ name: "株式会社山田製作所", corporateNumber: "1234567890123", address: "大阪府東大阪市1-1", phone: "06-1234-5678", website: "https://yamada.co.jp", source: "gbiz" })),
  ];

  it("法人番号が一致すれば重複", () => {
    const m = findDuplicate(make({ name: "ヤマダ製作所", corporateNumber: "1234567890123" }), existing);
    expect(m?.reason).toBe("corporate_number");
  });

  it("ドメインが一致すれば重複", () => {
    const m = findDuplicate(make({ name: "全く別の名前", website: "https://yamada.co.jp/company" }), existing);
    expect(m?.reason).toBe("domain");
  });

  it("電話番号が一致すれば重複", () => {
    const m = findDuplicate(make({ name: "別名", phone: "0612345678" }), existing);
    expect(m?.reason).toBe("phone");
  });

  it("社名 + 所在地が一致すれば重複", () => {
    const m = findDuplicate(make({ name: "株式会社山田製作所", address: "大阪府東大阪市1-1" }), existing);
    expect(m).not.toBeNull();
  });

  it("無関係な企業は重複にしない", () => {
    expect(findDuplicate(make({ name: "鈴木工業株式会社", address: "東京都港区5-5" }), existing)).toBeNull();
  });

  it("同名でも都道府県が違えば重複にしない（誤結合の防止）", () => {
    const m = findDuplicate(make({ name: "株式会社山田製作所", address: "北海道札幌市1-1" }), existing);
    expect(m).toBeNull();
  });
});

describe("sourcePriority / mergeCandidates", () => {
  it("公的情報源ほど優先度が高い", () => {
    expect(sourcePriority("gbiz")).toBeGreaterThan(sourcePriority("google_places"));
    expect(sourcePriority("google_places")).toBeGreaterThan(sourcePriority("web_search"));
    expect(sourcePriority("edinet")).toBeGreaterThan(sourcePriority("official_web"));
  });

  it("優先度の高い情報源の値を採用し、観測はすべて残す", () => {
    const base = toMerged(make({ name: "山田製作所", address: "検索結果の住所", source: "web_search", sourceConfidence: 30 }));
    const gbiz = make({ name: "株式会社山田製作所", address: "大阪府東大阪市1-1", corporateNumber: "1234567890123", source: "gbiz", sourceConfidence: 90 });
    const merged = mergeCandidates(base, gbiz);

    expect(merged.corporateNumber).toBe("1234567890123");
    expect(merged.address).toBe("大阪府東大阪市1-1");
    expect(merged.observations).toHaveLength(2);
    expect(merged.sources).toEqual(expect.arrayContaining(["web_search", "gbiz"]));
  });

  it("優先度の低い情報源で既存の値を上書きしない", () => {
    const base = toMerged(make({ name: "株式会社山田製作所", address: "大阪府東大阪市1-1", source: "gbiz", sourceConfidence: 90 }));
    const merged = mergeCandidates(base, make({ name: "山田製作所", address: "違う住所", source: "web_search", sourceConfidence: 30 }));
    expect(merged.address).toBe("大阪府東大阪市1-1");
  });
});

describe("deduplicate", () => {
  it("同じ企業を 1 件にまとめ、理由を集計する", () => {
    const result = deduplicate([
      make({ name: "株式会社山田製作所", corporateNumber: "1234567890123", source: "gbiz", sourceConfidence: 90 }),
      make({ name: "ヤマダ製作所", corporateNumber: "1234567890123", website: "https://yamada.co.jp", source: "google_places", sourceConfidence: 65 }),
      make({ name: "鈴木工業株式会社", address: "東京都港区5-5" }),
    ]);
    expect(result.merged).toHaveLength(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.reasons.corporate_number).toBe(1);
  });

  it("seed（保存済み候補）に対しても重複判定する", () => {
    const seed = [toMerged(make({ name: "株式会社山田製作所", corporateNumber: "1234567890123", source: "gbiz" }))];
    const result = deduplicate([make({ name: "ヤマダ製作所", corporateNumber: "1234567890123" })], seed);
    expect(result.merged).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });
});

describe("dedupeObservations", () => {
  it("同じ情報源の同じ観測を1件に畳む", () => {
    // 同一企業が複数クエリでヒットしても company_sources に同じ行が並ばないようにする
    const gbiz = make({ name: "株式会社木村精機", corporateNumber: "1234567890123", address: "大阪府大阪市1-1", source: "gbiz", sourceConfidence: 90 });
    const observations = [gbiz, { ...gbiz }, { ...gbiz }, make({ name: "株式会社木村精機", website: "https://kimura.example.jp", source: "web_search" })];
    expect(dedupeObservations(observations)).toHaveLength(2);
  });

  it("同じ Provider でも観測内容が違えば残す", () => {
    const a = make({ name: "株式会社木村精機", address: "大阪府大阪市1-1", source: "gbiz" });
    const b = make({ name: "株式会社木村精機", address: "大阪府大阪市2-2", source: "gbiz" });
    expect(dedupeObservations([a, b])).toHaveLength(2);
  });

  it("mergeCandidates が同じ観測を積み上げない", () => {
    const base = toMerged(make({ name: "株式会社木村精機", corporateNumber: "1234567890123", source: "gbiz", sourceConfidence: 90 }));
    const same = make({ name: "株式会社木村精機", corporateNumber: "1234567890123", source: "gbiz", sourceConfidence: 90 });
    let merged = base;
    for (let i = 0; i < 8; i++) merged = mergeCandidates(merged, { ...same });
    expect(merged.observations).toHaveLength(1);
    expect(merged.sources).toEqual(["gbiz"]);
  });
});
