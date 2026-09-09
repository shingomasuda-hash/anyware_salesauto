import { afterEach, describe, expect, it } from "vitest";
import { createBudgetTracker } from "../budget";
import { getProviderAvailability, resolveProviders } from "../providers";
import { setSearchEngine, WebSearchDiscoveryProvider, type SearchEngine, type SearchResultItem } from "../providers/web-search";
import { discoveryCriteriaSchema, toDiscoveryCriteria, toDiscoveryMode } from "../criteria";
import type { DiscoveryBudget, DiscoveryContext, DiscoveryCriteria } from "../types";

const criteria: DiscoveryCriteria = { prefecture: "大阪府", industry: "manufacturing", recruitingRequired: false, websiteRequired: true, maxResults: 20 };

const budget: DiscoveryBudget = {
  maxProviderRequests: 10,
  maxCandidates: 100,
  maxVerificationRequests: 10,
  maxCrawlPages: 10,
  maxAiCalls: 10,
  maxExecutionMinutes: 60,
};

const context: DiscoveryContext = {
  runId: "run-1",
  criteria,
  budget: createBudgetTracker(budget),
  deadline: Date.now() + 60_000,
  log: async () => {},
};

class StubEngine implements SearchEngine {
  readonly name = "stub";
  constructor(private readonly results: SearchResultItem[]) {}
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(): Promise<SearchResultItem[]> {
    return this.results;
  }
}

afterEach(() => setSearchEngine(null));

describe("resolveProviders", () => {
  it("DISCOVERY_MODE で使う Provider を制限する", () => {
    expect(resolveProviders("gbiz").providers.map((p) => p.name)).toEqual(["gbiz"]);
    expect(resolveProviders("places").providers.map((p) => p.name)).toEqual(["google_places"]);
    expect(resolveProviders("search").providers.map((p) => p.name)).toEqual(["web_search"]);
  });

  it("hybrid は複数 Provider を返す", () => {
    const names = resolveProviders("hybrid").providers.map((p) => p.name);
    expect(names).toContain("gbiz");
    expect(names.length).toBeGreaterThan(1);
  });

  it("GビズINFO は常に選択肢として残っている（Source of Truth）", () => {
    expect(getProviderAvailability().some((p) => p.name === "gbiz")).toBe(true);
  });

  it("公式サイト確認 Provider は外部APIキー不要で常に使える", () => {
    const officialWeb = getProviderAvailability().find((p) => p.name === "official_web");
    expect(officialWeb?.available).toBe(true);
  });
});

describe("WebSearchDiscoveryProvider", () => {
  it("検索エンジンは差し替え可能（Brave 固有の実装に依存しない）", () => {
    const engine = new StubEngine([]);
    setSearchEngine(engine);
    expect(new WebSearchDiscoveryProvider().isAvailable()).toBe(true);
  });

  it("求人媒体・SNS など非公式ドメインを候補にしない", async () => {
    const provider = new WebSearchDiscoveryProvider(
      new StubEngine([
        { title: "株式会社山田製作所の求人", url: "https://jp.indeed.com/xyz", description: "" },
        { title: "株式会社山田製作所", url: "https://www.facebook.com/yamada", description: "" },
        { title: "株式会社山田製作所 | 大阪の金属加工", url: "https://yamada-ss.co.jp/", description: "" },
      ]),
    );
    const results = await provider.search({ id: "q0", provider: "web_search", criteria, text: "大阪府 金属加工" }, context);
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("yamada-ss.co.jp");
    expect(results[0].name).toBe("株式会社山田製作所");
  });

  it("同一ドメインは 1 件にまとめる", async () => {
    const provider = new WebSearchDiscoveryProvider(
      new StubEngine([
        { title: "株式会社山田製作所", url: "https://yamada-ss.co.jp/", description: "" },
        { title: "株式会社山田製作所 会社概要", url: "https://yamada-ss.co.jp/company", description: "" },
      ]),
    );
    const results = await provider.search({ id: "q0", provider: "web_search", criteria, text: "x" }, context);
    expect(results).toHaveLength(1);
  });

  it("検索結果の確度は最も低く設定される（そのまま企業登録させない）", async () => {
    const provider = new WebSearchDiscoveryProvider(new StubEngine([{ title: "株式会社山田製作所", url: "https://yamada-ss.co.jp/", description: "" }]));
    const results = await provider.search({ id: "q0", provider: "web_search", criteria, text: "x" }, context);
    expect(results[0].sourceConfidence).toBeLessThanOrEqual(30);
  });
});

describe("discoveryCriteriaSchema", () => {
  it("フォーム入力を探索条件へ変換する", () => {
    const parsed = discoveryCriteriaSchema.parse({
      prefecture: "大阪府",
      industry: "manufacturing",
      industrySubcategory: "metal_processing",
      requestedCount: "20",
      mode: "hybrid",
      requireWebsite: "on",
    });
    const c = toDiscoveryCriteria(parsed);
    expect(c.maxResults).toBe(20);
    expect(c.websiteRequired).toBe(true);
    expect(c.recruitingRequired).toBe(false);
    expect(c.industrySubcategory).toBe("metal_processing");
  });

  it("企業規模プリセットを従業員数レンジへ展開する", () => {
    const parsed = discoveryCriteriaSchema.parse({ companySize: "small", requestedCount: "10" });
    const c = toDiscoveryCriteria(parsed);
    expect(c.employeeMin ?? c.employeeMax).toBeDefined();
  });

  it("auto は環境変数の DISCOVERY_MODE に委ねる", () => {
    expect(toDiscoveryMode("auto")).toBeUndefined();
    expect(toDiscoveryMode("gbiz")).toBe("gbiz");
  });

  it("空文字は未指定として扱う", () => {
    const parsed = discoveryCriteriaSchema.parse({ prefecture: "", city: "", industry: "", requestedCount: "" });
    expect(parsed.prefecture).toBeUndefined();
    expect(parsed.requestedCount).toBe(50);
  });

  it("上限を超える件数は拒否する", () => {
    expect(discoveryCriteriaSchema.safeParse({ requestedCount: "9999" }).success).toBe(false);
  });
});
