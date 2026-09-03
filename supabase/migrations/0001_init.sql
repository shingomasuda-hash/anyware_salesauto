-- =============================================================
-- AnyWare Sales AI - 初期スキーマ
-- 企業情報 / 企業分析 / 営業情報 / サービス情報 を分離した汎用営業AI基盤
-- =============================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- 共通: updated_at 自動更新
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =============================================================
-- 企業情報
-- =============================================================
create table public.companies (
  id                        uuid primary key default gen_random_uuid(),
  corporate_number          text,
  company_name              text not null,
  company_name_kana         text,
  company_name_normalized   text not null,
  prefecture                text,
  city                      text,
  address                   text,
  address_normalized        text,
  postal_code               text,
  industry                  text,
  industry_detail           text,
  employee_count            integer,
  employee_range            text,
  capital                   bigint,
  established_date          date,
  representative_name       text,
  phone                     text,
  email                     text,
  description               text,
  website_url               text,
  website_domain            text,
  website_candidates        jsonb not null default '[]'::jsonb,
  contact_page_url          text,
  contact_form_url          text,
  recruit_page_url          text,
  instagram_url             text,
  facebook_url              text,
  x_url                     text,
  youtube_url               text,
  linkedin_url              text,
  tiktok_url                text,
  source                    text not null default 'manual'
                            check (source in ('gbiz','google_places','manual','import','mock')),
  source_raw                jsonb,
  official_site_confidence  integer check (official_site_confidence between 0 and 100),
  verification_status       text not null default 'unverified'
                            check (verification_status in ('unverified','needs_review','verified','manual','no_website')),
  sales_contact_allowed     text not null default 'unknown'
                            check (sales_contact_allowed in ('true','false','unknown')),
  sales_restriction_text    text,
  sales_restriction_source_url text,
  latest_analysis_id        uuid,
  crawl_status              text not null default 'not_crawled'
                            check (crawl_status in ('not_crawled','crawling','crawled','failed','no_website')),
  analysis_status           text not null default 'not_analyzed'
                            check (analysis_status in ('not_analyzed','analyzing','analyzed','failed')),
  notes                     text,
  created_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  last_crawled_at           timestamptz,
  last_analyzed_at          timestamptz
);

-- 重複防止（優先順位: 法人番号 > ドメイン > 企業名+所在地）
create unique index companies_corporate_number_key on public.companies (corporate_number) where corporate_number is not null;
create unique index companies_website_domain_key on public.companies (website_domain) where website_domain is not null;
create unique index companies_name_address_key on public.companies (company_name_normalized, address_normalized) where address_normalized is not null;
create index companies_name_normalized_idx on public.companies (company_name_normalized);
create index companies_prefecture_idx on public.companies (prefecture);
create index companies_industry_idx on public.companies (industry);
create index companies_created_at_idx on public.companies (created_at desc);
create index companies_sales_contact_idx on public.companies (sales_contact_allowed);
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();

-- =============================================================
-- クロール済みページ
-- =============================================================
create table public.company_pages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  url          text not null,
  page_type    text not null default 'other',
  title        text,
  raw_text     text,
  summary      text,
  http_status  integer,
  text_length  integer,
  crawled_at   timestamptz not null default now(),
  unique (company_id, url)
);
create index company_pages_company_idx on public.company_pages (company_id);

-- =============================================================
-- AI 企業分析
-- =============================================================
create table public.company_analysis (
  id                              uuid primary key default gen_random_uuid(),
  company_id                      uuid not null references public.companies(id) on delete cascade,
  company_summary                 text,
  business_summary                text,
  recruiting_status               text not null default 'unknown'
                                  check (recruiting_status in ('active','inactive','unknown')),
  recruiting_summary              text,
  target_candidates               text[] not null default '{}',
  new_graduate_hiring             text not null default 'unknown' check (new_graduate_hiring in ('yes','no','unknown')),
  mid_career_hiring               text not null default 'unknown' check (mid_career_hiring in ('yes','no','unknown')),
  recruitment_page_quality_score  integer check (recruitment_page_quality_score between 0 and 100),
  recruitment_issue_score         integer check (recruitment_issue_score between 0 and 100),
  web_quality_score               integer check (web_quality_score between 0 and 100),
  sns_activity_score              integer check (sns_activity_score between 0 and 100),
  digital_marketing_score         integer check (digital_marketing_score between 0 and 100),
  dx_opportunity_score            integer check (dx_opportunity_score between 0 and 100),
  growth_potential_score          integer check (growth_potential_score between 0 and 100),
  sales_priority_score            integer check (sales_priority_score between 0 and 100),
  sales_priority_rank             text check (sales_priority_rank in ('A','B','C','D')),
  detected_issues                 jsonb not null default '[]'::jsonb,
  detected_strengths              jsonb not null default '[]'::jsonb,
  recommended_topics              jsonb not null default '[]'::jsonb,
  observed_facts                  jsonb not null default '[]'::jsonb,
  inferences                      jsonb not null default '[]'::jsonb,
  analysis_reason                 text,
  confidence_score                integer check (confidence_score between 0 and 100),
  model                           text,
  provider                        text not null default 'anthropic',
  input_tokens                    integer,
  output_tokens                   integer,
  analyzed_at                     timestamptz not null default now(),
  created_at                      timestamptz not null default now()
);
create index company_analysis_company_idx on public.company_analysis (company_id, analyzed_at desc);

alter table public.companies
  add constraint companies_latest_analysis_fkey
  foreign key (latest_analysis_id) references public.company_analysis(id) on delete set null;

create table public.company_analysis_evidence (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  analysis_id    uuid not null references public.company_analysis(id) on delete cascade,
  category       text not null,
  source_url     text,
  source_title   text,
  evidence_text  text not null,
  created_at     timestamptz not null default now()
);
create index company_analysis_evidence_analysis_idx on public.company_analysis_evidence (analysis_id);

-- =============================================================
-- ジョブキュー
-- =============================================================
create table public.search_jobs (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  conditions       jsonb not null,
  status           text not null default 'pending'
                   check (status in ('pending','processing','completed','failed','retrying','cancelled')),
  requested_count  integer not null default 100,
  found_count      integer not null default 0,
  registered_count integer not null default 0,
  new_count        integer not null default 0,
  duplicate_count  integer not null default 0,
  skipped_count    integer not null default 0,
  failed_count     integer not null default 0,
  cursor           jsonb not null default '{}'::jsonb,
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  error            text,
  provider         text,
  created_by       uuid,
  locked_at        timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index search_jobs_status_idx on public.search_jobs (status, created_at);
create trigger search_jobs_set_updated_at before update on public.search_jobs for each row execute function public.set_updated_at();

create table public.search_job_items (
  id               uuid primary key default gen_random_uuid(),
  search_job_id    uuid not null references public.search_jobs(id) on delete cascade,
  company_id       uuid references public.companies(id) on delete set null,
  corporate_number text,
  company_name     text not null,
  status           text not null check (status in ('new','duplicate','skipped','failed')),
  reason           text,
  created_at       timestamptz not null default now()
);
create index search_job_items_job_idx on public.search_job_items (search_job_id);

create table public.crawl_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  search_job_id  uuid references public.search_jobs(id) on delete set null,
  status         text not null default 'pending'
                 check (status in ('pending','processing','completed','failed','retrying','cancelled')),
  priority       integer not null default 0,
  attempts       integer not null default 0,
  max_attempts   integer not null default 3,
  error          text,
  result         jsonb,
  enqueue_analysis boolean not null default true,
  locked_at      timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index crawl_jobs_status_idx on public.crawl_jobs (status, priority desc, created_at);
create index crawl_jobs_company_idx on public.crawl_jobs (company_id);
create trigger crawl_jobs_set_updated_at before update on public.crawl_jobs for each row execute function public.set_updated_at();

create table public.analysis_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  search_job_id  uuid references public.search_jobs(id) on delete set null,
  status         text not null default 'pending'
                 check (status in ('pending','processing','completed','failed','retrying','cancelled')),
  priority       integer not null default 0,
  attempts       integer not null default 0,
  max_attempts   integer not null default 3,
  error          text,
  result         jsonb,
  locked_at      timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index analysis_jobs_status_idx on public.analysis_jobs (status, priority desc, created_at);
create index analysis_jobs_company_idx on public.analysis_jobs (company_id);
create trigger analysis_jobs_set_updated_at before update on public.analysis_jobs for each row execute function public.set_updated_at();

-- =============================================================
-- ログ
-- =============================================================
create table public.system_logs (
  id          bigint generated always as identity primary key,
  level       text not null check (level in ('debug','info','warn','error')),
  category    text not null,
  message     text not null,
  meta        jsonb,
  company_id  uuid,
  job_id      uuid,
  job_type    text,
  created_at  timestamptz not null default now()
);
create index system_logs_created_idx on public.system_logs (created_at desc);
create index system_logs_category_idx on public.system_logs (category, created_at desc);

create table public.ai_usage_logs (
  id                     bigint generated always as identity primary key,
  company_id             uuid references public.companies(id) on delete set null,
  analysis_id            uuid references public.company_analysis(id) on delete set null,
  purpose                text not null,
  provider               text not null default 'anthropic',
  model                  text not null,
  input_tokens           integer not null default 0,
  output_tokens          integer not null default 0,
  cache_read_tokens      integer not null default 0,
  cache_creation_tokens  integer not null default 0,
  duration_ms            integer,
  success                boolean not null default true,
  error                  text,
  created_at             timestamptz not null default now()
);
create index ai_usage_logs_created_idx on public.ai_usage_logs (created_at desc);

-- =============================================================
-- 将来用テーブル（Phase 4以降: サービス登録 / マッチング / メール / 追客）
-- 今回は UI 実装なし。空でもシステムは動作する。
-- =============================================================
create table public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text,
  description   text,
  target_issues jsonb not null default '[]'::jsonb,
  pitch_points  jsonb not null default '[]'::jsonb,
  price_range   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger services_set_updated_at before update on public.services for each row execute function public.set_updated_at();

create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text,
  role          text,
  email         text,
  phone         text,
  source        text,
  source_url    text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index contacts_company_idx on public.contacts (company_id);
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();

-- 営業拒否 / 配信停止 / 送信禁止 / 返信不要 の抑止リスト
create table public.suppression_list (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  email         text,
  domain        text,
  reason        text not null
                check (reason in ('sales_restriction_detected','unsubscribed','do_not_contact','no_reply_needed','bounced','manual')),
  note          text,
  source_url    text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (company_id is not null or email is not null or domain is not null)
);
create index suppression_list_company_idx on public.suppression_list (company_id);
create index suppression_list_email_idx on public.suppression_list (lower(email));
create index suppression_list_domain_idx on public.suppression_list (domain);

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  service_id    uuid references public.services(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft','active','paused','completed')),
  target_filter jsonb not null default '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger campaigns_set_updated_at before update on public.campaigns for each row execute function public.set_updated_at();

create table public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  service_id    uuid references public.services(id) on delete set null,
  subject_template text not null,
  body_template text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger email_templates_set_updated_at before update on public.email_templates for each row execute function public.set_updated_at();

create table public.email_messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  template_id     uuid references public.email_templates(id) on delete set null,
  service_id      uuid references public.services(id) on delete set null,
  direction       text not null default 'outbound' check (direction in ('outbound','inbound')),
  to_email        text,
  from_email      text,
  subject         text,
  body            text,
  status          text not null default 'draft'
                  check (status in ('draft','approved','queued','sent','failed','bounced','cancelled')),
  provider_message_id text,
  thread_id       text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index email_messages_company_idx on public.email_messages (company_id);
create trigger email_messages_set_updated_at before update on public.email_messages for each row execute function public.set_updated_at();

create table public.email_replies (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid references public.email_messages(id) on delete set null,
  company_id       uuid references public.companies(id) on delete cascade,
  from_email       text,
  subject          text,
  body             text,
  classification   text,
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  type          text not null,
  title         text,
  body          text,
  meta          jsonb,
  actor_id      uuid,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index activities_company_idx on public.activities (company_id, occurred_at desc);

-- =============================================================
-- 一覧用ビュー: 企業 + 最新分析をフラット化
-- =============================================================
create view public.company_overview
with (security_invoker = true) as
select
  c.id,
  c.corporate_number,
  c.company_name,
  c.company_name_kana,
  c.prefecture,
  c.city,
  c.address,
  c.industry,
  c.industry_detail,
  c.employee_count,
  c.employee_range,
  c.phone,
  c.email,
  c.website_url,
  c.website_domain,
  c.contact_page_url,
  c.contact_form_url,
  c.recruit_page_url,
  c.instagram_url,
  c.facebook_url,
  c.x_url,
  c.youtube_url,
  c.linkedin_url,
  c.tiktok_url,
  c.source,
  c.official_site_confidence,
  c.verification_status,
  c.sales_contact_allowed,
  c.crawl_status,
  c.analysis_status,
  c.created_at,
  c.updated_at,
  c.last_crawled_at,
  c.last_analyzed_at,
  (c.website_url is not null) as has_website,
  (c.recruit_page_url is not null) as has_recruit_page,
  (c.email is not null or c.contact_page_url is not null or c.contact_form_url is not null or c.phone is not null) as has_contact,
  (c.email is not null) as has_email,
  (c.instagram_url is not null or c.facebook_url is not null or c.x_url is not null or c.youtube_url is not null or c.linkedin_url is not null or c.tiktok_url is not null) as has_sns,
  a.id as analysis_id,
  a.recruiting_status,
  a.new_graduate_hiring,
  a.mid_career_hiring,
  a.recruitment_page_quality_score,
  a.recruitment_issue_score,
  a.web_quality_score,
  a.sns_activity_score,
  a.digital_marketing_score,
  a.dx_opportunity_score,
  a.growth_potential_score,
  a.sales_priority_score,
  a.sales_priority_rank,
  a.confidence_score,
  a.analyzed_at
from public.companies c
left join public.company_analysis a on a.id = c.latest_analysis_id;

-- =============================================================
-- ジョブ取得 RPC: SKIP LOCKED で同時実行しても二重処理しない
-- =============================================================
create or replace function public.claim_job(p_job_table text, p_stale_minutes integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
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

-- 検索ジョブのカウンタをアトミックに加算
create or replace function public.increment_search_job_counters(
  p_job_id uuid,
  p_found integer default 0,
  p_registered integer default 0,
  p_new integer default 0,
  p_duplicate integer default 0,
  p_skipped integer default 0,
  p_failed integer default 0
) returns void language sql security definer set search_path = public as $$
  update public.search_jobs
     set found_count = found_count + p_found,
         registered_count = registered_count + p_registered,
         new_count = new_count + p_new,
         duplicate_count = duplicate_count + p_duplicate,
         skipped_count = skipped_count + p_skipped,
         failed_count = failed_count + p_failed
   where id = p_job_id;
$$;

-- ダッシュボード集計
create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = public as $$
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

-- =============================================================
-- RLS: 社内ツールのため「認証済みユーザーは全操作可」。service_role はバイパス。
-- =============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','company_pages','company_analysis','company_analysis_evidence',
    'search_jobs','search_job_items','crawl_jobs','analysis_jobs',
    'system_logs','ai_usage_logs',
    'services','contacts','suppression_list','campaigns','email_templates',
    'email_messages','email_replies','activities'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated_all" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
