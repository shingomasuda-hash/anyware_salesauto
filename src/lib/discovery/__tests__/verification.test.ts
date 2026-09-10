import { describe, expect, it } from "vitest";
import { getDiscoveryConfig } from "@/lib/config/discovery";
import { matchesCriteria, verifyCandidate } from "../verifier";
import { toMerged } from "../deduplicator";
import { toCandidate } from "../normalizer";
import { detectRecruitingSignal } from "../signals";
import type { MergedCandidate } from "../types";

const SITE_TEXT = `株式会社山田製作所 会社概要
所在地: 大阪府東大阪市長田1-2-3
電話: 06-1234-5678
金属加工・精密部品の製造`;

function candidate(overrides: Partial<MergedCandidate> = {}): MergedCandidate {
  const base = toMerged(
    toCandidate({
      name: "株式会社山田製作所",
      address: "大阪府東大阪市長田1-2-3",
      phone: "06-1234-5678",
      website: "https://yamada-ss.co.jp",
      corporateNumber: "1234567890123",
      source: "gbiz",
      sourceConfidence: 90,
    }),
  );
  return { ...base, sources: ["gbiz"], ...overrides };
}

describe("verifyCandidate", () => {
  const { thresholds } = getDiscoveryConfig();

  it("法人番号 + 公式サイト照合が揃えば verified", () => {
    const r = verifyCandidate(candidate(), { websiteText: SITE_TEXT, websiteTitle: "株式会社山田製作所", officialSiteConfidence: 85 });
    expect(r.score).toBeGreaterThanOrEqual(thresholds.verified);
    expect(r.status).toBe("verified");
    expect(r.matched).toContain("法人番号あり");
  });

  it("Web検索だけの候補は verified にならない（そのまま企業登録させない）", () => {
    const weak = candidate({ corporateNumber: null, sources: ["web_search"], source: "web_search" });
    const r = verifyCandidate(weak, {});
    expect(r.status).not.toBe("verified");
    expect(r.score).toBeLessThan(thresholds.verified);
  });

  it("裏付けが中程度なら needs_review（人の確認へ回す）", () => {
    const mid = candidate({ corporateNumber: null, sources: ["google_places", "web_search"] });
    const r = verifyCandidate(mid, { websiteText: SITE_TEXT, websiteTitle: "株式会社山田製作所", officialSiteConfidence: 70 });
    expect(r.status).toBe("needs_review");
    expect(r.score).toBeGreaterThanOrEqual(thresholds.needsReview);
  });

  it("公式サイト本文と一致しない項目は加点しない", () => {
    const r = verifyCandidate(candidate(), { websiteText: "全く関係のない文章", websiteTitle: "他社サイト", officialSiteConfidence: 20 });
    expect(r.unmatched).toContain("公式サイトに会社名");
    expect(r.unmatched).toContain("電話番号が一致");
    expect(r.unmatched).toContain("公式ドメイン確認");
  });

  it("配点の合計は 100 を超える（cap が必要な設計であることを明示）", () => {
    const { weights } = getDiscoveryConfig();
    const rawMax = Object.values(weights).reduce((sum, w) => sum + w, 0);
    expect(rawMax).toBeGreaterThan(100);
  });

  it("全シグナル一致でも 100 で cap される（0-100 に正規化）", () => {
    const perfect = candidate({ sources: ["gbiz", "edinet", "google_places", "web_search"] });
    const r = verifyCandidate(perfect, {
      websiteText: SITE_TEXT,
      websiteTitle: "株式会社山田製作所",
      officialSiteConfidence: 100,
    });
    // 全項目一致 → 素点 110 だが、保存・表示されるスコアは 100
    expect(r.signals.every((sig) => sig.matched)).toBe(true);
    const rawTotal = r.signals.reduce((sum, sig) => sum + sig.points, 0);
    expect(rawTotal).toBeGreaterThan(100);
    expect(r.score).toBe(100);
  });

  it("シグナルが 1 つも一致しなくても 0 未満にならない", () => {
    const bare = candidate({ corporateNumber: null, phone: null, domain: null, sources: ["web_search"], source: "web_search" });
    const r = verifyCandidate(bare, {});
    expect(r.score).toBe(0);
    expect(r.status).toBe("rejected");
  });

  it("どの入力でもスコアは 0-100 の整数に収まる", () => {
    const cases = [
      candidate(),
      candidate({ corporateNumber: null }),
      candidate({ sources: ["gbiz", "edinet", "google_places", "web_search", "official_web"] }),
      candidate({ address: null, phone: null, domain: null, corporateNumber: null, sources: ["web_search"] }),
    ];
    for (const c of cases) {
      for (const ev of [{}, { websiteText: SITE_TEXT, websiteTitle: c.name, officialSiteConfidence: 100 }]) {
        const r = verifyCandidate(c, ev);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.score)).toBe(true);
      }
    }
  });

  it("シグナルの内訳を必ず返す（判断根拠を UI に出せる）", () => {
    const r = verifyCandidate(candidate(), { websiteText: SITE_TEXT });
    expect(r.signals.length).toBeGreaterThan(4);
    for (const s of r.signals) expect(typeof s.label).toBe("string");
  });
});

describe("matchesCriteria", () => {
  it("都道府県が違う候補を落とす", () => {
    const r = matchesCriteria(candidate({ prefecture: "東京都" }), { prefecture: "大阪府" });
    expect(r.ok).toBe(false);
  });

  it("市区町村が違う候補を落とす", () => {
    expect(matchesCriteria(candidate(), { city: "堺市" }).ok).toBe(false);
    expect(matchesCriteria(candidate(), { city: "東大阪市" }).ok).toBe(true);
  });

  it("所在地が不明な候補は落とさない（情報不足を条件違反にしない）", () => {
    expect(matchesCriteria(candidate({ prefecture: null, address: null }), { prefecture: "大阪府" }).ok).toBe(true);
  });
});

describe("detectRecruitingSignal", () => {
  it("採用ページの痕跡があれば yes", () => {
    expect(detectRecruitingSignal([{ url: "https://x.co.jp/recruit", text: "" }])).toBe("yes");
    expect(detectRecruitingSignal([{ url: "https://x.co.jp/", text: "採用情報はこちら" }])).toBe("yes");
  });

  it("本文を取得できていれば no と判断する", () => {
    expect(detectRecruitingSignal([{ url: "https://x.co.jp/", text: "あ".repeat(300) }])).toBe("no");
  });

  it("材料が無ければ unknown（推測しない）", () => {
    expect(detectRecruitingSignal([])).toBe("unknown");
    expect(detectRecruitingSignal([{ url: "https://x.co.jp/", text: "短い" }])).toBe("unknown");
  });
});
