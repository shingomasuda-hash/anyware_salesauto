import { describe, expect, it } from "vitest";
import { generateDirectoryTerms, generateSearchTerms, PUBLIC_DIRECTORY_HINTS } from "../query-generator";
import { buildShards, citiesFor, MAJOR_CITIES } from "../query-sharding";
import { planFallbackQueries, planQueries } from "../query-planner";
import { MockGbizProvider, MockPlacesProvider, MockWebSearchProvider } from "../providers/mock";
import type { DiscoveryCriteria } from "../types";

const base: DiscoveryCriteria = {
  prefecture: "大阪府",
  industry: "manufacturing",
  recruitingRequired: false,
  websiteRequired: true,
  maxResults: 20,
};

describe("generateSearchTerms", () => {
  it("業種を細分化した複数の検索語へ展開する", () => {
    const terms = generateSearchTerms(base, 12);
    expect(terms.length).toBeGreaterThan(3);
    expect(terms[0]).toContain("大阪府");
    // 「大阪府 製造業」1本で終わらない
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.some((t) => t.includes("金属加工"))).toBe(true);
  });

  it("業種詳細を指定した場合はその語だけを展開する", () => {
    const terms = generateSearchTerms({ ...base, industrySubcategory: "precision_processing" }, 12);
    expect(terms.every((t) => /精密|NC旋盤/.test(t))).toBe(true);
  });

  it("キーワードを最優先する", () => {
    const terms = generateSearchTerms({ ...base, keywords: ["板金"] }, 5);
    expect(terms[0]).toBe("大阪府 板金");
  });

  it("maxTerms を超えて生成しない（API 乱打の防止）", () => {
    expect(generateSearchTerms(base, 3)).toHaveLength(3);
  });

  it("採用条件つきなら採用系の語を足す", () => {
    const terms = generateSearchTerms({ ...base, recruitingRequired: true }, 30);
    expect(terms.some((t) => t.includes("求人 採用"))).toBe(true);
  });
});

describe("generateDirectoryTerms", () => {
  it("公開企業一覧を狙う検索語を作る", () => {
    const terms = generateDirectoryTerms(base, 2);
    expect(terms).toHaveLength(2);
    expect(terms[0]).toContain(PUBLIC_DIRECTORY_HINTS[0]);
  });

  it("地域が無ければ生成しない", () => {
    expect(generateDirectoryTerms({ ...base, prefecture: undefined }, 3)).toEqual([]);
  });
});

describe("buildShards", () => {
  it("市区町村 × 業種細分に分割する", () => {
    const shards = buildShards(base, citiesFor("大阪府"), 10);
    expect(shards).toHaveLength(10);
    expect(shards[0].city).toBe(MAJOR_CITIES["大阪府"][0]);
    expect(shards[0].subcategory).toBeTruthy();
  });

  it("市区町村が指定済みならその 1 都市のみで分割する", () => {
    const shards = buildShards({ ...base, city: "東大阪市" }, citiesFor("大阪府"), 10);
    expect(shards.every((s) => s.city === "東大阪市")).toBe(true);
  });

  it("maxShards を超えない", () => {
    expect(buildShards(base, citiesFor("大阪府"), 3)).toHaveLength(3);
  });

  it("未知の都道府県でも落ちない", () => {
    const shards = buildShards({ ...base, prefecture: "鳥取県" }, citiesFor("鳥取県"), 5);
    expect(shards.length).toBeGreaterThan(0);
  });
});

describe("planQueries", () => {
  const providers = [new MockGbizProvider(), new MockPlacesProvider(), new MockWebSearchProvider()];

  it("GビズINFO を先頭に置き、複数 Provider へ展開する", () => {
    const queries = planQueries(base, providers);
    expect(queries[0].provider).toBe("gbiz");
    const used = new Set(queries.map((q) => q.provider));
    expect(used.has("gbiz")).toBe(true);
    expect(used.has("google_places")).toBe(true);
    expect(used.has("web_search")).toBe(true);
  });

  it("Provider を交互に並べる（予算切れで 1 情報源しか使われないのを防ぐ）", () => {
    const queries = planQueries(base, providers);
    // 先頭は必ず GビズINFO（法人番号の土台を先に作る）
    expect(queries[0].provider).toBe("gbiz");
    // 先頭から少数のクエリだけでも複数 Provider に届く
    const firstSix = new Set(queries.slice(0, 6).map((q) => q.provider));
    expect(firstSix.size).toBeGreaterThanOrEqual(3);
  });

  it("クエリ ID は一意（cursor で再開できる）", () => {
    const queries = planQueries(base, providers);
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
  });

  it("利用できる Provider のみを計画する", () => {
    const queries = planQueries(base, [new MockGbizProvider()]);
    expect(queries.every((q) => q.provider === "gbiz")).toBe(true);
  });

  it("不足分だけ追加クエリを計画する", () => {
    const extra = planFallbackQueries(base, providers, ["q0", "q1"], 10);
    expect(extra.length).toBeGreaterThan(0);
    expect(extra.length).toBeLessThanOrEqual(6);
    expect(planFallbackQueries(base, providers, [], 0)).toEqual([]);
  });
});
