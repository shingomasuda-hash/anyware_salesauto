-- 企業ごとの営業文（分析と同じ1回の Claude 呼び出しで生成する）
alter table public.company_analysis
  add column if not exists outreach_subject text,
  add column if not exists outreach_body text,
  add column if not exists outreach_personalization jsonb,
  add column if not exists outreach_hypothesis_note text;
--> statement-breakpoint

-- 営業文が入っている分析だけを素早く引けるようにする
create index if not exists company_analysis_outreach_idx
  on public.company_analysis (company_id)
  where outreach_body is not null;
--> statement-breakpoint

-- 営業文を一覧・CSV から扱えるようビューに追加する（列の追加のみ。既存の列は変更しない）
create or replace view public.company_overview as
select
  c.id, c.corporate_number, c.company_name, c.company_name_kana, c.prefecture, c.city, c.address,
  c.industry, c.industry_detail, c.employee_count, c.employee_range, c.phone, c.email,
  c.website_url, c.website_domain, c.contact_page_url, c.contact_form_url, c.recruit_page_url,
  c.instagram_url, c.facebook_url, c.x_url, c.youtube_url, c.linkedin_url, c.tiktok_url,
  c.source, c.official_site_confidence, c.verification_status, c.sales_contact_allowed,
  c.crawl_status, c.analysis_status, c.created_at, c.updated_at, c.last_crawled_at, c.last_analyzed_at,
  (c.website_url is not null) as has_website,
  (c.recruit_page_url is not null) as has_recruit_page,
  (c.email is not null or c.contact_page_url is not null or c.contact_form_url is not null or c.phone is not null) as has_contact,
  (c.email is not null) as has_email,
  (c.instagram_url is not null or c.facebook_url is not null or c.x_url is not null or c.youtube_url is not null or c.linkedin_url is not null or c.tiktok_url is not null) as has_sns,
  a.id as analysis_id, a.recruiting_status, a.new_graduate_hiring, a.mid_career_hiring,
  a.recruitment_page_quality_score, a.recruitment_issue_score, a.web_quality_score, a.sns_activity_score,
  a.digital_marketing_score, a.dx_opportunity_score, a.growth_potential_score,
  a.sales_priority_score, a.sales_priority_rank, a.confidence_score, a.analyzed_at,
  a.outreach_subject, a.outreach_body,
  (a.outreach_body is not null) as has_outreach
from public.companies c
left join public.company_analysis a on a.id = c.latest_analysis_id;
