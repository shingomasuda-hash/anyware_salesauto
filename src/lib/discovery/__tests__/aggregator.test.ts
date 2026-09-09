import { describe, expect, it } from "vitest";
import { aggregateCandidates } from "../aggregator";
import { createBudgetTracker } from "../budget";
import { toCandidate } from "../normalizer";
import type { CompanyDiscoveryProvider, DiscoveryBudget, DiscoveryCandidate, DiscoveryContext, DiscoveryCriteria, DiscoveryProviderName, DiscoveryQuery } from "../types";

const criteria: DiscoveryCriteria = { prefecture: "大阪府", industry: "manufacturing", recruitingRequired: false, websiteRequired: true, maxResults: 20 };

const budget: DiscoveryBudget = {
  maxProviderRequests: 10,
  maxCandidates: 100,
  maxVerificationRequests: 10,
  maxCrawlPages: 10,
  maxAiCalls: 10,
  maxExecutionMinutes: 60,
};

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    runId: "run-1",
    criteria,
    budget: createBudgetTracker(budget),
    deadline: Date.now() + 60_000,
    log: async () => {},
    ...overrides,
  };
}

class StubProvider implements CompanyDiscoveryProvider {
  calls = 0;
  constructor(
    readonly name: DiscoveryProviderName,
    private readonly results: DiscoveryCandidate[],
    private readonly fail = false,
  ) {}
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(): Promise<DiscoveryCandidate[]> {
    this.calls++;
    if (this.fail) throw new Error("provider down");
    return this.results;
  }
}

function query(provider: DiscoveryProviderName, id: string): DiscoveryQuery {
  return { id, provider, criteria, text: "大阪府 金属加工" };
}

const gbizResult = toCandidate({ name: "株式会社山田製作所", corporateNumber: "1234567890123", address: "大阪府東大阪市1-1", source: "gbiz", sourceConfidence: 90 });
const placesResult = toCandidate({ name: "山田製作所", website: "https://yamada.co.jp", address: "大阪府東大阪市1-1", source: "google_places", sourceConfidence: 65 });
const otherResult = toCandidate({ name: "鈴木工業株式会社", address: "大阪府堺市2-2", source: "web_search", sourceConfidence: 30 });

describe("aggregateCandidates", () => {
  it("複数 Provider の結果を統合し、重複は 1 件にまとめる", async () => {
    const providers = [new StubProvider("gbiz", [gbizResult]), new StubProvider("google_places", [placesResult, otherResult])];
    const result = await aggregateCandidates([query("gbiz", "q0"), query("google_places", "q1")], providers, context());

    expect(result.merged).toHaveLength(2);
    expect(result.dedupe.duplicateCount).toBe(1);
    expect(result.stats.gbiz?.requestCount).toBe(1);
    expect(result.stats.google_places?.resultCount).toBe(2);
    expect(result.stoppedReason).toBe("completed");
  });

  it("Provider 単体の失敗で全体を止めない", async () => {
    const failing = new StubProvider("web_search", [], true);
    const working = new StubProvider("gbiz", [gbizResult]);
    const result = await aggregateCandidates([query("web_search", "q0"), query("gbiz", "q1")], [failing, working], context());

    expect(result.merged).toHaveLength(1);
    expect(result.stats.web_search?.failedCount).toBe(1);
    expect(working.calls).toBe(1);
  });

  it("Provider リクエストの予算を超えたら止める", async () => {
    const provider = new StubProvider("gbiz", [gbizResult]);
    const tracker = createBudgetTracker({ ...budget, maxProviderRequests: 2 });
    const queries = [query("gbiz", "q0"), query("gbiz", "q1"), query("gbiz", "q2")];
    const result = await aggregateCandidates(queries, [provider], context({ budget: tracker }));

    expect(provider.calls).toBe(2);
    expect(result.stoppedReason).toBe("budget");
  });

  it("締切を過ぎたら止める", async () => {
    const provider = new StubProvider("gbiz", [gbizResult]);
    const result = await aggregateCandidates([query("gbiz", "q0")], [provider], context({ deadline: Date.now() - 1 }));
    expect(provider.calls).toBe(0);
    expect(result.stoppedReason).toBe("deadline");
  });

  it("企業として扱えない候補を除外する", async () => {
    const junk = toCandidate({ name: "求人ランキング2026", source: "web_search", sourceConfidence: 30 });
    const provider = new StubProvider("web_search", [junk, otherResult]);
    const result = await aggregateCandidates([query("web_search", "q0")], [provider], context());
    expect(result.merged).toHaveLength(1);
    expect(result.stats.web_search?.resultCount).toBe(1);
  });

  it("seed（保存済み候補）を引き継いで重複判定する", async () => {
    const provider = new StubProvider("google_places", [placesResult]);
    const seed = [{ ...gbizResult, observations: [gbizResult], sources: ["gbiz" as const] }];
    const result = await aggregateCandidates([query("google_places", "q0")], [provider], context(), seed);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].sources).toEqual(expect.arrayContaining(["gbiz", "google_places"]));
  });

  it("計画に無い Provider のクエリは実行しない", async () => {
    const provider = new StubProvider("gbiz", [gbizResult]);
    const result = await aggregateCandidates([query("edinet", "q0")], [provider], context());
    expect(provider.calls).toBe(0);
    expect(result.merged).toHaveLength(0);
  });
});
