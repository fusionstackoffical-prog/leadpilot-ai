-- LeadPilot AI — research worker: a lease must still be valid (draft; not applied anywhere)
--
-- Migration 009's worker functions check WHO holds a run (locked_by) and that it is running, but not
-- whether the lease has EXPIRED. Until another worker reclaims the run, a worker whose lease ran out
-- could keep acting on it:
--   * worker_heartbeat_research_run  extended (revived) the expired lease, so the claim query then saw
--                                    a live lease and refused to reclaim the run;
--   * worker_complete_research_run   saved results after the lease expired;
--   * worker_fail_research_run       recorded a failure and re-queued the run after the lease expired.
-- Migration 010 closed the same gap for AI analysis runs; this migration does it for research runs,
-- with the same rule: a lease is valid while locked_until >= now(). worker_claim_research_runs already
-- treats a lease as expired only when locked_until < now() (reclaim, sweep and eligibility), so the two
-- definitions agree and a lease is never both expired and valid.
--
-- What changes: ONLY the three functions below, each copied from migration 009 with one extra lease
-- condition. Names, argument lists and defaults, return types, language, SECURITY INVOKER, the pinned
-- search_path and volatility are unchanged, and so are the refusals: heartbeat still answers false, and
-- complete and fail still raise 55000 "is not held by this worker" (the code the application worker
-- already maps to "lease lost"). CREATE OR REPLACE keeps each function's owner and its privileges
-- (service_role only), so no GRANT or REVOKE is needed or issued. No table, policy, trigger, index,
-- constraint, claim function or maintenance function is touched. A running run always has a
-- locked_until (migration 009's lifecycle check), so the comparison is never against NULL.


create or replace function public.worker_heartbeat_research_run(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.research_runs r
  set locked_until = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900))
  from public.leads l, public.workspaces w
  where r.id = p_run_id and r.status = 'running' and r.locked_by = p_worker_id
    and r.locked_until >= pg_catalog.now()
    and r.cancel_requested_at is null
    and l.workspace_id = r.workspace_id and l.id = r.lead_id and w.id = r.workspace_id;
  return found;
end;
$$;

create or replace function public.worker_complete_research_run(
  p_run_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.research_runs%rowtype;
  v_warnings jsonb := coalesce(p_result -> 'warnings', '[]'::jsonb);
  v_sources jsonb := '{}'::jsonb;
  v_findings jsonb := '{}'::jsonb;
  v_item jsonb;
  v_id uuid;
  v_path text;
  v_support uuid[];
  v_prev uuid;
  v_status text;
begin
  select r.* into v_run
  from public.research_runs r
  join public.leads l on l.workspace_id = r.workspace_id and l.id = r.lead_id
  join public.workspaces w on w.id = r.workspace_id
  where r.id = p_run_id
  for update of r;
  if not found then
    raise exception 'Research run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id
     or v_run.locked_until < pg_catalog.now() then
    raise exception 'Research run % is not held by this worker', p_run_id using errcode = '55000';
  end if;

  if v_run.cancel_requested_at is not null then
    update public.research_runs r
    set status = 'cancelled', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
        error_code = 'cancelled', error_message = 'Cancelled before results were saved.'
    where r.id = p_run_id;
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt)
    values (v_run.workspace_id, v_run.id, 'cancelled', 'worker', p_worker_id, v_run.attempts);
    return 'cancelled';
  end if;

  if pg_catalog.jsonb_typeof(p_result -> 'sources') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_result -> 'findings') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_warnings) <> 'array' then
    raise exception 'Result must contain sources, findings and warnings arrays'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_result -> 'sources') > 25
     or pg_catalog.jsonb_array_length(p_result -> 'findings') > 300
     or pg_catalog.jsonb_array_length(v_warnings) > 50 then
    raise exception 'Result exceeds the per-run limits' using errcode = '54000';
  end if;

  for v_item in select t.e from pg_catalog.jsonb_array_elements(p_result -> 'sources') as t(e) loop
    if v_item ->> 'ref' is null or v_sources ? (v_item ->> 'ref') then
      raise exception 'Each source needs a unique ref' using errcode = '22023';
    end if;

    v_path := null;
    if pg_catalog.jsonb_typeof(v_item -> 'text') = 'object' then
      v_path := v_run.workspace_id::text || '/' || v_run.lead_id::text || '/' || v_run.id::text
                || '/' || (v_item #>> '{text,sha256}') || '.txt.gz';
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'research-sources' and o.name = v_path
      ) then
        raise exception 'Source text for % was not uploaded', v_item ->> 'url'
          using errcode = '23514';
      end if;
    end if;

    insert into public.lead_sources (
      workspace_id, run_id, lead_id, source_type, source_name, url, final_url, http_status,
      content_type, title, retrieved_at, text_sha256, text_chars, text_bytes, text_storage_path)
    values (
      v_run.workspace_id, v_run.id, v_run.lead_id,
      v_item ->> 'source_type', v_item ->> 'source_name', v_item ->> 'url',
      v_item ->> 'final_url', (v_item ->> 'http_status')::integer, v_item ->> 'content_type',
      v_item ->> 'title', (v_item ->> 'retrieved_at')::timestamptz,
      v_item #>> '{text,sha256}', (v_item #>> '{text,chars}')::integer,
      (v_item #>> '{text,bytes}')::integer, v_path)
    returning id into v_id;
    v_sources := v_sources || pg_catalog.jsonb_build_object(v_item ->> 'ref', v_id);
  end loop;

  -- Facts and candidates first, so assessments can cite them.
  for v_item in
    select t.e from pg_catalog.jsonb_array_elements(p_result -> 'findings') as t(e)
    order by (t.e ->> 'kind') = 'assessment'
  loop
    if v_item ->> 'ref' is null or v_findings ? (v_item ->> 'ref') then
      raise exception 'Each finding needs a unique ref' using errcode = '22023';
    end if;
    if v_item ->> 'source_ref' is not null and not v_sources ? (v_item ->> 'source_ref') then
      raise exception 'Finding % cites an unknown source', v_item ->> 'ref' using errcode = '22023';
    end if;

    select coalesce(pg_catalog.array_agg((v_findings ->> s.ref)::uuid), '{}')
      into v_support
    from pg_catalog.jsonb_array_elements_text(
      coalesce(v_item -> 'supporting_refs', '[]'::jsonb)) as s(ref);
    if pg_catalog.array_position(v_support, null) is not null
       or exists (select 1 from public.research_findings f
                  where f.id = any (v_support) and f.kind = 'assessment') then
      raise exception 'Finding % must cite facts or candidates from this run', v_item ->> 'ref'
        using errcode = '22023';
    end if;

    insert into public.research_findings (
      workspace_id, run_id, lead_id, category, kind, field_key, value_text, value_json,
      source_id, evidence_quote, quote_check, quote_verified_at, confidence,
      supporting_finding_ids)
    values (
      v_run.workspace_id, v_run.id, v_run.lead_id,
      v_item ->> 'category', v_item ->> 'kind', v_item ->> 'field_key', v_item ->> 'value_text',
      nullif(v_item -> 'value_json', 'null'::jsonb),
      (v_sources ->> (v_item ->> 'source_ref'))::uuid,
      v_item ->> 'evidence_quote',
      v_item ->> 'quote_check',
      case when v_item ->> 'quote_check' is not null then pg_catalog.now() end,
      (v_item ->> 'confidence')::numeric, v_support)
    returning id into v_id;
    v_findings := v_findings || pg_catalog.jsonb_build_object(v_item ->> 'ref', v_id);
  end loop;

  select r.id into v_prev from public.research_runs r
  where r.workspace_id = v_run.workspace_id and r.lead_id = v_run.lead_id
    and r.status in ('completed', 'completed_with_warnings')
  order by r.finished_at desc
  limit 1;

  v_status := case when pg_catalog.jsonb_array_length(v_warnings) > 0
    then 'completed_with_warnings' else 'completed' end;

  update public.research_runs r
  set status = v_status,
      previous_run_id = v_prev,
      finished_at = pg_catalog.now(),
      locked_by = null,
      locked_until = null,
      error_code = null,
      error_message = null,
      warnings = v_warnings,
      pipeline_version = coalesce(p_result ->> 'pipeline_version', r.pipeline_version),
      ai_provider = p_result #>> '{ai,provider}',
      ai_model = p_result #>> '{ai,model}',
      prompt_version = p_result #>> '{ai,prompt_version}',
      pages_fetched = coalesce((p_result #>> '{usage,pages_fetched}')::integer, 0),
      ai_input_tokens = coalesce((p_result #>> '{usage,input_tokens}')::integer, 0),
      ai_output_tokens = coalesce((p_result #>> '{usage,output_tokens}')::integer, 0),
      cost_usd = coalesce((p_result #>> '{usage,cost_usd}')::numeric, 0),
      sources_count = (select pg_catalog.count(*) from public.lead_sources s where s.run_id = p_run_id),
      facts_count = (select pg_catalog.count(*) from public.research_findings f
                     where f.run_id = p_run_id and f.kind = 'fact'),
      candidates_count = (select pg_catalog.count(*) from public.research_findings f
                          where f.run_id = p_run_id and f.kind = 'candidate'),
      assessments_count = (select pg_catalog.count(*) from public.research_findings f
                           where f.run_id = p_run_id and f.kind = 'assessment')
  where r.id = p_run_id;

  insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt, details)
  values (v_run.workspace_id, v_run.id, 'completed', 'worker', p_worker_id, v_run.attempts,
          pg_catalog.jsonb_build_object('status', v_status, 'previous_run_id', v_prev,
            'sources', pg_catalog.jsonb_array_length(p_result -> 'sources'),
            'findings', pg_catalog.jsonb_array_length(p_result -> 'findings')));

  return v_status;
end;
$$;

create or replace function public.worker_fail_research_run(
  p_run_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.research_runs%rowtype;
  v_code text := pg_catalog.left(coalesce(p_error_code, 'unknown_error'), 100);
  v_message text := pg_catalog.left(coalesce(p_error_message, 'Research failed.'), 2000);
  v_delay interval;
begin
  select r.* into v_run
  from public.research_runs r
  join public.leads l on l.workspace_id = r.workspace_id and l.id = r.lead_id
  join public.workspaces w on w.id = r.workspace_id
  where r.id = p_run_id
  for update of r;
  if not found then
    raise exception 'Research run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id
     or v_run.locked_until < pg_catalog.now() then
    raise exception 'Research run % is not held by this worker', p_run_id using errcode = '55000';
  end if;

  if v_run.cancel_requested_at is not null then
    update public.research_runs r
    set status = 'cancelled', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
        error_code = 'cancelled', error_message = 'Cancelled while running.'
    where r.id = p_run_id;
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt, details)
    values (v_run.workspace_id, v_run.id, 'cancelled', 'worker', p_worker_id, v_run.attempts,
            pg_catalog.jsonb_build_object('code', v_code, 'message', v_message));
    return 'cancelled';
  elsif coalesce(p_retryable, false) and v_run.attempts < v_run.max_attempts then
    v_delay := pg_catalog.make_interval(mins => least(60, (2 ^ v_run.attempts)::integer));
    update public.research_runs r
    set status = 'queued', locked_by = null, locked_until = null,
        next_attempt_at = pg_catalog.now() + v_delay,
        error_code = v_code, error_message = v_message
    where r.id = p_run_id;
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt, details)
    values (v_run.workspace_id, v_run.id, 'retry_scheduled', 'worker', p_worker_id, v_run.attempts,
            pg_catalog.jsonb_build_object('code', v_code, 'message', v_message,
              'retry_in_minutes', pg_catalog.date_part('epoch', v_delay) / 60));
    return 'queued';
  end if;

  update public.research_runs r
  set status = 'failed', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
      error_code = v_code, error_message = v_message
  where r.id = p_run_id;
  insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt, details)
  values (v_run.workspace_id, v_run.id, 'failed', 'worker', p_worker_id, v_run.attempts,
          pg_catalog.jsonb_build_object('code', v_code, 'message', v_message,
            'retryable', coalesce(p_retryable, false)));
  return 'failed';
end;
$$;
