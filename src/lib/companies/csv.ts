import type { CompanyOverviewRow } from "@/db/types";
import { employeeRangeLabel, industryLabel } from "./constants";

const COLUMNS: { header: string; value: (r: CompanyOverviewRow) => string | number | null | undefined }[] = [
  { header: "企業名", value: (r) => r.company_name },
  { header: "法人番号", value: (r) => r.corporate_number },
  { header: "都道府県", value: (r) => r.prefecture },
  { header: "市区町村", value: (r) => r.city },
  { header: "所在地", value: (r) => r.address },
  { header: "業種", value: (r) => industryLabel(r.industry) ?? r.industry },
  { header: "業種詳細", value: (r) => r.industry_detail },
  { header: "従業員数", value: (r) => r.employee_count },
  { header: "従業員規模", value: (r) => (r.employee_range ? employeeRangeLabel(r.employee_range) : null) },
  { header: "HP", value: (r) => r.website_url },
  { header: "HP確認状態", value: (r) => r.verification_status },
  { header: "メール", value: (r) => r.email },
  { header: "問い合わせURL", value: (r) => r.contact_form_url ?? r.contact_page_url },
  { header: "電話", value: (r) => r.phone },
  { header: "採用状況", value: (r) => r.recruiting_status },
  { header: "新卒採用", value: (r) => r.new_graduate_hiring },
  { header: "中途採用", value: (r) => r.mid_career_hiring },
  { header: "採用ページ", value: (r) => r.recruit_page_url },
  { header: "Instagram", value: (r) => r.instagram_url },
  { header: "Facebook", value: (r) => r.facebook_url },
  { header: "X", value: (r) => r.x_url },
  { header: "YouTube", value: (r) => r.youtube_url },
  { header: "LinkedIn", value: (r) => r.linkedin_url },
  { header: "TikTok", value: (r) => r.tiktok_url },
  { header: "採用ページ品質スコア", value: (r) => r.recruitment_page_quality_score },
  { header: "採用課題スコア", value: (r) => r.recruitment_issue_score },
  { header: "Webスコア", value: (r) => r.web_quality_score },
  { header: "SNSスコア", value: (r) => r.sns_activity_score },
  { header: "デジタルマーケスコア", value: (r) => r.digital_marketing_score },
  { header: "DX余地スコア", value: (r) => r.dx_opportunity_score },
  { header: "成長可能性スコア", value: (r) => r.growth_potential_score },
  { header: "文面件名", value: (r) => r.outreach_subject },
  { header: "文面本文", value: (r) => r.outreach_body },
  { header: "営業スコア", value: (r) => r.sales_priority_score },
  { header: "営業ランク", value: (r) => r.sales_priority_rank },
  { header: "分析信頼度", value: (r) => r.confidence_score },
  { header: "営業可否", value: (r) => (r.sales_contact_allowed === "false" ? "不可（営業拒否表記あり）" : r.sales_contact_allowed === "true" ? "可" : "不明") },
  { header: "解析日", value: (r) => r.analyzed_at },
  { header: "登録日", value: (r) => r.created_at },
];

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** UTF-8 BOM 付き CSV（Excel で文字化けしない） */
export function companiesToCsv(rows: CompanyOverviewRow[]): string {
  const header = COLUMNS.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = rows.map((r) => COLUMNS.map((c) => escapeCsvCell(c.value(r))).join(","));
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}
