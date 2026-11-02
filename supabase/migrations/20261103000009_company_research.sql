-- LeadPilot AI — Company Research schema (docs/COMPANY_RESEARCH_SPEC.md §6–§9)
--
-- Additive only: no existing table, function, policy or row is changed, and nothing here
-- writes to public.leads, so imported lead data is never overwritten by research.
--
-- research_runs        one row per research run: job state + header of an immutable snapshot
-- lead_sources         public sources retrieved by a run (spec §16); page text lives in the
--                      private `research-sources` bucket, not in table rows
-- research_findings    append-only findings: fact (source + verified quote), candidate (source,
--                      unconfirmed) or assessment (AI hypothesis, never a fact)
-- research_run_events  append-only audit trail of every request, claim, retry, cancellation,
--                      completion, failure and text purge
--
-- Clients read through RLS and may only request/cancel runs. Research itself runs in the
-- background worker (service role), which saves each run's results in one transaction.

-- ---------------------------------------------------------------------------
-- 1. research_runs
-- ---------------------------------------------------------------------------

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'bulk', 'scheduled')),
  requested_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  previous_run_id uuid,

  pipeline_version text not null default 'research-v1'
    check (char_length(pipeline_version) between 1 and 50),
  ai_provider text check (char_length(ai_provider) <= 50),
  ai_model text check (char_length(ai_model) <= 100),
  prompt_version text check (char_length(prompt_version) <= 50),

  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_by text check (char_length(locked_by) between 1 and 100),
  locked_until timestamptz,
  cancel_requested_at timestamptz,

  error_code text check (char_length(error_code) <= 100),
  error_message text check (char_length(error_message) <= 2000),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),

  sources_count integer not null default 0 check (sources_count >= 0),
  facts_count integer not null default 0 check (facts_count >= 0),
  candidates_count integer not null default 0 check (candidates_count >= 0),
  assessments_count integer not null default 0 check (assessments_count >= 0),
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  ai_input_tokens integer not null default 0 check (ai_input_tokens >= 0),
  ai_output_tokens integer not null default 0 check (ai_output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),

  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (workspace_id, id, lead_id),
  unique (workspace_id, idempotency_key),
  -- NO ACTION: a lead with research history cannot be deleted. It is checked at the end of the
  -- statement, so deleting a whole workspace (which removes its runs too) still works.
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id) on delete no action,
  foreign key (workspace_id, previous_run_id) references public.research_runs (workspace_id, id)
    on delete no action,
  check (previous_run_id is null or previous_run_id <> id),
  -- Status and lifecycle columns always agree.
  check (case status
    when 'queued' then locked_by is null and locked_until is null and finished_at is null
    when 'running' then locked_by is not null and locked_until is not null
                        and started_at is not null and finished_at is null
    else finished_at is not null and locked_by is null and locked_until is null
  end)
);

-- Active = queued + running. At most one active run per company.
create unique index research_runs_active_lead_uidx
  on public.research_runs (workspace_id, lead_id) where status in ('queued', 'running');
create index research_runs_lead_history_idx
  on public.research_runs (workspace_id, lead_id, created_at desc);
create index research_runs_lead_finished_idx
  on public.research_runs (workspace_id, lead_id, finished_at desc) where finished_at is not null;
create index research_runs_claim_idx
  on public.research_runs (next_attempt_at, queued_at) where status = 'queued';
create index research_runs_lease_idx
  on public.research_runs (locked_until) where status = 'running';
create index research_runs_workspace_queued_idx
  on public.research_runs (workspace_id, queued_at desc);
create index research_runs_requested_by_idx
  on public.research_runs (requested_by) where requested_by is not null;
create index research_runs_previous_idx
  on public.research_runs (workspace_id, previous_run_id) where previous_run_id is not null;

create trigger research_runs_set_updated_at
  before update on public.research_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. lead_sources
-- ---------------------------------------------------------------------------
-- Extracted page text is stored gzip-compressed in the private `research-sources` bucket at
-- {workspace_id}/{lead_id}/{run_id}/{text_sha256}.txt.gz. The path is derived from the row,
-- so an object always belongs to exactly one run, lead and workspace.

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid not null,
  lead_id uuid not null,
  source_type text not null check (source_type in (
    'company_website', 'search_result', 'places_listing', 'social_profile',
    'business_directory', 'manual')),
  source_name text check (char_length(source_name) <= 255),
  url text not null check (char_length(url) <= 2048 and url ~* '^https?://'),
  final_url text check (char_length(final_url) <= 2048 and final_url ~* '^https?://'),
  http_status integer check (http_status between 100 and 599),
  content_type text check (char_length(content_type) <= 255),
  title text check (char_length(title) <= 500),
  retrieved_at timestamptz not null,

  text_sha256 text check (text_sha256 ~ '^[0-9a-f]{64}$'),
  text_chars integer check (text_chars between 1 and 200000),
  text_bytes integer check (text_bytes between 1 and 262144),
  text_storage_path text,
  text_purged_at timestamptz,
  created_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (workspace_id, run_id, id),
  unique (run_id, url),
  foreign key (workspace_id, run_id, lead_id)
    references public.research_runs (workspace_id, id, lead_id) on delete cascade,
  check ((text_sha256 is null) = (text_storage_path is null)
         and (text_sha256 is null) = (text_chars is null)
         and (text_sha256 is null) = (text_bytes is null)),
  check (text_storage_path is null or text_storage_path =
         workspace_id::text || '/' || lead_id::text || '/' || run_id::text || '/'
         || text_sha256 || '.txt.gz'),
  check (text_purged_at is null or text_storage_path is not null)
);

create index lead_sources_run_idx on public.lead_sources (workspace_id, run_id, lead_id);
create index lead_sources_lead_idx on public.lead_sources (workspace_id, lead_id, retrieved_at desc);
create index lead_sources_text_path_idx
  on public.lead_sources (text_storage_path) where text_storage_path is not null;

-- ---------------------------------------------------------------------------
-- 3. research_findings
-- ---------------------------------------------------------------------------

create table public.research_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid not null,
  lead_id uuid not null,
  category text not null check (category in (
    'business_description', 'service', 'service_area', 'location', 'contact_email',
    'contact_phone', 'contact_address', 'social_profile', 'person', 'certification',
    'company_detail', 'company_summary', 'observation', 'challenge', 'opportunity')),
  kind text not null check (kind in ('fact', 'candidate', 'assessment')),
  field_key text not null check (char_length(field_key) between 1 and 200),
  value_text text not null check (char_length(value_text) between 1 and 4000),
  value_json jsonb check (value_json is null or jsonb_typeof(value_json) = 'object'),
  value_hash text generated always as (md5(value_text || coalesce(value_json::text, ''))) stored,
  source_id uuid,
  evidence_quote text check (char_length(evidence_quote) between 3 and 1000),
  -- How the worker verified the quote against the retrieved text, and when.
  quote_check text check (quote_check in ('normalized_exact_v1')),
  quote_verified_at timestamptz,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  supporting_finding_ids uuid[] not null default '{}'
    check (cardinality(supporting_finding_ids) <= 20),
  created_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (run_id, category, field_key),
  foreign key (workspace_id, run_id, lead_id)
    references public.research_runs (workspace_id, id, lead_id) on delete cascade,
  -- A finding's source must come from the same run.
  foreign key (workspace_id, run_id, source_id)
    references public.lead_sources (workspace_id, run_id, id) on delete cascade,

  -- Interpretation categories are always AI assessments, and assessments are never facts.
  check ((category in ('company_summary', 'observation', 'challenge', 'opportunity'))
         = (kind = 'assessment')),
  check (kind = 'assessment' or source_id is not null),
  check (kind <> 'fact'
         or (evidence_quote is not null and quote_check is not null
             and quote_verified_at is not null)),
  check (kind = 'fact' or (quote_check is null and quote_verified_at is null)),
  check (kind <> 'assessment'
         or (source_id is null and evidence_quote is null and confidence is not null)),
  check (kind = 'assessment' or cardinality(supporting_finding_ids) = 0)
);

create index research_findings_run_idx on public.research_findings (workspace_id, run_id, lead_id);
create index research_findings_source_idx
  on public.research_findings (workspace_id, run_id, source_id) where source_id is not null;
create index research_findings_lead_idx on public.research_findings (workspace_id, lead_id, category);

-- ---------------------------------------------------------------------------
-- 4. research_run_events (audit trail)
-- ---------------------------------------------------------------------------

create table public.research_run_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid not null,
  event_type text not null check (event_type in (
    'requested', 'claimed', 'reclaimed', 'retry_scheduled', 'cancel_requested', 'cancelled',
    'completed', 'failed', 'text_purged')),
  actor_type text not null check (actor_type in ('user', 'worker', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  worker_id text check (char_length(worker_id) <= 100),
  attempt integer check (attempt >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),

  foreign key (workspace_id, run_id) references public.research_runs (workspace_id, id)
    on delete cascade
);

create index research_run_events_run_idx
  on public.research_run_events (workspace_id, run_id, created_at);
create index research_run_events_workspace_idx
  on public.research_run_events (workspace_id, created_at desc);
create index research_run_events_actor_idx
  on public.research_run_events (actor_user_id) where actor_user_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Immutability guards
-- ---------------------------------------------------------------------------
-- Changes issued by FK actions (deleting a workspace or user) run at trigger depth > 1 and
-- are allowed; everything else follows the rules below, for every role including the
-- service role.

create or replace function private.research_run_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.locked_by is not null
       or new.locked_until is not null or new.previous_run_id is not null
       or new.started_at is not null or new.finished_at is not null
       or new.cancel_requested_at is not null then
      raise exception 'New research runs must start queued and empty' using errcode = '42501';
    end if;
    return new;
  end if;

  if pg_catalog.pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Research runs are permanent history and cannot be deleted'
      using errcode = '42501';
  end if;

  if old.status in ('completed', 'completed_with_warnings', 'failed', 'cancelled') then
    raise exception 'Research run % is finished and cannot be changed', old.id
      using errcode = '42501';
  end if;

  if new.workspace_id <> old.workspace_id or new.lead_id <> old.lead_id
     or new.idempotency_key <> old.idempotency_key
     or new.requested_by is distinct from old.requested_by
     or new.trigger_source <> old.trigger_source
     or new.queued_at <> old.queued_at or new.created_at <> old.created_at then
    raise exception 'Research run identity cannot be changed' using errcode = '42501';
  end if;

  if not (
    (old.status = 'queued' and new.status in ('queued', 'running', 'cancelled'))
    or (old.status = 'running' and new.status in (
          'running', 'queued', 'completed', 'completed_with_warnings', 'failed', 'cancelled'))
  ) then
    raise exception 'Invalid research run transition % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger research_runs_guard
  before insert or update or delete on public.research_runs
  for each row execute function private.research_run_guard();

-- Sources and findings: written once, while their run is running; never changed afterwards,
-- except that a source's text_purged_at is set when its stored text is deleted.
create or replace function private.research_history_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.research_runs r where r.id = new.run_id and r.status = 'running'
    ) then
      raise exception 'Research results can only be added to a running research run'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'lead_sources' then
    if pg_catalog.current_setting('leadpilot.research_purge', true) = 'on'
       and old.text_purged_at is null and new.text_purged_at is not null
       and (pg_catalog.to_jsonb(new) - 'text_purged_at')
           = (pg_catalog.to_jsonb(old) - 'text_purged_at') then
      return new;
    end if;
  end if;

  raise exception 'Research history is permanent and cannot be changed' using errcode = '42501';
end;
$$;

create trigger lead_sources_guard
  before insert or update or delete on public.lead_sources
  for each row execute function private.research_history_guard();
create trigger research_findings_guard
  before insert or update or delete on public.research_findings
  for each row execute function private.research_history_guard();

-- A fact must cite a source from the same run whose text is stored and not purged. The worker
-- has already matched the quote against that text (quote_check), before uploading it.
create or replace function private.research_finding_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'fact' and not exists (
    select 1 from public.lead_sources s
    where s.id = new.source_id and s.run_id = new.run_id
      and s.text_storage_path is not null and s.text_purged_at is null
  ) then
    raise exception 'Fact % "%" must cite a source whose text was stored', new.category, new.field_key
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger research_findings_evidence
  before insert on public.research_findings
  for each row execute function private.research_finding_evidence();

-- Audit events are append-only.
create or replace function private.research_event_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Research audit events cannot be changed or deleted' using errcode = '42501';
end;
$$;

create trigger research_run_events_guard
  before update or delete on public.research_run_events
  for each row execute function private.research_event_guard();

revoke execute on function private.research_run_guard() from public, anon, authenticated;
revoke execute on function private.research_history_guard() from public, anon, authenticated;
revoke execute on function private.research_finding_evidence() from public, anon, authenticated;
revoke execute on function private.research_event_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.research_runs enable row level security;
alter table public.lead_sources enable row level security;
alter table public.research_findings enable row level security;
alter table public.research_run_events enable row level security;

create policy "research_runs_select_member" on public.research_runs
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy "lead_sources_select_member" on public.lead_sources
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy "research_findings_select_member" on public.research_findings
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy "research_run_events_select_member" on public.research_run_events
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));

create policy "research_runs_deny_anonymous" on public.research_runs
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));
create policy "lead_sources_deny_anonymous" on public.lead_sources
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));
create policy "research_findings_deny_anonymous" on public.research_findings
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));
create policy "research_run_events_deny_anonymous" on public.research_run_events
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

-- Clients read only. Runs are requested/cancelled through the functions below; results and
-- audit events are written by those functions and by the worker (service role).
revoke all on public.research_runs, public.lead_sources, public.research_findings,
  public.research_run_events from anon, authenticated;
grant select on public.research_runs, public.lead_sources, public.research_findings,
  public.research_run_events to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Private storage for extracted page text
-- ---------------------------------------------------------------------------
-- No storage.objects policies are created for this bucket, so anon and authenticated users
-- can neither read nor write it. Only the server-side worker (service role) uses it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-sources', 'research-sources', false, 262144, array['application/gzip'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 8. Research status per company (derived, cannot drift)
-- ---------------------------------------------------------------------------

create view public.lead_research_summary
with (security_invoker = true) as
select
  l.workspace_id,
  l.id as lead_id,
  act.id as active_run_id,
  act.status as active_run_status,
  done.id as last_successful_run_id,
  done.finished_at as last_researched_at,
  ended.id as last_finished_run_id,
  ended.status as last_finished_status,
  coalesce(
    act.status,
    case when ended.status = 'failed' then 'failed' end,
    case done.status
      when 'completed' then 'researched'
      when 'completed_with_warnings' then 'researched_with_warnings'
    end,
    'not_researched'
  ) as research_status
from public.leads l
left join lateral (
  select r.id, r.status from public.research_runs r
  where r.workspace_id = l.workspace_id and r.lead_id = l.id
    and r.status in ('queued', 'running')
  limit 1
) act on true
left join lateral (
  select r.id, r.status, r.finished_at from public.research_runs r
  where r.workspace_id = l.workspace_id and r.lead_id = l.id
    and r.status in ('completed', 'completed_with_warnings')
  order by r.finished_at desc
  limit 1
) done on true
left join lateral (
  select r.id, r.status from public.research_runs r
  where r.workspace_id = l.workspace_id and r.lead_id = l.id
    and r.finished_at is not null
  order by r.finished_at desc
  limit 1
) ended on true;

revoke all on public.lead_research_summary from anon, authenticated;
grant select on public.lead_research_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Client functions
-- ---------------------------------------------------------------------------

-- Queues research for up to 100 companies; never runs research itself.
-- Outcome per lead: queued | duplicate_request | already_active | not_found | limit_reached
-- Limits (per workspace): 200 active (queued + running) runs and 300 new runs in any
-- 24 hours. Retries reuse their run and never count as new runs.
create or replace function public.request_lead_research(
  p_workspace_id uuid,
  p_lead_ids uuid[],
  p_request_key text
)
returns table (lead_id uuid, run_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_max_active constant integer := 200;
  v_max_daily constant integer := 300;
  v_active integer;
  v_daily integer;
  v_lead uuid;
  v_run uuid;
  v_key text;
  v_trigger text;
begin
  if v_user is null or public.is_anonymous_user() then
    raise exception 'Sign in to request research' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'You are not a member of this workspace' using errcode = '42501';
  end if;
  if p_request_key is null or pg_catalog.char_length(p_request_key) not between 8 and 100 then
    raise exception 'A request key is required' using errcode = '22023';
  end if;
  if p_lead_ids is null or pg_catalog.cardinality(p_lead_ids) not between 1 and 100 then
    raise exception 'Choose between 1 and 100 companies' using errcode = '22023';
  end if;
  v_trigger := case when pg_catalog.cardinality(p_lead_ids) > 1 then 'bulk' else 'manual' end;

  -- One request per workspace at a time, so concurrent requests cannot exceed the limits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leadpilot.research:' || p_workspace_id::text, 0));

  select pg_catalog.count(*) into v_active from public.research_runs r
  where r.workspace_id = p_workspace_id and r.status in ('queued', 'running');
  select pg_catalog.count(*) into v_daily from public.research_runs r
  where r.workspace_id = p_workspace_id
    and r.queued_at > pg_catalog.now() - interval '24 hours';

  for v_lead in
    select distinct u.v from pg_catalog.unnest(p_lead_ids) as u(v) where u.v is not null
  loop
    lead_id := v_lead;
    v_key := p_request_key || ':' || v_lead::text;

    select r.id into v_run from public.research_runs r
    where r.workspace_id = p_workspace_id and r.idempotency_key = v_key;
    if found then
      run_id := v_run; outcome := 'duplicate_request'; return next; continue;
    end if;

    if not exists (
      select 1 from public.leads l
      where l.workspace_id = p_workspace_id and l.id = v_lead and not l.suppressed
    ) then
      run_id := null; outcome := 'not_found'; return next; continue;
    end if;

    select r.id into v_run from public.research_runs r
    where r.workspace_id = p_workspace_id and r.lead_id = v_lead
      and r.status in ('queued', 'running');
    if found then
      run_id := v_run; outcome := 'already_active'; return next; continue;
    end if;

    if v_active >= v_max_active or v_daily >= v_max_daily then
      run_id := null; outcome := 'limit_reached'; return next; continue;
    end if;

    insert into public.research_runs (workspace_id, lead_id, requested_by, idempotency_key, trigger_source)
    values (p_workspace_id, v_lead, v_user, v_key, v_trigger)
    returning id into v_run;
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, actor_user_id, attempt)
    values (p_workspace_id, v_run, 'requested', 'user', v_user, 0);

    v_active := v_active + 1;
    v_daily := v_daily + 1;
    run_id := v_run; outcome := 'queued'; return next;
  end loop;
end;
$$;

-- Returns: cancelled | cancel_requested | <current finished status>
create or replace function public.cancel_research_run(p_run_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_run public.research_runs%rowtype;
begin
  if v_user is null or public.is_anonymous_user() then
    raise exception 'Sign in to cancel research' using errcode = '42501';
  end if;
  select * into v_run from public.research_runs r where r.id = p_run_id for update;
  if not found or not private.is_workspace_member(v_run.workspace_id) then
    raise exception 'Research run not found' using errcode = 'P0002';
  end if;
  if v_run.requested_by is distinct from v_user
     and not private.has_workspace_role(v_run.workspace_id,
           array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Only the requester or an owner/admin can cancel this run'
      using errcode = '42501';
  end if;

  if v_run.status = 'queued' then
    update public.research_runs r
    set status = 'cancelled', finished_at = pg_catalog.now(),
        error_code = 'cancelled', error_message = 'Cancelled before it started.'
    where r.id = p_run_id;
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, actor_user_id, attempt)
    values (v_run.workspace_id, v_run.id, 'cancelled', 'user', v_user, v_run.attempts);
    return 'cancelled';
  elsif v_run.status = 'running' then
    if v_run.cancel_requested_at is null then
      update public.research_runs r set cancel_requested_at = pg_catalog.now() where r.id = p_run_id;
      insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, actor_user_id, attempt)
      values (v_run.workspace_id, v_run.id, 'cancel_requested', 'user', v_user, v_run.attempts);
    end if;
    return 'cancel_requested';
  end if;
  return v_run.status;
end;
$$;

-- What changed in a run compared with the previous successful run (RLS applies).
create or replace function public.research_run_changes(p_run_id uuid)
returns table (
  change_type text,
  category text,
  field_key text,
  kind text,
  previous_value text,
  current_value text,
  previous_finding_id uuid,
  current_finding_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with run as (
    select r.id, r.previous_run_id from public.research_runs r where r.id = p_run_id
  ),
  cur as (
    select f.* from public.research_findings f where f.run_id = (select id from run)
  ),
  prev as (
    select f.* from public.research_findings f where f.run_id = (select previous_run_id from run)
  )
  select
    case
      when p.id is null then 'added'
      when c.id is null then 'removed'
      when c.value_hash = p.value_hash and c.kind = p.kind then 'unchanged'
      else 'changed'
    end,
    coalesce(c.category, p.category),
    coalesce(c.field_key, p.field_key),
    coalesce(c.kind, p.kind),
    p.value_text,
    c.value_text,
    p.id,
    c.id
  from cur c
  full join prev p on p.category = c.category and p.field_key = c.field_key
  order by 2, 3;
$$;

revoke execute on function public.request_lead_research(uuid, uuid[], text) from public, anon;
grant execute on function public.request_lead_research(uuid, uuid[], text) to authenticated;
revoke execute on function public.cancel_research_run(uuid) from public, anon;
grant execute on function public.cancel_research_run(uuid) to authenticated;
revoke execute on function public.research_run_changes(uuid) from public, anon;
grant execute on function public.research_run_changes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Worker functions (service role only)
-- ---------------------------------------------------------------------------
-- Every function that acts on a run locks it and re-checks that the run, its lead and its
-- workspace still exist and belong together, and that this worker holds the run's lease.

-- Claims up to p_limit runnable runs (at most 3 running per workspace) and leases them.
-- Runs whose lease expired are reclaimed as a new attempt of the same run, or finished if
-- no attempts remain; no second run or snapshot is ever created.
create or replace function public.worker_claim_research_runs(
  p_worker_id text,
  p_limit integer default 3,
  p_lease_seconds integer default 300
)
returns setof public.research_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 20);
  v_lease interval := pg_catalog.make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900));
  v_per_workspace constant integer := 3;
  v_ids uuid[];
  v_prev text[];
  v_row public.research_runs%rowtype;
begin
  if p_worker_id is null or pg_catalog.char_length(p_worker_id) not between 1 and 100 then
    raise exception 'A worker id is required' using errcode = '22023';
  end if;

  -- Claims are short; serializing them keeps the per-workspace cap exact.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leadpilot.research.claim', 0));

  -- Abandoned runs that cannot be retried are finished now.
  with finished as (
    update public.research_runs r
    set status = case when r.cancel_requested_at is not null then 'cancelled' else 'failed' end,
        finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
        error_code = case when r.cancel_requested_at is not null then 'cancelled' else 'lease_expired' end,
        error_message = case when r.cancel_requested_at is not null
          then 'Cancelled while the worker was unresponsive.'
          else 'The worker stopped responding and no attempts remain.' end
    where r.status = 'running' and r.locked_until < pg_catalog.now()
      and (r.cancel_requested_at is not null or r.attempts >= r.max_attempts)
    returning r.workspace_id, r.id, r.status, r.attempts, r.locked_by
  )
  insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt, details)
  select f.workspace_id, f.id, f.status, 'system', p_worker_id, f.attempts,
         pg_catalog.jsonb_build_object('reason', 'lease_expired')
  from finished f;

  with busy as (
    select r.workspace_id, pg_catalog.count(*)::integer as n
    from public.research_runs r
    where r.status = 'running' and r.locked_until >= pg_catalog.now()
    group by r.workspace_id
  ),
  eligible as (
    select r.id, r.status, r.workspace_id, r.next_attempt_at, r.queued_at,
           pg_catalog.row_number() over (
             partition by r.workspace_id order by r.next_attempt_at, r.queued_at) as rn
    from public.research_runs r
    join public.leads l on l.workspace_id = r.workspace_id and l.id = r.lead_id
    where (r.status = 'queued' and r.next_attempt_at <= pg_catalog.now())
       or (r.status = 'running' and r.locked_until < pg_catalog.now())
  ),
  picked as (
    select e.id, e.status from eligible e
    left join busy b on b.workspace_id = e.workspace_id
    where e.rn + coalesce(b.n, 0) <= v_per_workspace
    order by e.next_attempt_at, e.queued_at
    limit v_limit
  )
  select pg_catalog.array_agg(p.id), pg_catalog.array_agg(p.status) into v_ids, v_prev from picked p;

  if v_ids is null then
    return;
  end if;

  for v_row in
    update public.research_runs r
    set status = 'running',
        attempts = r.attempts + 1,
        locked_by = p_worker_id,
        locked_until = pg_catalog.now() + v_lease,
        started_at = coalesce(r.started_at, pg_catalog.now())
    where r.id = any (v_ids)
      -- Re-checked after any concurrent change (e.g. a cancellation).
      and ((r.status = 'queued' and r.next_attempt_at <= pg_catalog.now())
           or (r.status = 'running' and r.locked_until < pg_catalog.now()))
    returning r.*
  loop
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, worker_id, attempt)
    values (v_row.workspace_id, v_row.id,
            case when v_prev[pg_catalog.array_position(v_ids, v_row.id)] = 'running'
                 then 'reclaimed' else 'claimed' end,
            'worker', p_worker_id, v_row.attempts);
    return next v_row;
  end loop;
end;
$$;

-- Extends the lease. false = stop work (cancel requested, lease lost or run gone).
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
    and r.cancel_requested_at is null
    and l.workspace_id = r.workspace_id and l.id = r.lead_id and w.id = r.workspace_id;
  return found;
end;
$$;

-- Saves a run's complete results atomically and finishes the run.
-- p_result: { pipeline_version?, ai: {provider, model, prompt_version}?,
--   usage: {pages_fetched, input_tokens, output_tokens, cost_usd}?, warnings: [],
--   sources: [{ref, source_type, source_name, url, final_url, http_status, content_type,
--              title, retrieved_at, text: {sha256, chars, bytes} | null}],
--   findings: [{ref, category, kind, field_key, value_text, value_json?, source_ref?,
--               evidence_quote?, quote_check?, confidence?, supporting_refs?: []}] }
-- Source text must already be uploaded to research-sources at the path derived from the row.
-- Returns: completed | completed_with_warnings | cancelled
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
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id then
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

-- Records a failed attempt. Returns: queued (will retry) | failed | cancelled
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
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id then
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

-- Stored page text that may now be deleted: text of a successful run superseded by a newer
-- successful run that finished more than 90 days ago. The latest successful run per company
-- always keeps its text. The worker deletes these objects through the Storage API, then calls
-- worker_mark_research_text_purged.
create or replace function public.worker_research_text_due_for_purge(p_limit integer default 200)
returns table (source_id uuid, run_id uuid, storage_path text)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.run_id, s.text_storage_path
  from public.lead_sources s
  join public.research_runs r on r.id = s.run_id
  where s.text_storage_path is not null
    and s.text_purged_at is null
    and r.status in ('completed', 'completed_with_warnings')
    and exists (
      select 1 from public.research_runs n
      where n.workspace_id = r.workspace_id and n.lead_id = r.lead_id
        and n.status in ('completed', 'completed_with_warnings')
        and n.finished_at > r.finished_at
        and n.finished_at < pg_catalog.now() - interval '90 days'
    )
  order by r.finished_at, s.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- Records that stored text was deleted. Re-checks eligibility, so text that is not due can
-- never be marked. Only text_purged_at changes; URLs, hashes, quotes and findings are kept.
create or replace function public.worker_mark_research_text_purged(p_source_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_source_ids is null or pg_catalog.cardinality(p_source_ids) > 1000 then
    raise exception 'Pass at most 1000 source ids' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('leadpilot.research_purge', 'on', true);
  with marked as (
    update public.lead_sources s
    set text_purged_at = pg_catalog.now()
    from public.research_runs r
    where s.id = any (p_source_ids)
      and r.id = s.run_id
      and s.text_storage_path is not null
      and s.text_purged_at is null
      and r.status in ('completed', 'completed_with_warnings')
      and exists (
        select 1 from public.research_runs n
        where n.workspace_id = r.workspace_id and n.lead_id = r.lead_id
          and n.status in ('completed', 'completed_with_warnings')
          and n.finished_at > r.finished_at
          and n.finished_at < pg_catalog.now() - interval '90 days'
      )
    returning s.workspace_id, s.run_id
  ), per_run as (
    select m.workspace_id, m.run_id, pg_catalog.count(*)::integer as n
    from marked m group by m.workspace_id, m.run_id
  ), events as (
    insert into public.research_run_events (workspace_id, run_id, event_type, actor_type, details)
    select p.workspace_id, p.run_id, 'text_purged', 'system',
           pg_catalog.jsonb_build_object('sources', p.n, 'retention_days', 90)
    from per_run p
    returning 1
  )
  select coalesce(pg_catalog.sum(p.n), 0)::integer into v_count from per_run p;
  perform pg_catalog.set_config('leadpilot.research_purge', 'off', true);
  return v_count;
end;
$$;

-- Objects in research-sources that no source row references and that can no longer become
-- referenced: uploads from failed, cancelled or superseded attempts, and objects of deleted
-- workspaces. Objects of queued/running runs and uploads younger than one hour are kept.
create or replace function public.worker_research_orphan_objects(p_limit integer default 200)
returns table (storage_path text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'research-sources'
    and o.created_at < pg_catalog.now() - interval '1 hour'
    and not exists (select 1 from public.lead_sources s where s.text_storage_path = o.name)
    and not exists (
      select 1 from public.research_runs r
      -- CASE guarantees the uuid cast only runs on well-formed paths, so a malformed object
      -- name is simply treated as unreferenced instead of failing the whole sweep.
      where r.id = case
          when o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
          then pg_catalog.split_part(o.name, '/', 3)::uuid
        end
        and r.status in ('queued', 'running')
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke execute on function public.worker_claim_research_runs(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.worker_heartbeat_research_run(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.worker_complete_research_run(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.worker_fail_research_run(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.worker_research_text_due_for_purge(integer) from public, anon, authenticated;
revoke execute on function public.worker_mark_research_text_purged(uuid[]) from public, anon, authenticated;
revoke execute on function public.worker_research_orphan_objects(integer) from public, anon, authenticated;
grant execute on function public.worker_claim_research_runs(text, integer, integer) to service_role;
grant execute on function public.worker_heartbeat_research_run(uuid, text, integer) to service_role;
grant execute on function public.worker_complete_research_run(uuid, text, jsonb) to service_role;
grant execute on function public.worker_fail_research_run(uuid, text, text, text, boolean) to service_role;
grant execute on function public.worker_research_text_due_for_purge(integer) to service_role;
grant execute on function public.worker_mark_research_text_purged(uuid[]) to service_role;
grant execute on function public.worker_research_orphan_objects(integer) to service_role;
