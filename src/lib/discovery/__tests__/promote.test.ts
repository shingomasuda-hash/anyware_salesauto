import { describe, expect, it } from "vitest";
import { rowToMerged, toCompanySource } from "../promote";
import { toCandidate } from "../normalizer";
import type { DiscoveryCandidateRow } from "@/db/types";
import type { Json } from "@/db/types";

function row(overrides: Partial<DiscoveryCandidateRow> = {}): DiscoveryCandidateRow {
  return {
    id: "c1",
    run_id: "r1",
    name: "株式会社山田製作所",
    normalized_name: "山田製作所",
    address: "大阪府東大阪市1-1",
    address_normalized: "大阪府東大阪市1-1",
    prefecture: "大阪府",
    city: "東大阪市",
    phone: "06-1234-5678",
    website: "https://yamada.co.jp",
    domain: "yamada.co.jp",
    corporate_number: "1234567890123",
    industry: "manufacturing",
    primary_source: "gbiz",
    sources: ["gbiz", "google_places"],
    source_confidence: 90,
    verification_score: 85,
    verification_signals: [] as unknown as Json,
    official_site_confidence: 87,
    recruiting_signal: "unknown",
    status: "verified",
    reject_reason: null,
    company_id: null,
    raw_data: {} as Json,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowToMerged", () => {
  it("保存した観測を復元する", () => {
    const observations = [
      toCandidate({ name: "株式会社山田製作所", source: "gbiz", sourceConfidence: 90 }),
      toCandidate({ name: "山田製作所", source: "google_places", sourceConfidence: 65 }),
    ];
    const merged = rowToMerged(row({ raw_data: { observations } as unknown as Json }));
    expect(merged.observations).toHaveLength(2);
    expect(merged.sources).toEqual(["gbiz", "google_places"]);
    expect(merged.corporateNumber).toBe("1234567890123");
  });

  it("観測が無い行でも自分自身を 1 観測として扱う", () => {
    const merged = rowToMerged(row({ raw_data: {} as Json }));
    expect(merged.observations).toHaveLength(1);
    expect(merged.observations[0].name).toBe("株式会社山田製作所");
  });

  it("sources が空なら primary_source を使う", () => {
    const merged = rowToMerged(row({ sources: [] }));
    expect(merged.sources).toEqual(["gbiz"]);
  });
});

describe("toCompanySource", () => {
  it("Provider 名を companies.source の許可値へ写す", () => {
    expect(toCompanySource("gbiz")).toBe("gbiz");
    expect(toCompanySource("google_places")).toBe("google_places");
    // companies.source の CHECK 制約に無い Provider は import として扱う
    expect(toCompanySource("web_search")).toBe("import");
    expect(toCompanySource("edinet")).toBe("import");
    expect(toCompanySource("official_web")).toBe("import");
  });
});
