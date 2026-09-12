import { getCrawlerConfig } from "@/lib/config/crawler";
import { extractDomain, normalizeUrl } from "@/lib/companies/normalize";
import { decideOfficialSite, isNonHtmlUrl, isNonOfficialDomain, looksLikeCorporateDatabaseUrl, looksLikeDirectoryPageUrl, type OfficialSiteCandidate } from "@/lib/companies/official-site";
import { extractHtml } from "@/lib/crawler/extract";
import { fetchHtml } from "@/lib/integrations/http/fetch";
import { toCandidate } from "../normalizer";
import { getSearchEngine } from "./web-search";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery, MergedCandidate } from "../types";

/**
 * 自分で Web 検索して見つけたサイトを公式サイトとして採用する最低確信度。
 * 情報源から渡された URL は出所の裏付けがあるためこの制限を適用しない。
 */
const SEARCHED_SITE_MIN_CONFIDENCE = 40;

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
  /**
   * 社名しか分からない企業の公式サイトを Web 検索で探す。
   *
   * GビズINFO は URL を持たない法人が大半のため、候補URLが無いという理由だけで
   * 実在の企業を落とさないようにする。見つけた URL は無条件に採用せず、
   * 通常どおり decideOfficialSite で会社名・所在地・電話を照合する。
   */
  private async searchWebsiteCandidates(candidate: MergedCandidate, context: DiscoveryContext): Promise<string[]> {
    const engine = getSearchEngine();
    if (!engine.isAvailable()) return [];
    if (!context.budget.canVerificationRequest()) return [];
    context.budget.consumeVerificationRequest();

    const area = [candidate.prefecture, candidate.city].filter(Boolean).join(" ");
    const query = [candidate.name, area, "公式"].filter(Boolean).join(" ").slice(0, 100);
    try {
      const results = await engine.search(query, 5);
      return Array.from(
        new Set(
          results
            .map((r) => normalizeUrl(r.url))
            .filter((u): u is string => Boolean(u))
            .filter((u) => !isNonOfficialDomain(extractDomain(u)))
            // PDF・表計算などは公式サイトの本文として読めない
            .filter((u) => !isNonHtmlUrl(u))
            // 法人番号をパスに含む URL は法人情報データベース
            .filter((u) => !looksLikeCorporateDatabaseUrl(u))
            // 企業ディレクトリ・名簿ページ（/company_list/ 等）も公式サイトにしない
            .filter((u) => !looksLikeDirectoryPageUrl(u)),
        ),
      );
    } catch (err) {
      await context.log("warn", "公式サイトの検索に失敗しました", {
        candidate: candidate.name,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async checkOfficialSite(candidate: MergedCandidate, context: DiscoveryContext): Promise<OfficialSiteCheck> {
    const known = Array.from(
      new Set(
        candidate.observations
          .map((o) => normalizeUrl(o.website))
          .filter((u): u is string => Boolean(u))
          .filter((u) => !isNonOfficialDomain(extractDomain(u)))
          .filter((u) => !isNonHtmlUrl(u)),
      ),
    );

    // 候補URLが無い場合のみ Web 検索で探す（既に分かっていれば余計なリクエストをしない）
    const fromSearch = known.length === 0;
    const urls = (fromSearch ? await this.searchWebsiteCandidates(candidate, context) : known).slice(0, 3);

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
      // 検索で見つけた URL は観測に含まれないため、その場合は "search" 扱いにする
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

    // 自分で検索して見つけた URL は、照合がほとんど効いていない場合「別会社のサイト」である可能性が高い。
    // 情報源から渡された URL と違い出所の裏付けが無いため、最低限の確からしさを満たさないものは
    // 公式サイトとして採用せず、URL も記録しない（誤った公式サイトを残さない）。
    if (fromSearch && (best?.confidence ?? 0) < SEARCHED_SITE_MIN_CONFIDENCE) {
      return {
        url: null,
        domain: null,
        confidence: best?.confidence ?? null,
        title: null,
        text: null,
        status: "no_website",
        reasons: [`検索で見つけたサイトは会社情報と十分に一致しませんでした（確度 ${best?.confidence ?? 0}）`],
      };
    }
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
