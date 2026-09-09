import { getEnv, isMockMode } from "@/lib/config/env";
import { extractDomain } from "@/lib/companies/normalize";
import { isNonOfficialDomain } from "@/lib/companies/official-site";
import { cleanCompanyName, isPlausibleCompany, toCandidate } from "../normalizer";
import { ProviderHttpError, withRetry } from "../retry";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery } from "../types";

export interface SearchResultItem {
  title: string;
  url: string;
  description: string;
}

/**
 * 検索エンジンの抽象化。Brave 固有の実装に依存させないため、
 * 別プロバイダへ差し替える場合はこの interface を実装するだけでよい。
 */
export interface SearchEngine {
  readonly name: string;
  isAvailable(): boolean;
  unavailableReason(): string | null;
  search(query: string, limit: number): Promise<SearchResultItem[]>;
}

/** Brave Search API 実装 */
export class BraveSearchEngine implements SearchEngine {
  readonly name = "brave";

  isAvailable(): boolean {
    return Boolean(getEnv().BRAVE_SEARCH_API_KEY);
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "BRAVE_SEARCH_API_KEY が未設定です";
  }

  async search(query: string, limit: number): Promise<SearchResultItem[]> {
    const key = getEnv().BRAVE_SEARCH_API_KEY;
    if (!key) return [];
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(limit, 20)));
    url.searchParams.set("country", "JP");
    url.searchParams.set("search_lang", "jp");

    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderHttpError(`Brave Search エラー: ${text.slice(0, 200)}`, res.status);
    }
    const json = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (json.web?.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r) => ({ title: r.title!, url: r.url!, description: r.description ?? "" }));
  }
}

let engineOverride: SearchEngine | null = null;
/** テスト用に検索エンジンを差し替える */
export function setSearchEngine(engine: SearchEngine | null) {
  engineOverride = engine;
}

export function getSearchEngine(): SearchEngine {
  return engineOverride ?? new BraveSearchEngine();
}

/**
 * Web Search Provider。
 * 検索エンジン経由で企業候補・公式サイト候補を発見する。
 * スニペットだけで企業情報を確定させず、あくまで「候補の発見」に用いる。
 */
export class WebSearchDiscoveryProvider implements CompanyDiscoveryProvider {
  readonly name = "web_search" as const;

  constructor(private readonly engine: SearchEngine = getSearchEngine()) {}

  isAvailable(): boolean {
    return isMockMode() || this.engine.isAvailable();
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : this.engine.unavailableReason();
  }

  async search(query: DiscoveryQuery, context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const text = query.text?.trim();
    if (!text) return [];

    const results = await withRetry(() => this.engine.search(text, query.limit ?? 20), {
      maxAttempts: 3,
      onRetry: (a, d) => void context.log("warn", `Web検索を再試行します (${a}回目, ${d}ms待機)`),
    });

    const out: DiscoveryCandidate[] = [];
    const seenDomains = new Set<string>();
    for (const r of results) {
      const domain = extractDomain(r.url);
      // 求人媒体・SNS・企業DB等は企業の公式サイトではないため候補にしない
      if (!domain || isNonOfficialDomain(domain) || seenDomains.has(domain)) continue;
      const name = cleanCompanyName(r.title);
      const candidate = toCandidate({
        name,
        website: `https://${domain}`,
        industry: query.criteria.industry ?? null,
        source: "web_search",
        sourceId: domain,
        sourceUrl: r.url,
        // スニペット由来のため単体では最も弱い根拠。必ず検証を通す
        sourceConfidence: 30,
        rawData: { title: r.title, url: r.url, description: r.description },
      });
      if (!isPlausibleCompany(candidate)) continue;
      seenDomains.add(domain);
      out.push(candidate);
    }
    return out;
  }
}
