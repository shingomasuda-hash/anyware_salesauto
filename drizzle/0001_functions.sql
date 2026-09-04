-- =============================================================
-- 関数 / トリガー / ビュー（テーブル定義は 0000_init.sql）
-- Supabase 固有の role / RLS / security definer には依存しない。
-- =============================================================

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
--> statement-breakpoint
do $$
declare t text;
begin
  foreach t in array array['companies','search_jobs','crawl_jobs','analysis_jobs','services','contacts','campaigns','email_templates','email_messages'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;
--> statement-breakpoint

-- 一覧用ビュー: 企業 + 最新分析をフラット化
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
  a.sales_priority_score, a.sales_priority_rank, a.confidence_score, a.analyzed_at
from public.companies c
left join public.company_analysis a on a.id = c.latest_analysis_id;
--> statement-breakpoint

-- ジョブ取得: FOR UPDATE SKIP LOCKED で複数 worker が同時実行しても二重処理しない
create or replace function public.claim_job(p_job_table text, p_stale_minutes integer default 10)
returns jsonb
language plpgsql
as $$
declare
  v_row jsonb;
begin
  if p_job_table not in ('search_jobs','crawl_jobs','analysis_jobs') then
    raise exception 'invalid job table: %', p_job_table;
  end if;

  -- 古い processing（クラッシュ等）を retrying に戻す
  execute format(
    'update public.%I set status = ''retrying'', locked_at = null
       where status = ''processing'' and locked_at < now() - make_interval(mins => $1)',
    p_job_table
  ) using p_stale_minutes;

  if p_job_table = 'search_jobs' then
    execute
      'with next as (
         select id from public.search_jobs
          where status in (''pending'',''retrying'')
          order by created_at
          for update skip locked
          limit 1)
       update public.search_jobs j
          set status = ''processing'', locked_at = now(), attempts = j.attempts + 1,
              started_at = coalesce(j.started_at, now())
         from next where j.id = next.id
       returning to_jsonb(j)'
    into v_row;
  else
    execute format(
      'with next as (
         select id from public.%I
          where status in (''pending'',''retrying'')
          order by priority desc, created_at
          for update skip locked
          limit 1)
       update public.%I j
          set status = ''processing'', locked_at = now(), attempts = j.attempts + 1,
              started_at = coalesce(j.started_at, now())
         from next where j.id = next.id
       returning to_jsonb(j)',
      p_job_table, p_job_table
    ) into v_row;
  end if;

  return v_row;
end $$;
--> statement-breakpoint

-- 検索ジョブのカウンタをアトミックに加算
create or replace function public.increment_search_job_counters(
  p_job_id uuid,
  p_found integer default 0,
  p_registered integer default 0,
  p_new integer default 0,
  p_duplicate integer default 0,
  p_skipped integer default 0,
  p_failed integer default 0
) returns void language sql as $$
  update public.search_jobs
     set found_count = found_count + p_found,
         registered_count = registered_count + p_registered,
         new_count = new_count + p_new,
         duplicate_count = duplicate_count + p_duplicate,
         skipped_count = skipped_count + p_skipped,
         failed_count = failed_count + p_failed
   where id = p_job_id;
$$;
--> statement-breakpoint

-- ダッシュボード集計
create or replace function public.dashboard_stats()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total_companies', (select count(*) from public.companies),
    'added_this_week', (select count(*) from public.companies where created_at >= date_trunc('week', now())),
    'rank_a', (select count(*) from public.company_overview where sales_priority_rank = 'A'),
    'rank_b', (select count(*) from public.company_overview where sales_priority_rank = 'B'),
    'unanalyzed', (select count(*) from public.companies where latest_analysis_id is null),
    'sales_restricted', (select count(*) from public.companies where sales_contact_allowed = 'false'),
    'website_unverified', (select count(*) from public.companies where verification_status in ('unverified','needs_review')),
    'pending_jobs', (select (select count(*) from public.crawl_jobs where status in ('pending','retrying','processing'))
                          + (select count(*) from public.analysis_jobs where status in ('pending','retrying','processing'))
                          + (select count(*) from public.search_jobs where status in ('pending','retrying','processing')))
  );
$$;
