import { getCrawlerConfig } from "@/lib/config/crawler";
import { extractDomain, normalizeUrl } from "@/lib/companies/normalize";
import { decideOfficialSite, isNonOfficialDomain, type OfficialSiteCandidate } from "@/lib/companies/official-site";
import { extractHtml } from "@/lib/crawler/extract";
import { fetchHtml } from "@/lib/integrations/http/fetch";
import { toCandidate } from "../normalizer";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery, MergedCandidate } from "../types";

export interface OfficialSiteCheck {
  url: string | null;
  domain: string | null;
  confidence: number | null;
  title: string | null;
  text: string | null;
  status: "verified" | "needs_review" | "no_website";
  reasons: string[];
}

/**
 * 公式サイト確認 Provider。
 * 検索結果のトップ URL を無条件に公式サイトとせず、会社名・所在地・電話番号・
 * 会社概要ページ・ドメイン名を照合して official_site_confidence(0-100) を出す。
 */
export class OfficialWebProvider implements CompanyDiscoveryProvider {
  readonly name = "official_web" as const;

  isAvailable(): boolean {
    return true; // 外部APIキー不要
  }

  unavailableReason(): string | null {
    return null;
  }

  /** 発見用途では使わない（公式サイト確認専用の Provider） */
  async search(_query: DiscoveryQuery, _context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    return [];
  }

  /** 候補の公式サイトを取得・照合し、確認できた情報を候補として返す */
  async enrich(candidate: MergedCandidate, context: DiscoveryContext): Promise<DiscoveryCandidate | null> {
    const check = await this.checkOfficialSite(candidate, context);
    if (check.status === "no_website" || !check.url) return null;
    return toCandidate({
      name: candidate.name,
      website: check.url,
      source: "official_web",
      sourceId: check.domain,
      sourceUrl: check.url,
      sourceConfidence: check.confidence ?? 0,
      rawData: { confidence: check.confidence, reasons: check.reasons, title: check.title },
    });
  }

  /** 公式サイト候補を取得して照合する。取得した本文は verification に再利用する */
  async checkOfficialSite(candidate: MergedCandidate, context: DiscoveryContext): Promise<OfficialSiteCheck> {
    const urls = Array.from(
      new Set(
        candidate.observations
          .map((o) => normalizeUrl(o.website))
          .filter((u): u is string => Boolean(u))
          .filter((u) => !isNonOfficialDomain(extractDomain(u))),
      ),
    ).slice(0, 3);

    if (urls.length === 0) {
      return { url: null, domain: null, confidence: null, title: null, text: null, status: "no_website", reasons: ["公式サイト候補が見つかりません"] };
    }

    const cfg = getCrawlerConfig();
    const fetched: (OfficialSiteCandidate & { text: string | null })[] = [];
    for (const url of urls) {
      if (!context.budget.canVerificationRequest()) break;
      context.budget.consumeVerificationRequest();
      const res = await fetchHtml(url, { timeoutMs: cfg.timeoutMs });
      if (!res.ok || !res.body) {
        await context.log("warn", "公式サイト候補にアクセスできません", { url, status: res.status });
        continue;
      }
      const extracted = extractHtml(res.body, res.finalUrl, 8000);
      const source = candidate.observations.find((o) => normalizeUrl(o.website) === url)?.source;
      fetched.push({
        url: normalizeUrl(res.finalUrl) ?? url,
        title: extracted.title,
        pageText: extracted.text,
        text: extracted.text,
        source: source === "gbiz" ? "gbiz" : source === "google_places" ? "google_places" : "search",
      });
    }

    if (fetched.length === 0) {
      return { url: null, domain: null, confidence: null, title: null, text: null, status: "no_website", reasons: ["公式サイト候補を取得できませんでした"] };
    }

    const decision = decideOfficialSite(
      { companyName: candidate.name, address: candidate.address, phone: candidate.phone, corporateNumber: candidate.corporateNumber },
      fetched,
    );
    const best = decision.best;
    const bestPage = fetched.find((f) => f.url === best?.url);
    return {
      url: best?.url ?? null,
      domain: best?.domain ?? null,
      confidence: best?.confidence ?? null,
      title: bestPage?.title ?? null,
      text: bestPage?.text ?? null,
      status: decision.status === "verified" ? "verified" : decision.status === "needs_review" ? "needs_review" : "no_website",
      reasons: best?.reasons ?? [],
    };
  }
}
