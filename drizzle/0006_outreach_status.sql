-- 営業フォームへの入力・送信の状態（送信は人が行う。ここはその記録）
alter table public.companies
  add column if not exists outreach_status text not null default 'unsent',
  add column if not exists outreach_status_at timestamptz,
  add column if not exists outreach_note text;
--> statement-breakpoint

alter table public.companies
  drop constraint if exists companies_outreach_status_check;
--> statement-breakpoint

-- unsent   : まだ開いていない
-- opened   : フォームに入力して人の確認待ち（送信したかは不明）
-- sent     : 人が送信した
-- skipped  : 送らないと判断した（理由は outreach_note）
-- failed   : フォームを開けなかった・入力できなかった
alter table public.companies
  add constraint companies_outreach_status_check
  check (outreach_status in ('unsent','opened','sent','skipped','failed'));
--> statement-breakpoint

create index if not exists companies_outreach_status_idx on public.companies (outreach_status);
--> statement-breakpoint

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
  (a.outreach_body is not null) as has_outreach,
  -- 新しい列は必ず末尾に追加する。
  -- CREATE OR REPLACE VIEW は既存の列の途中に列を挿入できない（PostgreSQL の制約）。
  c.recruit_target, c.job_boards,
  -- 新しい列は必ず末尾に追加する（CREATE OR REPLACE VIEW は途中に挿入できない）
  c.outreach_status, c.outreach_status_at, c.outreach_note
from public.companies c
left join public.company_analysis a on a.id = c.latest_analysis_id;
