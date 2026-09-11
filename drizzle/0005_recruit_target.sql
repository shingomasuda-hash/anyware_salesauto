-- 営業ターゲットとしての採用状況（クロールで機械的に判定する。AIは使わない）
alter table public.companies
  add column if not exists recruit_target text,
  add column if not exists recruit_target_reasons jsonb,
  add column if not exists job_boards jsonb;
--> statement-breakpoint

alter table public.companies
  drop constraint if exists companies_recruit_target_check;
--> statement-breakpoint

alter table public.companies
  add constraint companies_recruit_target_check
  check (recruit_target is null or recruit_target in ('no_recruit_page','weak_recruit_page','active_recruit','no_signal'));
--> statement-breakpoint

create index if not exists companies_recruit_target_idx on public.companies (recruit_target);
--> statement-breakpoint

-- 一覧・CSV から採用区分で絞れるようにする（列の追加のみ）
create or replace view public.company_overview as
select
  c.id, c.corporate_number, c.company_name, c.company_name_kana, c.prefecture, c.city, c.address,
  c.industry, c.industry_detail, c.employee_count, c.employee_range, c.phone, c.email,
  c.website_url, c.website_domain, c.contact_page_url, c.contact_form_url, c.recruit_page_url,
  c.instagram_url, c.facebook_url, c.x_url, c.youtube_url, c.linkedin_url, c.tiktok_url,
  c.source, c.official_site_confidence, c.verification_status, c.sales_contact_allowed,
  c.crawl_status, c.analysis_status, c.created_at, c.updated_at, c.last_crawled_at, c.last_analyzed_at,
  c.recruit_target, c.job_boards,
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
