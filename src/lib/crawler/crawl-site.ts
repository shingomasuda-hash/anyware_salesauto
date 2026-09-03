import { getCrawlerConfig } from "@/lib/config/crawler";
import { fetchHtml, sleep } from "@/lib/integrations/http/fetch";
import { classifyPage, isCrawlableUrl, isSameSite } from "./classify";
import { extractEmails, extractMailtoEmails, extractPhones, extractSocialLinks, looksLikeContactForm } from "./contacts";
import { extractHtml } from "./extract";
import { loadRobots } from "./robots";
import { detectSalesRestriction } from "./sales-restriction";
import type { CrawlSummary, CrawledPage, PageType, SocialLinks } from "./types";

interface QueueItem {
  url: string;
  linkText: string | null;
  priority: number;
}

export interface CrawlOptions {
  maxPages?: number;
  delayMs?: number;
  onPage?: (page: CrawledPage) => void | Promise<void>;
}

/** URL の重複判定キー（末尾スラッシュ / index.html / クエリ順を無視） */
export function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    let path = u.pathname.replace(/\/(index|default)\.(html?|php|aspx?)$/i, "/").replace(/\/+$/, "");
    if (path === "") path = "/";
    u.searchParams.sort();
    return `${u.hostname}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * 1サイトを最大 maxPages ページまでクロールする。
 * - robots.txt を尊重
 * - 同一サイトのみ
 * - ページ種別の優先度順（会社概要 / 採用 / 問い合わせ 等を優先）
 * - リクエスト間に delay
 */
export async function crawlSite(homeUrl: string, options: CrawlOptions = {}): Promise<CrawlSummary> {
  const cfg = getCrawlerConfig();
  const maxPages = options.maxPages ?? cfg.maxPages;
  const baseDelay = options.delayMs ?? cfg.delayMs;

  const summary: CrawlSummary = {
    pages: [],
    emails: [],
    phones: [],
    social: { instagram_url: null, facebook_url: null, x_url: null, youtube_url: null, linkedin_url: null, tiktok_url: null },
    contactPageUrl: null,
    contactFormUrl: null,
    recruitPageUrl: null,
    salesRestrictions: [],
    robotsBlocked: false,
    fetchedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    summary.errors.push(`invalid url: ${homeUrl}`);
    return summary;
  }

  const robots = await loadRobots(home.origin, cfg.userAgent);
  const delayMs = Math.max(baseDelay, robots.crawlDelayMs ?? 0);
  if (!robots.isAllowed(home.toString())) {
    summary.robotsBlocked = true;
    summary.errors.push("robots.txt によりトップページのクロールが禁止されています");
    return summary;
  }

  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: QueueItem[] = [{ url: home.toString(), linkText: null, priority: 1000 }];
  queued.add(canonicalKey(home.toString()));
  const typeCounts = new Map<PageType, number>();
  const emails = new Set<string>();
  const phones = new Set<string>();
  const social: SocialLinks = { ...summary.social };

  while (queue.length > 0 && summary.fetchedCount < maxPages) {
    queue.sort((a, b) => b.priority - a.priority);
    const item = queue.shift()!;
    const key = canonicalKey(item.url);
    if (visited.has(key)) continue;
    visited.add(key);

    if (!robots.isAllowed(item.url)) {
      summary.skippedCount++;
      continue;
    }

    if (summary.fetchedCount > 0 && delayMs > 0) await sleep(delayMs);
    const res = await fetchHtml(item.url);
    summary.fetchedCount++;

    if (!res.ok || !res.body) {
      summary.errors.push(`${item.url}: ${res.error ?? `HTTP ${res.status}`}`);
      if (summary.fetchedCount === 1) {
        // トップが取れなければ終了
        summary.pages.push({ url: item.url, pageType: "top", title: null, text: "", httpStatus: res.status, links: [], emails: [], phones: [], hasForm: false });
        break;
      }
      continue;
    }

    const extracted = extractHtml(res.body, res.finalUrl, cfg.maxTextCharsPerPage);
    const { type } = classifyPage(res.finalUrl, item.linkText, extracted.title, home.origin);
    const pageType: PageType = summary.fetchedCount === 1 ? "top" : type;

    const pageEmails = Array.from(new Set([...extractEmails(extracted.text, res.body), ...extractMailtoEmails(extracted.links)]));
    const pagePhones = extractPhones(extracted.text);
    pageEmails.forEach((e) => emails.add(e));
    pagePhones.forEach((p) => phones.add(p));

    const pageSocial = extractSocialLinks(extracted.links);
    (Object.keys(social) as (keyof SocialLinks)[]).forEach((k) => {
      if (!social[k] && pageSocial[k]) social[k] = pageSocial[k];
    });

    const page: CrawledPage = {
      url: res.finalUrl,
      pageType,
      title: extracted.title,
      text: extracted.text,
      httpStatus: res.status,
      links: extracted.links,
      emails: pageEmails,
      phones: pagePhones,
      hasForm: extracted.hasForm,
    };
    summary.pages.push(page);
    typeCounts.set(pageType, (typeCounts.get(pageType) ?? 0) + 1);
    if (options.onPage) await options.onPage(page);

    if (pageType === "contact" && !summary.contactPageUrl) summary.contactPageUrl = res.finalUrl;
    if (!summary.contactFormUrl && looksLikeContactForm(res.finalUrl, extracted.hasForm, extracted.text)) summary.contactFormUrl = res.finalUrl;
    if ((pageType === "recruit" || pageType === "recruit_new_graduate" || pageType === "recruit_mid_career" || pageType === "job_listing") && !summary.recruitPageUrl) {
      summary.recruitPageUrl = res.finalUrl;
    }
    summary.salesRestrictions.push(...detectSalesRestriction(extracted.text, res.finalUrl));

    // 次の候補をキューに追加
    for (const link of extracted.links) {
      if (!isCrawlableUrl(link.url) || !isSameSite(link.url, home.toString())) continue;
      const k = canonicalKey(link.url);
      if (visited.has(k) || queued.has(k)) continue;
      const cls = classifyPage(link.url, link.text, null, home.origin);
      if (cls.type === "other" && queue.length > maxPages * 2) continue;
      // 同種ページを取りすぎない（ニュース記事の連続など）
      const perTypeCap = cls.type === "news" ? 2 : cls.type === "other" ? 3 : 4;
      if ((typeCounts.get(cls.type) ?? 0) >= perTypeCap) continue;
      queued.add(k);
      queue.push({ url: link.url, linkText: link.text, priority: cls.priority });
    }
  }

  summary.emails = Array.from(emails);
  summary.phones = Array.from(phones);
  summary.social = social;
  // 同一文の重複を除去
  const seen = new Set<string>();
  summary.salesRestrictions = summary.salesRestrictions.filter((h) => {
    const k = h.text.slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return summary;
}
