/**
 * 公式サイト確認 Provider を、実サイトに近い HTML を配信するローカル HTTP サーバーで検証する。
 * 「検索結果の 1 件目 = 公式サイト」としないこと、
 * 取得できた本文が本人確認スコアへ正しく効くことを確かめる。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBudgetTracker } from "../budget";
import { toMerged } from "../deduplicator";
import { toCandidate } from "../normalizer";
import { OfficialWebProvider } from "../providers/official-web";
import { verifyCandidate } from "../verifier";
import type { DiscoveryBudget, DiscoveryContext, DiscoveryCriteria, MergedCandidate } from "../types";

const pages: Record<string, { html: string; status?: number }> = {
  // 本物の公式サイト
  "/official/": {
    html: `<html><head><title>株式会社大阪精密工業</title></head><body>
      <h1>株式会社大阪精密工業</h1>
      <p>所在地: 大阪府大阪市中央区本町1丁目2番3号</p>
      <p>TEL: 06-6123-4567</p>
      <p>金属部品の精密加工を行っています。</p>
      <a href="/official/recruit/">採用情報</a>
      </body></html>`,
  },
  // 同名だが全く別の企業のサイト（誤って公式扱いしてはいけない）
  "/other/": {
    html: `<html><head><title>ペットショップわんわん</title></head><body>
      <p>犬と猫の専門店です。東京都渋谷区。</p></body></html>`,
  },
  "/gone/": { html: "not found", status: 404 },
};

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const page = pages[req.url ?? "/"];
    if (!page) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(page.status ?? 200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page.html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

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
  return { runId: "run-1", criteria, budget: createBudgetTracker(budget), deadline: Date.now() + 60_000, log: async () => {}, ...overrides };
}

function candidateWith(urls: string[]): MergedCandidate {
  const base = toMerged(
    toCandidate({
      name: "株式会社大阪精密工業",
      address: "大阪府大阪市中央区本町1丁目2番3号",
      phone: "06-6123-4567",
      corporateNumber: "1234567890123",
      source: "gbiz",
      sourceConfidence: 90,
      website: urls[0],
    }),
  );
  return {
    ...base,
    observations: urls.map((u, i) => toCandidate({ name: "株式会社大阪精密工業", website: u, source: i === 0 ? "gbiz" : "web_search", sourceConfidence: i === 0 ? 90 : 30 })),
    sources: ["gbiz"],
  };
}

describe("OfficialWebProvider.checkOfficialSite", () => {
  it("会社名・所在地・電話が一致する候補を公式サイトと判定する", async () => {
    const check = await new OfficialWebProvider().checkOfficialSite(candidateWith([`${baseUrl}/official/`]), context());
    expect(check.status).toBe("verified");
    expect(check.url).toContain("/official/");
    expect(check.confidence ?? 0).toBeGreaterThan(60);
    expect(check.text).toContain("精密加工");
  });

  it("同名でも内容が一致しないサイトは公式と断定しない", async () => {
    const check = await new OfficialWebProvider().checkOfficialSite(candidateWith([`${baseUrl}/other/`]), context());
    expect(check.status).not.toBe("verified");
  });

  it("複数の候補 URL から一致するものを選ぶ（1件目を無条件に採用しない）", async () => {
    const check = await new OfficialWebProvider().checkOfficialSite(candidateWith([`${baseUrl}/other/`, `${baseUrl}/official/`]), context());
    expect(check.url).toContain("/official/");
  });

  it("取得できなければ no_website（推測でURLを作らない）", async () => {
    const check = await new OfficialWebProvider().checkOfficialSite(candidateWith([`${baseUrl}/gone/`]), context());
    expect(check.status).toBe("no_website");
    expect(check.url).toBeNull();
  });

  it("サイト候補が無ければアクセスしない", async () => {
    const bare = toMerged(toCandidate({ name: "株式会社大阪精密工業", source: "gbiz", sourceConfidence: 90 }));
    const ctx = context();
    const check = await new OfficialWebProvider().checkOfficialSite({ ...bare, observations: [bare], sources: ["gbiz"] }, ctx);
    expect(check.status).toBe("no_website");
    expect(ctx.budget.usage.verificationRequests).toBe(0);
  });

  it("検証リクエストの予算を消費し、超過したら取得しない", async () => {
    const tracker = createBudgetTracker({ ...budget, maxVerificationRequests: 0 });
    const check = await new OfficialWebProvider().checkOfficialSite(candidateWith([`${baseUrl}/official/`]), context({ budget: tracker }));
    expect(check.status).toBe("no_website");
  });

  it("取得した本文が本人確認スコアへ効く", async () => {
    const candidate = candidateWith([`${baseUrl}/official/`]);
    const check = await new OfficialWebProvider().checkOfficialSite(candidate, context());
    const verified = verifyCandidate(
      { ...candidate, website: check.url, domain: check.domain },
      { websiteText: check.text, websiteTitle: check.title, officialSiteConfidence: check.confidence },
    );
    const unverified = verifyCandidate(candidate, {});
    expect(verified.score).toBeGreaterThan(unverified.score);
    expect(verified.matched).toContain("公式サイトに会社名");
  });
});
