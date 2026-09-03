import type { CompanyPageRow, CompanyRow } from "@/lib/db/types";
import type { PageType } from "@/lib/crawler/types";

/** ページ種別ごとの文字数予算（トークン節約のため TOP 全文を毎回送らない） */
const PAGE_BUDGET: Record<PageType | "default", number> = {
  top: 2500,
  company: 3500,
  business: 2500,
  recruit: 3500,
  recruit_new_graduate: 2500,
  recruit_mid_career: 2500,
  job_listing: 2500,
  news: 1200,
  employee: 1500,
  message: 1500,
  contact: 1500,
  privacy: 600,
  other: 800,
  default: 800,
};

const TYPE_ORDER: PageType[] = ["top", "company", "business", "recruit", "recruit_new_graduate", "recruit_mid_career", "job_listing", "contact", "employee", "message", "news", "other", "privacy"];

export interface AnalysisContext {
  text: string;
  pageCount: number;
  charCount: number;
  urls: string[];
}

/**
 * クロール済みページから Claude へ渡すコンパクトな分析コンテキストを組み立てる。
 * 重要ページを優先し、全体で maxChars を超えない。
 */
export function buildAnalysisContext(company: CompanyRow, pages: CompanyPageRow[], maxChars: number): AnalysisContext {
  const sorted = [...pages]
    .filter((p) => (p.raw_text ?? "").trim().length > 0)
    .sort((a, b) => TYPE_ORDER.indexOf(a.page_type as PageType) - TYPE_ORDER.indexOf(b.page_type as PageType));

  const header = [
    `# 企業基本情報（公的データ / 登録情報）`,
    `企業名: ${company.company_name}`,
    company.corporate_number ? `法人番号: ${company.corporate_number}` : null,
    company.address ? `所在地: ${company.address}` : null,
    company.industry ? `業種(登録): ${company.industry}${company.industry_detail ? ` / ${company.industry_detail}` : ""}` : null,
    company.employee_count !== null ? `従業員数(登録): ${company.employee_count}名` : `従業員数(登録): 不明`,
    company.established_date ? `設立: ${company.established_date}` : null,
    company.representative_name ? `代表者: ${company.representative_name}` : null,
    company.description ? `概要(登録): ${company.description.slice(0, 400)}` : null,
    company.website_url ? `公式サイト: ${company.website_url}` : null,
    `SNS: ${[
      company.instagram_url && `Instagram=${company.instagram_url}`,
      company.facebook_url && `Facebook=${company.facebook_url}`,
      company.x_url && `X=${company.x_url}`,
      company.youtube_url && `YouTube=${company.youtube_url}`,
      company.linkedin_url && `LinkedIn=${company.linkedin_url}`,
      company.tiktok_url && `TikTok=${company.tiktok_url}`,
    ]
      .filter(Boolean)
      .join(", ") || "検出なし"}`,
    `問い合わせ: ${[company.email && `email=${company.email}`, company.contact_page_url && `contact_page=${company.contact_page_url}`, company.contact_form_url && `form=${company.contact_form_url}`, company.phone && `tel=${company.phone}`].filter(Boolean).join(", ") || "検出なし"}`,
    company.sales_restriction_text ? `営業拒否表記(ルール検出): "${company.sales_restriction_text}" (${company.sales_restriction_source_url ?? ""})` : null,
    "",
    `# クロール済みページ（${sorted.length}ページ）`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const parts: string[] = [header];
  let total = header.length;
  const urls: string[] = [];
  for (const p of sorted) {
    const budget = PAGE_BUDGET[(p.page_type as PageType) ?? "default"] ?? PAGE_BUDGET.default;
    const body = (p.raw_text ?? "").slice(0, budget);
    const block = `\n## [${p.page_type}] ${p.title ?? "(no title)"}\nURL: ${p.url}\n${body}\n`;
    if (total + block.length > maxChars) {
      if (total > maxChars * 0.8) break;
      const remaining = maxChars - total - 100;
      if (remaining <= 200) break;
      parts.push(block.slice(0, remaining));
      urls.push(p.url);
      total = maxChars;
      break;
    }
    parts.push(block);
    urls.push(p.url);
    total += block.length;
  }
  const text = parts.join("\n");
  return { text, pageCount: urls.length, charCount: text.length, urls };
}
