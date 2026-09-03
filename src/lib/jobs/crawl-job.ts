import type { AdminClient } from "@/lib/supabase/admin";
import type { CompanyRow, CrawlJobRow, Json } from "@/lib/db/types";
import { getCrawlerConfig } from "@/lib/config/crawler";
import { extractDomain, normalizeUrl } from "@/lib/companies/normalize";
import { decideOfficialSite, isNonOfficialDomain, type OfficialSiteCandidate, type OfficialSiteScore } from "@/lib/companies/official-site";
import { crawlSite } from "@/lib/crawler/crawl-site";
import { extractHtml } from "@/lib/crawler/extract";
import { decideSalesContactAllowed } from "@/lib/crawler/sales-restriction";
import type { CrawlSummary } from "@/lib/crawler/types";
import { fetchHtml } from "@/lib/integrations/http/fetch";
import { getPlacesProvider } from "@/lib/integrations/google-places";
import { Logger, serializeError } from "@/lib/logging/logger";
import { enqueueAnalysisJob } from "./enqueue";

interface StoredCandidate {
  url: string;
  source: OfficialSiteCandidate["source"];
  confidence?: number;
  reasons?: string[];
  title?: string | null;
}

export interface CrawlJobResult {
  outcome: "crawled" | "needs_review" | "no_website" | "robots_blocked";
  pages?: number;
  officialSiteConfidence?: number | null;
  websiteUrl?: string | null;
}

/**
 * クロールジョブ: 公式サイト特定 → クロール → 連絡先/SNS/営業拒否の抽出 → 保存 → 分析ジョブ投入
 */
export async function processCrawlJob(db: AdminClient, job: CrawlJobRow, logger: Logger): Promise<CrawlJobResult> {
  const { data: company, error } = await db.from("companies").select("*").eq("id", job.company_id).single();
  if (error || !company) throw new Error(`企業が見つかりません: ${job.company_id}`);

  await db.from("companies").update({ crawl_status: "crawling" }).eq("id", company.id);

  // 1) 公式サイトの特定
  const site = await resolveOfficialSite(db, company, logger);
  if (site.status !== "verified" || !site.url) {
    const status = site.status === "needs_review" ? "needs_review" : "no_website";
    await db
      .from("companies")
      .update({
        verification_status: status,
        crawl_status: status === "no_website" ? "no_website" : "not_crawled",
        website_candidates: site.candidates as unknown as Json,
        official_site_confidence: site.best?.confidence ?? null,
      })
      .eq("id", company.id);
    await logger.info(status === "needs_review" ? "公式サイトを断定できず要確認" : "公式サイトが見つからない", {
      best: site.best?.url,
      confidence: site.best?.confidence,
    });
    return { outcome: status, officialSiteConfidence: site.best?.confidence ?? null };
  }

  // 2) クロール
  const cfg = getCrawlerConfig();
  await logger.info("クロールを開始", { url: site.url, maxPages: cfg.maxPages });
  const summary = await crawlSite(site.url, { maxPages: cfg.maxPages });
  if (summary.robotsBlocked) {
    await db.from("companies").update({ crawl_status: "failed", last_crawled_at: new Date().toISOString() }).eq("id", company.id);
    await logger.warn("robots.txt によりクロール不可", { url: site.url });
    return { outcome: "robots_blocked", websiteUrl: site.url };
  }
  if (summary.pages.length === 0 || summary.pages.every((p) => p.httpStatus === 0)) {
    throw new Error(`サイトにアクセスできません: ${summary.errors.slice(0, 2).join(" / ")}`);
  }

  // 3) ページ保存（raw HTML は保存しない）
  await db.from("company_pages").delete().eq("company_id", company.id);
  const now = new Date().toISOString();
  const rows = summary.pages.map((p) => ({
    company_id: company.id,
    url: p.url,
    page_type: p.pageType,
    title: p.title,
    raw_text: p.text,
    http_status: p.httpStatus,
    text_length: p.text.length,
    crawled_at: now,
  }));
  // 同一 URL の重複を除去
  const uniqueRows = Array.from(new Map(rows.map((r) => [r.url, r])).values());
  const { error: pErr } = await db.from("company_pages").insert(uniqueRows);
  if (pErr) throw new Error(`ページの保存に失敗: ${pErr.message}`);

  // 4) 企業情報の更新（連絡先 / SNS / 営業拒否）
  const update = buildCompanyUpdate(company, site, summary, now);
  const { error: uErr } = await db.from("companies").update(update).eq("id", company.id);
  if (uErr) throw new Error(`企業の更新に失敗: ${uErr.message}`);

  if (update.sales_contact_allowed === "false") {
    const { data: existing } = await db.from("suppression_list").select("id").eq("company_id", company.id).eq("reason", "sales_restriction_detected").limit(1);
    if (!existing || existing.length === 0) {
      await db.from("suppression_list").insert({
        company_id: company.id,
        domain: site.domain,
        reason: "sales_restriction_detected",
        note: update.sales_restriction_text ?? null,
        source_url: update.sales_restriction_source_url ?? null,
      });
    }
  }

  await logger.info("クロールが完了", {
    pages: summary.pages.length,
    emails: summary.emails.length,
    phones: summary.phones.length,
    salesRestrictions: summary.salesRestrictions.length,
    errors: summary.errors.length,
  });

  // 5) 分析ジョブ投入
  if (job.enqueue_analysis) {
    await enqueueAnalysisJob(db, company.id, { searchJobId: job.search_job_id, priority: job.priority });
  }
  return { outcome: "crawled", pages: summary.pages.length, officialSiteConfidence: site.confidence, websiteUrl: site.url };
}

interface ResolvedSite {
  status: "verified" | "needs_review" | "no_website";
  url: string | null;
  domain: string | null;
  confidence: number | null;
  best: OfficialSiteScore | null;
  candidates: StoredCandidate[];
}

/**
 * 公式サイト判定。
 * - 既に verified / manual なら再利用（再解析時）
 * - 候補（GビズINFO URL / 手動入力 / Google Places）のトップページを取得してスコアリング
 * - 閾値未満は要確認として保存しない
 */
async function resolveOfficialSite(db: AdminClient, company: CompanyRow, logger: Logger): Promise<ResolvedSite> {
  if (company.website_url && (company.verification_status === "verified" || company.verification_status === "manual")) {
    return {
      status: "verified",
      url: company.website_url,
      domain: company.website_domain,
      confidence: company.official_site_confidence,
      best: null,
      candidates: (company.website_candidates as unknown as StoredCandidate[]) ?? [],
    };
  }

  let stored = ((company.website_candidates as unknown as StoredCandidate[]) ?? []).filter((c) => c && c.url);
  if (stored.length === 0) {
    try {
      const places = getPlacesProvider();
      const found = await places.findCompany(`${company.company_name} ${company.address ?? company.prefecture ?? ""}`.trim());
      stored = found
        .filter((f) => f.websiteUrl)
        .map((f) => ({ url: normalizeUrl(f.websiteUrl) ?? "", source: "google_places" as const }))
        .filter((c) => c.url && !isNonOfficialDomain(extractDomain(c.url)));
      if (stored.length > 0) await logger.info("Google Places から公式サイト候補を取得", { count: stored.length });
    } catch (err) {
      await logger.warn("公式サイト候補の探索に失敗", serializeError(err));
    }
  }
  if (stored.length === 0) return { status: "no_website", url: null, domain: null, confidence: null, best: null, candidates: [] };

  const candidates: OfficialSiteCandidate[] = [];
  for (const c of stored.slice(0, 3)) {
    const url = normalizeUrl(c.url);
    if (!url) continue;
    const res = await fetchHtml(url);
    if (!res.ok || !res.body) {
      await logger.warn("公式サイト候補にアクセスできない", { url, status: res.status, error: res.error });
      candidates.push({ url, title: null, pageText: null, source: c.source });
      continue;
    }
    const extracted = extractHtml(res.body, res.finalUrl, 6000);
    candidates.push({ url: normalizeUrl(res.finalUrl) ?? url, title: extracted.title, pageText: extracted.text, source: c.source });
  }

  const decision = decideOfficialSite(
    {
      companyName: company.company_name,
      address: company.address,
      phone: company.phone,
      corporateNumber: company.corporate_number,
      representativeName: company.representative_name,
    },
    candidates,
  );
  const storedScored: StoredCandidate[] = decision.candidates.map((s) => ({
    url: s.url,
    source: candidates.find((c) => c.url === s.url)?.source ?? "search",
    confidence: s.confidence,
    reasons: s.reasons,
    title: candidates.find((c) => c.url === s.url)?.title ?? null,
  }));

  if (decision.status !== "verified" || !decision.best) {
    return { status: decision.status, url: null, domain: null, confidence: decision.best?.confidence ?? null, best: decision.best, candidates: storedScored };
  }

  // ドメインが他社に登録済みなら要確認（重複防止）
  const domain = decision.best.domain;
  if (domain) {
    const { data: conflict } = await db.from("companies").select("id, company_name").eq("website_domain", domain).neq("id", company.id).limit(1);
    if (conflict && conflict.length > 0) {
      await logger.warn("同一ドメインが別企業に登録済みのため要確認", { domain, conflictId: conflict[0].id });
      return { status: "needs_review", url: null, domain, confidence: decision.best.confidence, best: decision.best, candidates: storedScored };
    }
  }

  await logger.info("公式サイトを特定", { url: decision.best.url, confidence: decision.best.confidence, reasons: decision.best.reasons });
  return { status: "verified", url: decision.best.url, domain, confidence: decision.best.confidence, best: decision.best, candidates: storedScored };
}

function buildCompanyUpdate(company: CompanyRow, site: ResolvedSite, summary: CrawlSummary, now: string): Partial<CompanyRow> {
  const domain = site.domain ?? extractDomain(site.url);
  // 同一ドメインのメールを優先（サイト内に記載された公開アドレスのみ。推測生成はしない）
  const sameDomain = summary.emails.filter((e) => domain && e.endsWith(`@${domain}`));
  const email = sameDomain[0] ?? summary.emails[0] ?? null;
  const restriction = summary.salesRestrictions[0] ?? null;
  const allowed = decideSalesContactAllowed(summary.salesRestrictions);

  return {
    website_url: site.url,
    website_domain: domain,
    official_site_confidence: site.confidence,
    verification_status: company.verification_status === "manual" ? "manual" : "verified",
    website_candidates: site.candidates as unknown as Json,
    email: email ?? company.email,
    phone: company.phone ?? summary.phones[0] ?? null,
    contact_page_url: summary.contactPageUrl,
    contact_form_url: summary.contactFormUrl,
    recruit_page_url: summary.recruitPageUrl,
    instagram_url: summary.social.instagram_url,
    facebook_url: summary.social.facebook_url,
    x_url: summary.social.x_url,
    youtube_url: summary.social.youtube_url,
    linkedin_url: summary.social.linkedin_url,
    tiktok_url: summary.social.tiktok_url,
    sales_contact_allowed: allowed === "false" ? "false" : company.sales_contact_allowed === "false" ? "false" : "unknown",
    sales_restriction_text: restriction?.text ?? (allowed === "unknown" && !restriction ? null : company.sales_restriction_text),
    sales_restriction_source_url: restriction?.sourceUrl ?? (restriction ? company.sales_restriction_source_url : null),
    crawl_status: "crawled",
    last_crawled_at: now,
  };
}
