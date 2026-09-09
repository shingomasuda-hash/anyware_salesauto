import { getEnv, isMockMode } from "@/lib/config/env";
import { toCandidate } from "../normalizer";
import { ProviderHttpError, withRetry } from "../retry";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery, MergedCandidate } from "../types";

interface EdinetDocument {
  edinetCode?: string | null;
  filerName?: string | null;
  JCN?: string | null;
  submitDateTime?: string | null;
  docDescription?: string | null;
}

/**
 * EDINET Provider（任意）。
 * 上場・有価証券報告書提出企業の確認と情報補完に使う。
 * 中小企業 Discovery の主軸にはしない。
 */
export class EdinetDiscoveryProvider implements CompanyDiscoveryProvider {
  readonly name = "edinet" as const;

  isAvailable(): boolean {
    return isMockMode() || Boolean(getEnv().EDINET_API_KEY);
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "EDINET_API_KEY が未設定です（任意）";
  }

  private async fetchDocuments(date: string): Promise<EdinetDocument[]> {
    const key = getEnv().EDINET_API_KEY;
    if (!key) return [];
    const url = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
    url.searchParams.set("date", date);
    url.searchParams.set("type", "2");
    url.searchParams.set("Subscription-Key", key);

    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderHttpError(`EDINET エラー: ${text.slice(0, 200)}`, res.status);
    }
    const json = (await res.json()) as { results?: EdinetDocument[] };
    return json.results ?? [];
  }

  /**
   * EDINET は地域・業種での企業検索に向かないため、
   * search では直近の提出書類から企業名一致のものを候補化するに留める。
   */
  async search(query: DiscoveryQuery, context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const keyword = query.text?.trim() || query.criteria.keywords?.[0];
    if (!keyword) return [];
    const date = new Date().toISOString().slice(0, 10);
    try {
      const docs = await withRetry(() => this.fetchDocuments(date), { maxAttempts: 2 });
      return docs
        .filter((d) => d.filerName && d.filerName.includes(keyword))
        .slice(0, query.limit ?? 10)
        .map((d) =>
          toCandidate({
            name: d.filerName!,
            corporateNumber: d.JCN ?? null,
            source: "edinet",
            sourceId: d.edinetCode ?? null,
            sourceUrl: d.edinetCode ? `https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx` : null,
            sourceConfidence: 85,
            rawData: d,
          }),
        );
    } catch (err) {
      await context.log("warn", "EDINET 検索に失敗", { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  /** 上場企業であれば法人番号（JCN）を補完する */
  async enrich(candidate: MergedCandidate, context: DiscoveryContext): Promise<DiscoveryCandidate | null> {
    if (candidate.corporateNumber || !this.isAvailable() || isMockMode()) return null;
    if (!context.budget.canVerificationRequest()) return null;
    context.budget.consumeVerificationRequest();
    try {
      const docs = await withRetry(() => this.fetchDocuments(new Date().toISOString().slice(0, 10)), { maxAttempts: 2 });
      const hit = docs.find((d) => d.filerName && d.filerName.replace(/\s/g, "") === candidate.name.replace(/\s/g, ""));
      if (!hit?.filerName || !hit.JCN) return null;
      return toCandidate({
        name: hit.filerName,
        corporateNumber: hit.JCN,
        source: "edinet",
        sourceId: hit.edinetCode ?? null,
        sourceConfidence: 85,
        rawData: hit,
      });
    } catch {
      return null;
    }
  }
}
