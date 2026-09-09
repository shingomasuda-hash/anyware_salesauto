-- =============================================================
-- Discovery 用の関数拡張。
-- 既存の claim_job を discovery_runs にも対応させる（CREATE OR REPLACE で置き換え）。
-- 既存のテーブル定義・他の関数には影響しない。
-- =============================================================

create or replace function public.claim_job(p_job_table text, p_stale_minutes integer default 10)
returns jsonb
language plpgsql
as $$
declare
  v_row jsonb;
begin
  if p_job_table not in ('search_jobs','crawl_jobs','analysis_jobs','discovery_runs') then
    raise exception 'invalid job table: %', p_job_table;
  end if;

  -- 古い processing / running（クラッシュ等）を復帰させる
  if p_job_table = 'discovery_runs' then
    update public.discovery_runs
       set status = 'pending', locked_at = null
     where status = 'running' and locked_at < now() - make_interval(mins => p_stale_minutes);
  else
    execute format(
      'update public.%I set status = ''retrying'', locked_at = null
         where status = ''processing'' and locked_at < now() - make_interval(mins => $1)',
      p_job_table
    ) using p_stale_minutes;
  end if;

  if p_job_table = 'discovery_runs' then
    -- FOR UPDATE SKIP LOCKED により、複数 worker が同じ Run を同時に処理しない
    with next as (
      select id from public.discovery_runs
       where status = 'pending'
       order by created_at
       for update skip locked
       limit 1)
    update public.discovery_runs r
       set status = 'running', locked_at = now(), attempts = r.attempts + 1,
           started_at = coalesce(r.started_at, now())
      from next where r.id = next.id
    returning to_jsonb(r) into v_row;
    return v_row;
  end if;

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

-- updated_at トリガーを新テーブルにも適用
do $$
declare t text;
begin
  foreach t in array array['discovery_runs','discovery_candidates'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;
--> statement-breakpoint

-- ダッシュボード集計に Discovery の待機件数を含める
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
    'needs_review_candidates', (select count(*) from public.discovery_candidates where status = 'needs_review'),
    'pending_jobs', (select (select count(*) from public.crawl_jobs where status in ('pending','retrying','processing'))
                          + (select count(*) from public.analysis_jobs where status in ('pending','retrying','processing'))
                          + (select count(*) from public.search_jobs where status in ('pending','retrying','processing'))
                          + (select count(*) from public.discovery_runs where status in ('pending','running')))
  );
$$;
