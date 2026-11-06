-- LeadPilot AI — AI analysis schema (Phase 4, step 1)  ** DRAFT: not applied anywhere **
--
-- Additive only. Migrations 001–009 are not modified; no existing table, function, policy,
-- grant or row is changed, and nothing here writes to public.leads or to any research table.
--
-- lead_analysis_runs   one row per AI analysis of ONE completed research run: job state +
--                      header of an immutable result (provider, model, versions, usage, cost)
-- lead_opportunities   the opportunities an analysis found: fixed category, fit level,
--                      rationale, confidence, the research findings it relies on, what is
--                      missing and what is uncertain. Append-only.
--
-- Rules the database enforces (not only the application):
--   * only a COMPLETED research run can be analyzed, and only for a non-suppressed lead;
--   * an opportunity may cite only facts and candidates of THAT research run, never an
--     assessment, never a finding from another run, and never e-mail, phone or person findings;
--   * candidates stay unconfirmed: an opportunity that relies on one is flagged
--     (based_on_unconfirmed), and "strong" fit needs at least one confirmed fact;
--   * results are written once, while the analysis is running, and never changed or deleted;
--   * a worker may act on a run only while it holds a VALID lease (locked_until not passed);
--     after that the run belongs to whichever worker reclaims it, and the old worker's
--     heartbeat, completion and failure report are all refused;
--   * a company suppressed after the analysis was queued is never sent to the provider and
--     never gets results: its run is finished as failed / lead_suppressed. Cancellation
--     (a person's explicit action) takes precedence over suppression;
--   * error text is never free text: it is looked up from a fixed code, so a raw provider
--     response or exception can never be stored;
--   * clients read through RLS (workspace members only) and request/cancel through functions.
--
-- Provider-neutral: `provider` and `model` are recorded as text. 'gemini' is the intended
-- provider and the default. No API key, endpoint or price lives in the database.

-- ---------------------------------------------------------------------------
-- 1. Fixed error codes and their messages
-- ---------------------------------------------------------------------------

create or replace function private.analysis_error_message(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'provider_not_configured' then 'AI analysis is not set up on this server.'
    when 'provider_unavailable'    then 'The AI service could not be reached.'
    when 'provider_rate_limited'   then 'The AI service is busy. It will be tried again later.'
    when 'provider_timeout'        then 'The AI service took too long to respond.'
    when 'provider_rejected'       then 'The AI service refused the request.'
    when 'invalid_output'          then 'The AI service returned an answer that could not be used.'
    when 'evidence_check_failed'   then 'The AI answer cited evidence that does not exist, so it was discarded.'
    when 'input_too_large'         then 'The research is too large to analyze in one request.'
    when 'no_usable_findings'      then 'The research has too little usable information to analyze.'
    when 'budget_exceeded'         then 'The AI budget limit was reached.'
    when 'unsupported_request'     then 'This analysis request is not supported by this server.'
    when 'research_not_usable'     then 'The research this analysis relies on can no longer be used.'
    when 'lead_not_found'          then 'The company no longer exists in this workspace.'
    when 'lead_suppressed'         then 'The company was suppressed, so it was not analyzed.'
    when 'cancelled'               then 'Cancelled.'
    when 'lease_expired'           then 'The analysis worker stopped responding and no attempts remain.'
    when 'internal_error'          then 'An internal error stopped the analysis.'
  end
$$;
revoke execute on function private.analysis_error_message(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. lead_analysis_runs
-- ---------------------------------------------------------------------------

create table public.lead_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  -- The completed research run this analysis reads. Its findings never change, so the
  -- analysis always refers to exactly the information it was given.
  research_run_id uuid not null,

  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'failed', 'cancelled')),
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'bulk', 'scheduled')),
  requested_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),

  provider text not null default 'gemini' check (provider ~ '^[a-z][a-z0-9_-]{0,49}$'),
  -- Known only once the worker has run; null for runs that never reached the provider.
  model text check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'),
  prompt_version text not null check (prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'),
  schema_version text not null check (schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'),
  -- SHA-256 of the evidence the model was given (never the evidence itself).
  input_hash text check (input_hash ~ '^[0-9a-f]{64}$'),
  input_finding_count integer check (input_finding_count >= 0),

  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_by text check (char_length(locked_by) between 1 and 100),
  locked_until timestamptz,
  cancel_requested_at timestamptz,

  -- Safe classification only. error_message is derived from error_code by the guard trigger.
  error_code text check (error_code in (
    'provider_not_configured', 'provider_unavailable', 'provider_rate_limited',
    'provider_timeout', 'provider_rejected', 'invalid_output', 'evidence_check_failed',
    'input_too_large', 'no_usable_findings', 'budget_exceeded', 'unsupported_request',
    'research_not_usable', 'lead_not_found', 'lead_suppressed', 'cancelled', 'lease_expired',
    'internal_error')),
  error_message text check (char_length(error_message) <= 500),
  -- Short machine codes such as 'opportunity_dropped_unsupported'; never provider text.
  warning_codes text[] not null default '{}' check (cardinality(warning_codes) <= 20),

  -- Usage across all attempts. Cost is an ESTIMATE computed by the application.
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  opportunities_count integer not null default 0 check (opportunities_count between 0 and 6),

  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (workspace_id, id, research_run_id, lead_id),
  unique (workspace_id, idempotency_key),
  -- NO ACTION, like migration 009: research history cannot be deleted while an analysis
  -- refers to it. Checked at the end of the statement, so deleting a whole workspace works.
  foreign key (workspace_id, research_run_id, lead_id)
    references public.research_runs (workspace_id, id, lead_id) on delete no action,
  -- Status and lifecycle columns always agree.
  check (case status
    when 'queued' then locked_by is null and locked_until is null and finished_at is null
    when 'running' then locked_by is not null and locked_until is not null
                        and started_at is not null and finished_at is null
    else finished_at is not null and locked_by is null and locked_until is null
  end),
  check (status <> 'completed' or (model is not null and input_hash is not null
                                   and input_finding_count is not null and error_code is null)),
  check (status <> 'failed' or error_code is not null),
  check (status <> 'cancelled' or error_code = 'cancelled'),
  check (status = 'completed' or opportunities_count = 0)
);

-- At most one active analysis per company.
create unique index lead_analysis_runs_active_lead_uidx
  on public.lead_analysis_runs (workspace_id, lead_id) where status in ('queued', 'running');
-- The same research analyzed twice with the same provider, model and versions is refused.
create unique index lead_analysis_runs_completed_uidx
  on public.lead_analysis_runs (workspace_id, research_run_id, provider, model, prompt_version,
                                schema_version)
  where status = 'completed';
create index lead_analysis_runs_lead_history_idx
  on public.lead_analysis_runs (workspace_id, lead_id, created_at desc);
create index lead_analysis_runs_research_idx
  on public.lead_analysis_runs (workspace_id, research_run_id, lead_id);
create index lead_analysis_runs_claim_idx
  on public.lead_analysis_runs (next_attempt_at, queued_at) where status = 'queued';
create index lead_analysis_runs_lease_idx
  on public.lead_analysis_runs (locked_until) where status = 'running';
create index lead_analysis_runs_workspace_queued_idx
  on public.lead_analysis_runs (workspace_id, queued_at desc);
create index lead_analysis_runs_requested_by_idx
  on public.lead_analysis_runs (requested_by) where requested_by is not null;

create trigger lead_analysis_runs_set_updated_at
  before update on public.lead_analysis_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. lead_opportunities
-- ---------------------------------------------------------------------------
-- The categories are fixed on purpose. Adding one is a reviewed migration, never a model
-- decision. "No opportunity" is a completed analysis with zero rows. The six categories:
--   ai_receptionist, ai_voice_agent, support_chatbot,
--   business_process_automation, custom_automation, crm

create table public.lead_opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  analysis_run_id uuid not null,
  research_run_id uuid not null,
  lead_id uuid not null,

  category text not null check (category in (
    'ai_receptionist', 'ai_voice_agent', 'support_chatbot', 'business_process_automation',
    'custom_automation', 'crm')),
  rank smallint not null check (rank between 1 and 6),
  fit_level text not null check (fit_level in (
    'strong', 'moderate', 'weak', 'insufficient_evidence')),
  -- An AI assessment, never a fact. Rendered as plain text.
  rationale text not null check (char_length(rationale) between 1 and 2000),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  -- Findings of the research run that this opportunity relies on (facts and candidates).
  supporting_finding_ids uuid[] not null default '{}'
    check (cardinality(supporting_finding_ids) <= 20),
  -- Set by the guard trigger from the cited findings; the writer cannot choose it.
  based_on_unconfirmed boolean not null default false,
  missing_information text[] not null default '{}' check (cardinality(missing_information) <= 10),
  uncertainty text not null check (char_length(uncertainty) between 1 and 1000),
  created_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (analysis_run_id, category),
  unique (analysis_run_id, rank),
  -- The analysis, research run and lead must be the ones the analysis was made for.
  foreign key (workspace_id, analysis_run_id, research_run_id, lead_id)
    references public.lead_analysis_runs (workspace_id, id, research_run_id, lead_id)
    on delete cascade,
  check (fit_level = 'insufficient_evidence' or cardinality(supporting_finding_ids) >= 1)
);

create index lead_opportunities_run_idx
  on public.lead_opportunities (workspace_id, analysis_run_id, research_run_id, lead_id);
create index lead_opportunities_lead_idx
  on public.lead_opportunities (workspace_id, lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Guards (apply to every role, including the service role)
-- ---------------------------------------------------------------------------
-- Changes issued by FK actions (deleting a workspace or user) run at trigger depth > 1 and
-- are allowed; everything else follows the rules below.

create or replace function private.analysis_run_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.locked_by is not null
       or new.locked_until is not null or new.started_at is not null
       or new.finished_at is not null or new.cancel_requested_at is not null
       or new.model is not null or new.input_hash is not null
       or new.input_finding_count is not null or new.error_code is not null
       or new.input_tokens <> 0 or new.output_tokens <> 0 or new.cost_usd <> 0
       or new.opportunities_count <> 0 or pg_catalog.cardinality(new.warning_codes) <> 0 then
      raise exception 'New analysis runs must start queued and empty' using errcode = '42501';
    end if;
    -- Only a completed research run of this company can be analyzed, and not for a
    -- suppressed company.
    if not exists (
      select 1
      from public.research_runs r
      join public.leads l on l.workspace_id = r.workspace_id and l.id = r.lead_id
      where r.id = new.research_run_id and r.workspace_id = new.workspace_id
        and r.lead_id = new.lead_id
        and r.status in ('completed', 'completed_with_warnings')
        and not l.suppressed
    ) then
      raise exception 'Only a completed research run of an active company can be analyzed'
        using errcode = '23514';
    end if;
    new.error_message := null;
    return new;
  end if;

  if pg_catalog.pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Analysis runs are permanent history and cannot be deleted'
      using errcode = '42501';
  end if;

  if old.status in ('completed', 'failed', 'cancelled') then
    raise exception 'Analysis run % is finished and cannot be changed', old.id
      using errcode = '42501';
  end if;

  if new.workspace_id <> old.workspace_id or new.lead_id <> old.lead_id
     or new.research_run_id <> old.research_run_id
     or new.idempotency_key <> old.idempotency_key
     or new.requested_by is distinct from old.requested_by
     or new.trigger_source <> old.trigger_source
     or new.provider <> old.provider
     or new.prompt_version <> old.prompt_version
     or new.schema_version <> old.schema_version
     or new.queued_at <> old.queued_at or new.created_at <> old.created_at then
    raise exception 'Analysis run identity cannot be changed' using errcode = '42501';
  end if;

  if not (
    (old.status = 'queued' and new.status in ('queued', 'running', 'cancelled'))
    -- queued -> failed exists for one reason only: a queued run whose company was suppressed
    -- is finished without ever being started (worker_claim_analysis_runs). Any other way to
    -- fail a run that never started is refused.
    -- (null-safe: a NULL error_code must make this branch false, not unknown)
    or (old.status = 'queued' and new.status = 'failed'
        and new.error_code is not distinct from 'lead_suppressed')
    or (old.status = 'running' and new.status in (
          'running', 'queued', 'completed', 'failed', 'cancelled'))
  ) then
    raise exception 'Invalid analysis run transition % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  -- A completed analysis must account for exactly the opportunities it saved.
  if new.status = 'completed' then
    select pg_catalog.count(*)::integer into v_actual
    from public.lead_opportunities o where o.analysis_run_id = new.id;
    if new.opportunities_count <> v_actual then
      raise exception 'Opportunity count does not match the saved opportunities'
        using errcode = '23514';
    end if;
    -- Backstop for the worker function: a suppressed company never gets a completed analysis.
    if exists (
      select 1 from public.leads l
      where l.workspace_id = new.workspace_id and l.id = new.lead_id and l.suppressed
    ) then
      raise exception 'A suppressed company cannot have a completed analysis'
        using errcode = '23514';
    end if;
  end if;

  -- The message always comes from the fixed table, whatever the writer supplied.
  new.error_message := private.analysis_error_message(new.error_code);
  return new;
end;
$$;

create trigger lead_analysis_runs_guard
  before insert or update or delete on public.lead_analysis_runs
  for each row execute function private.analysis_run_guard();

create or replace function private.analysis_opportunity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found integer;
  v_distinct integer;
  v_has_fact boolean;
  v_has_candidate boolean;
begin
  if tg_op = 'INSERT' then
    -- Results are written once, while their analysis is running.
    if not exists (
      select 1 from public.lead_analysis_runs a
      where a.id = new.analysis_run_id and a.workspace_id = new.workspace_id
        and a.status = 'running'
    ) then
      raise exception 'Opportunities can only be added to a running analysis'
        using errcode = '42501';
    end if;
    -- Backstop for the worker function: nothing is saved for a suppressed company.
    if exists (
      select 1 from public.leads l
      where l.workspace_id = new.workspace_id and l.id = new.lead_id and l.suppressed
    ) then
      raise exception 'Opportunities cannot be added for a suppressed company'
        using errcode = '23514';
    end if;

    -- Every cited finding must be a fact or candidate of the analyzed research run, in this
    -- workspace, and must not be personal contact information.
    select pg_catalog.count(*)::integer,
           coalesce(pg_catalog.bool_or(f.kind = 'fact'), false),
           coalesce(pg_catalog.bool_or(f.kind = 'candidate'), false)
      into v_found, v_has_fact, v_has_candidate
    from public.research_findings f
    where f.id = any (new.supporting_finding_ids)
      and f.workspace_id = new.workspace_id
      and f.run_id = new.research_run_id
      and f.kind in ('fact', 'candidate')
      and f.category not in ('contact_email', 'contact_phone', 'person');

    select pg_catalog.count(distinct u.id)::integer into v_distinct
    from pg_catalog.unnest(new.supporting_finding_ids) as u(id);

    if v_distinct <> pg_catalog.cardinality(new.supporting_finding_ids)
       or v_found <> v_distinct then
      raise exception 'An opportunity may cite only distinct facts and candidates of the analyzed research run'
        using errcode = '23514';
    end if;

    -- Confirmed means a fact. Candidates never raise an opportunity to "strong".
    if new.fit_level = 'strong' and not v_has_fact then
      raise exception 'A strong fit needs at least one confirmed fact' using errcode = '23514';
    end if;

    if exists (
      select 1 from pg_catalog.unnest(new.missing_information) as m(item)
      where m.item is null or pg_catalog.char_length(pg_catalog.btrim(m.item)) not between 1 and 300
    ) then
      raise exception 'Missing-information items must be 1 to 300 characters'
        using errcode = '23514';
    end if;

    new.based_on_unconfirmed := v_has_candidate;
    return new;
  end if;

  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception 'Analysis results are permanent and cannot be changed' using errcode = '42501';
end;
$$;

create trigger lead_opportunities_guard
  before insert or update or delete on public.lead_opportunities
  for each row execute function private.analysis_opportunity_guard();

revoke execute on function private.analysis_run_guard() from public, anon, authenticated;
revoke execute on function private.analysis_opportunity_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.lead_analysis_runs enable row level security;
alter table public.lead_opportunities enable row level security;

create policy "lead_analysis_runs_select_member" on public.lead_analysis_runs
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy "lead_opportunities_select_member" on public.lead_opportunities
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));

create policy "lead_analysis_runs_deny_anonymous" on public.lead_analysis_runs
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));
create policy "lead_opportunities_deny_anonymous" on public.lead_opportunities
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

-- Clients only read, and only the columns the dashboard needs. The worker lease, the
-- idempotency key and the input hash are never granted, so `select *` is refused by design:
-- queries must list their columns.
revoke all on public.lead_analysis_runs, public.lead_opportunities from anon, authenticated;
grant select (id, workspace_id, lead_id, research_run_id, status, trigger_source, requested_by,
              provider, model, prompt_version, schema_version, input_finding_count, attempts,
              max_attempts, next_attempt_at, cancel_requested_at, error_code, error_message,
              warning_codes, input_tokens, output_tokens, cost_usd, opportunities_count,
              queued_at, started_at, finished_at, created_at)
  on public.lead_analysis_runs to authenticated;
grant select on public.lead_opportunities to authenticated;

-- The service role gets exactly what the worker functions need. In particular it has no
-- DELETE and no TRUNCATE (TRUNCATE would bypass the row guards above).
revoke all on public.lead_analysis_runs, public.lead_opportunities from service_role;
grant select, insert, update on public.lead_analysis_runs to service_role;
grant select, insert on public.lead_opportunities to service_role;

-- ---------------------------------------------------------------------------
-- 6. Client functions (signed-in workspace members)
-- ---------------------------------------------------------------------------

-- Queues an analysis of one completed research run.
-- Outcomes: queued | duplicate_request | already_active | already_analyzed |
--           research_not_ready | suppressed | not_found | limit_reached
create or replace function public.request_lead_analysis(
  p_workspace_id uuid,
  p_research_run_id uuid,
  p_request_key text,
  p_prompt_version text,
  p_schema_version text,
  p_provider text default 'gemini'
)
returns table (lead_id uuid, run_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_max_active constant integer := 20;
  v_max_daily constant integer := 100;
  v_active integer;
  v_daily integer;
  v_research public.research_runs%rowtype;
  v_suppressed boolean;
  v_run uuid;
  v_key text;
begin
  if v_user is null or public.is_anonymous_user() then
    raise exception 'Sign in to request an analysis' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'You are not a member of this workspace' using errcode = '42501';
  end if;
  if p_request_key is null or pg_catalog.char_length(p_request_key) not between 8 and 100 then
    raise exception 'A request key is required' using errcode = '22023';
  end if;
  if p_research_run_id is null
     or p_prompt_version is null or p_prompt_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'
     or p_schema_version is null or p_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'
     or p_provider is null or p_provider !~ '^[a-z][a-z0-9_-]{0,49}$' then
    raise exception 'Invalid analysis request' using errcode = '22023';
  end if;

  -- One request per workspace at a time, so concurrent requests cannot exceed the limits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leadpilot.analysis:' || p_workspace_id::text, 0));

  lead_id := null; run_id := null;

  select r.* into v_research from public.research_runs r
  where r.id = p_research_run_id and r.workspace_id = p_workspace_id;
  if not found then
    outcome := 'not_found'; return next; return;
  end if;
  lead_id := v_research.lead_id;

  v_key := p_request_key || ':' || p_research_run_id::text;
  select a.id into v_run from public.lead_analysis_runs a
  where a.workspace_id = p_workspace_id and a.idempotency_key = v_key;
  if found then
    run_id := v_run; outcome := 'duplicate_request'; return next; return;
  end if;

  if v_research.status not in ('completed', 'completed_with_warnings') then
    outcome := 'research_not_ready'; return next; return;
  end if;

  select l.suppressed into v_suppressed from public.leads l
  where l.workspace_id = p_workspace_id and l.id = v_research.lead_id;
  if not found then
    outcome := 'not_found'; return next; return;
  end if;
  if v_suppressed then
    outcome := 'suppressed'; return next; return;
  end if;

  select a.id into v_run from public.lead_analysis_runs a
  where a.workspace_id = p_workspace_id and a.lead_id = v_research.lead_id
    and a.status in ('queued', 'running');
  if found then
    run_id := v_run; outcome := 'already_active'; return next; return;
  end if;

  select a.id into v_run from public.lead_analysis_runs a
  where a.workspace_id = p_workspace_id and a.research_run_id = p_research_run_id
    and a.provider = p_provider and a.prompt_version = p_prompt_version
    and a.schema_version = p_schema_version and a.status = 'completed'
  limit 1;
  if found then
    run_id := v_run; outcome := 'already_analyzed'; return next; return;
  end if;

  select pg_catalog.count(*) into v_active from public.lead_analysis_runs a
  where a.workspace_id = p_workspace_id and a.status in ('queued', 'running');
  select pg_catalog.count(*) into v_daily from public.lead_analysis_runs a
  where a.workspace_id = p_workspace_id and a.queued_at > pg_catalog.now() - interval '24 hours';
  if v_active >= v_max_active or v_daily >= v_max_daily then
    outcome := 'limit_reached'; return next; return;
  end if;

  insert into public.lead_analysis_runs (
    workspace_id, lead_id, research_run_id, requested_by, idempotency_key,
    provider, prompt_version, schema_version)
  values (
    p_workspace_id, v_research.lead_id, p_research_run_id, v_user, v_key,
    p_provider, p_prompt_version, p_schema_version)
  returning id into v_run;

  run_id := v_run; outcome := 'queued'; return next;
end;
$$;

-- Returns: cancelled | cancel_requested | <current finished status>
create or replace function public.cancel_analysis_run(p_run_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_run public.lead_analysis_runs%rowtype;
begin
  if v_user is null or public.is_anonymous_user() then
    raise exception 'Sign in to cancel an analysis' using errcode = '42501';
  end if;
  select * into v_run from public.lead_analysis_runs a where a.id = p_run_id for update;
  if not found or not private.is_workspace_member(v_run.workspace_id) then
    raise exception 'Analysis run not found' using errcode = 'P0002';
  end if;
  if v_run.requested_by is distinct from v_user
     and not private.has_workspace_role(v_run.workspace_id,
           array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Only the requester or an owner/admin can cancel this analysis'
      using errcode = '42501';
  end if;

  if v_run.status = 'queued' then
    update public.lead_analysis_runs a
    set status = 'cancelled', finished_at = pg_catalog.now(), error_code = 'cancelled'
    where a.id = p_run_id;
    return 'cancelled';
  elsif v_run.status = 'running' then
    if v_run.cancel_requested_at is null then
      update public.lead_analysis_runs a set cancel_requested_at = pg_catalog.now()
      where a.id = p_run_id;
    end if;
    return 'cancel_requested';
  end if;
  return v_run.status;
end;
$$;

revoke execute on function public.request_lead_analysis(uuid, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.request_lead_analysis(uuid, uuid, text, text, text, text)
  to authenticated;
revoke execute on function public.cancel_analysis_run(uuid) from public, anon;
grant execute on function public.cancel_analysis_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Worker functions (service role only)
-- ---------------------------------------------------------------------------
-- Every function that acts on a run locks it and re-checks that the run, its lead and its
-- workspace still exist and belong together, and that this worker holds the run's lease AND
-- that the lease is still valid (locked_until has not passed: the same "expired" test
-- worker_claim_analysis_runs uses, so a lease is never both expired and valid).
--
-- Worker protocol when worker_heartbeat_analysis_run returns false: call
-- worker_fail_analysis_run with an ordinary code (for example 'internal_error'). It answers
-- 'cancelled' if a person cancelled the run, 'failed' (error lead_suppressed) if the company
-- was suppressed, or raises 55000 if the lease was lost. A worker cannot report 'cancelled'
-- or 'lease_expired' itself: only the database sets those. Nothing may be sent to the
-- provider after a false heartbeat.

-- Claims up to p_limit runnable analyses (at most 2 running per workspace) and leases them.
-- Expired leases are reclaimed as a new attempt of the same run, or finished if no attempts
-- remain; no second run is ever created.
create or replace function public.worker_claim_analysis_runs(
  p_worker_id text,
  p_limit integer default 2,
  p_lease_seconds integer default 300
)
returns setof public.lead_analysis_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 10);
  v_lease interval := pg_catalog.make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900));
  v_per_workspace constant integer := 2;
  v_ids uuid[];
  v_row public.lead_analysis_runs%rowtype;
begin
  if p_worker_id is null or pg_catalog.char_length(p_worker_id) not between 1 and 100 then
    raise exception 'A worker id is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leadpilot.analysis.claim', 0));

  -- A company suppressed after its analysis was queued is never analyzed: its queued run, or
  -- a running run whose lease has expired (nobody is working on it), is finished without
  -- ever reaching the provider. A run a person asked to cancel is left to the sweep below,
  -- so cancellation keeps its meaning. A running run with a LIVE lease is left to its worker,
  -- which is told to stop by the next heartbeat.
  update public.lead_analysis_runs a
  set status = 'failed', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
      error_code = 'lead_suppressed'
  from public.leads l
  where l.workspace_id = a.workspace_id and l.id = a.lead_id and l.suppressed
    and a.cancel_requested_at is null
    and (a.status = 'queued' or (a.status = 'running' and a.locked_until < pg_catalog.now()));

  update public.lead_analysis_runs a
  set status = case when a.cancel_requested_at is not null then 'cancelled' else 'failed' end,
      finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
      error_code = case when a.cancel_requested_at is not null then 'cancelled' else 'lease_expired' end
  where a.status = 'running' and a.locked_until < pg_catalog.now()
    and (a.cancel_requested_at is not null or a.attempts >= a.max_attempts);

  with busy as (
    select a.workspace_id, pg_catalog.count(*)::integer as n
    from public.lead_analysis_runs a
    where a.status = 'running' and a.locked_until >= pg_catalog.now()
    group by a.workspace_id
  ),
  eligible as (
    select a.id, a.workspace_id, a.next_attempt_at, a.queued_at,
           pg_catalog.row_number() over (
             partition by a.workspace_id order by a.next_attempt_at, a.queued_at) as rn
    from public.lead_analysis_runs a
    join public.leads l on l.workspace_id = a.workspace_id and l.id = a.lead_id
    where not l.suppressed
      and ((a.status = 'queued' and a.next_attempt_at <= pg_catalog.now())
           or (a.status = 'running' and a.locked_until < pg_catalog.now()))
  ),
  picked as (
    select e.id from eligible e
    left join busy b on b.workspace_id = e.workspace_id
    where e.rn + coalesce(b.n, 0) <= v_per_workspace
    order by e.next_attempt_at, e.queued_at
    limit v_limit
  )
  select pg_catalog.array_agg(p.id) into v_ids from picked p;

  if v_ids is null then
    return;
  end if;

  for v_row in
    update public.lead_analysis_runs a
    set status = 'running',
        attempts = a.attempts + 1,
        locked_by = p_worker_id,
        locked_until = pg_catalog.now() + v_lease,
        started_at = coalesce(a.started_at, pg_catalog.now())
    where a.id = any (v_ids)
      and ((a.status = 'queued' and a.next_attempt_at <= pg_catalog.now())
           or (a.status = 'running' and a.locked_until < pg_catalog.now()))
    returning a.*
  loop
    return next v_row;
  end loop;
end;
$$;

-- Extends a VALID lease. false = stop work: cancel requested, company suppressed, lease
-- expired or lost, or run gone. An expired lease is never revived.
create or replace function public.worker_heartbeat_analysis_run(
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
  update public.lead_analysis_runs a
  set locked_until = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900))
  from public.leads l, public.workspaces w
  where a.id = p_run_id and a.status = 'running' and a.locked_by = p_worker_id
    and a.locked_until >= pg_catalog.now()
    and a.cancel_requested_at is null
    and l.workspace_id = a.workspace_id and l.id = a.lead_id and not l.suppressed
    and w.id = a.workspace_id;
  return found;
end;
$$;

-- Saves an analysis' complete results atomically and finishes the run.
-- p_result: { ai: {provider, model}, input_hash, input_finding_count,
--             usage: {input_tokens, output_tokens, cost_usd}, warning_codes: [],
--             opportunities: [{category, fit_level, rationale, confidence,
--                              supporting_finding_ids: [uuid], missing_information: [text],
--                              uncertainty}] }
-- Opportunities are ranked in the order given. Usage is added to the run's totals.
-- Returns: completed | cancelled | failed (the company was suppressed: results discarded)
create or replace function public.worker_complete_analysis_run(
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
  v_run public.lead_analysis_runs%rowtype;
  v_suppressed boolean;
  v_item jsonb;
  v_rank integer;
  v_count integer;
  v_warn text[];
  v_in integer;
  v_out integer;
  v_cost numeric;
begin
  select a.* into v_run
  from public.lead_analysis_runs a
  join public.leads l on l.workspace_id = a.workspace_id and l.id = a.lead_id
  join public.workspaces w on w.id = a.workspace_id
  where a.id = p_run_id
  for update of a;
  if not found then
    raise exception 'Analysis run % not found', p_run_id using errcode = 'P0002';
  end if;
  -- The lease must belong to this worker AND still be valid.
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id
     or v_run.locked_until < pg_catalog.now() then
    raise exception 'Analysis run % is not held by this worker', p_run_id using errcode = '55000';
  end if;

  if v_run.cancel_requested_at is not null then
    update public.lead_analysis_runs a
    set status = 'cancelled', finished_at = pg_catalog.now(), locked_by = null,
        locked_until = null, error_code = 'cancelled'
    where a.id = p_run_id;
    return 'cancelled';
  end if;

  -- Suppression is read under a share lock, so a suppression committed a moment earlier is
  -- seen here, and one issued now waits until this transaction ends. A suppressed company's
  -- results are DISCARDED (nothing is validated or saved); the run is finished as
  -- failed / lead_suppressed, and the usage the worker reports is kept because the
  -- provider was already called.
  select l.suppressed into v_suppressed
  from public.leads l
  where l.workspace_id = v_run.workspace_id and l.id = v_run.lead_id
  for share;
  if v_suppressed then
    begin
      v_in := greatest(coalesce((p_result #>> '{usage,input_tokens}')::integer, 0), 0);
      v_out := greatest(coalesce((p_result #>> '{usage,output_tokens}')::integer, 0), 0);
      v_cost := greatest(coalesce((p_result #>> '{usage,cost_usd}')::numeric, 0), 0);
    exception when others then
      v_in := 0; v_out := 0; v_cost := 0; -- a malformed result must not block the shutdown
    end;
    update public.lead_analysis_runs a
    set status = 'failed', finished_at = pg_catalog.now(), locked_by = null,
        locked_until = null, error_code = 'lead_suppressed',
        input_tokens = a.input_tokens + v_in, output_tokens = a.output_tokens + v_out,
        cost_usd = a.cost_usd + v_cost
    where a.id = p_run_id;
    return 'failed';
  end if;

  if pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_result -> 'opportunities') is distinct from 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_result -> 'warning_codes', '[]'::jsonb))
        is distinct from 'array' then
    raise exception 'Result must contain an opportunities array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_result -> 'opportunities') > 6 then
    raise exception 'Result exceeds the per-analysis limits' using errcode = '54000';
  end if;
  if (p_result #>> '{ai,provider}') is distinct from v_run.provider
     or nullif(p_result #>> '{ai,model}', '') is null then
    raise exception 'Result must name the requested provider and a model' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(w.c), '{}'::text[]) into v_warn
  from pg_catalog.jsonb_array_elements_text(
    coalesce(p_result -> 'warning_codes', '[]'::jsonb)) as w(c);
  -- A JSON null element becomes SQL NULL here, which a regex test alone would let through.
  if pg_catalog.cardinality(v_warn) > 20 or exists (
    select 1 from pg_catalog.unnest(v_warn) as c(code)
    where c.code is null or c.code !~ '^[a-z][a-z0-9_]{0,59}$'
  ) then
    raise exception 'Invalid warning codes' using errcode = '22023';
  end if;

  -- Usage must be a JSON object of non-negative JSON numbers (tokens: whole numbers that fit a
  -- 32-bit integer). A missing key counts as 0. Anything else is refused outright: a negative
  -- value would otherwise REDUCE the run's recorded spend, and a numeric string or a fraction
  -- would be silently converted. (The suppressed-company path above clamps instead, because
  -- it must always be able to shut a run down.)
  if p_result -> 'usage' is not null
     and pg_catalog.jsonb_typeof(p_result -> 'usage') is distinct from 'object' then
    raise exception 'Usage must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(coalesce(p_result -> 'usage', '{}'::jsonb)) as u(k, v)
    where u.k in ('input_tokens', 'output_tokens', 'cost_usd')
      -- CASE guarantees the order: the numeric cast is reached only for a real JSON number.
      and case
        when pg_catalog.jsonb_typeof(u.v) is distinct from 'number' then true
        when (u.v #>> '{}')::numeric < 0 then true
        when u.k in ('input_tokens', 'output_tokens') then
          (u.v #>> '{}')::numeric <> pg_catalog.trunc((u.v #>> '{}')::numeric)
          or (u.v #>> '{}')::numeric > 2147483647
        else false
      end
  ) then
    raise exception 'Usage values must be non-negative numbers' using errcode = '22023';
  end if;

  v_in := coalesce((p_result #>> '{usage,input_tokens}')::integer, 0);
  v_out := coalesce((p_result #>> '{usage,output_tokens}')::integer, 0);
  v_cost := coalesce((p_result #>> '{usage,cost_usd}')::numeric, 0);

  for v_item, v_rank in
    select t.e, t.n::integer
    from pg_catalog.jsonb_array_elements(p_result -> 'opportunities') with ordinality as t(e, n)
    order by t.n
  loop
    insert into public.lead_opportunities (
      workspace_id, analysis_run_id, research_run_id, lead_id, category, rank, fit_level,
      rationale, confidence, supporting_finding_ids, missing_information, uncertainty)
    values (
      v_run.workspace_id, v_run.id, v_run.research_run_id, v_run.lead_id,
      v_item ->> 'category', v_rank, v_item ->> 'fit_level', v_item ->> 'rationale',
      (v_item ->> 'confidence')::numeric,
      coalesce((select pg_catalog.array_agg(s.x::uuid order by s.n)
                from pg_catalog.jsonb_array_elements_text(
                  coalesce(v_item -> 'supporting_finding_ids', '[]'::jsonb))
                  with ordinality as s(x, n)), '{}'::uuid[]),
      coalesce((select pg_catalog.array_agg(m.x order by m.n)
                from pg_catalog.jsonb_array_elements_text(
                  coalesce(v_item -> 'missing_information', '[]'::jsonb))
                  with ordinality as m(x, n)), '{}'::text[]),
      v_item ->> 'uncertainty');
  end loop;

  select pg_catalog.count(*)::integer into v_count
  from public.lead_opportunities o where o.analysis_run_id = p_run_id;

  update public.lead_analysis_runs a
  set status = 'completed',
      finished_at = pg_catalog.now(),
      locked_by = null,
      locked_until = null,
      error_code = null,
      model = p_result #>> '{ai,model}',
      input_hash = p_result ->> 'input_hash',
      input_finding_count = (p_result ->> 'input_finding_count')::integer,
      warning_codes = v_warn,
      input_tokens = a.input_tokens + v_in,
      output_tokens = a.output_tokens + v_out,
      cost_usd = a.cost_usd + v_cost,
      opportunities_count = v_count
  where a.id = p_run_id;

  return 'completed';
end;
$$;

-- Records a failed attempt from a fixed error code (anything else is rejected). Transient
-- codes are retried with exponential backoff while attempts remain; the rest fail the run.
-- Tokens and cost spent on the failed attempt are added to the run's totals.
-- Precedence: a person's cancellation, then suppression of the company (finished as failed /
-- lead_suppressed, never retried), then the reported code.
-- Returns: queued (will retry) | failed | cancelled
create or replace function public.worker_fail_analysis_run(
  p_run_id uuid,
  p_worker_id text,
  p_error_code text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cost_usd numeric default 0
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.lead_analysis_runs%rowtype;
  v_suppressed boolean;
  v_delay interval;
  v_in integer := greatest(coalesce(p_input_tokens, 0), 0);
  v_out integer := greatest(coalesce(p_output_tokens, 0), 0);
  v_cost numeric := greatest(coalesce(p_cost_usd, 0), 0);
begin
  -- The same list as the table's check constraint. Listed here (not looked up in `private`)
  -- because the service role has no access to that schema.
  -- 'cancelled' and 'lease_expired' are deliberately NOT accepted from a worker: they are set
  -- only by the database (cancel function, claim sweep, cancellation precedence below).
  if p_error_code is null or p_error_code not in (
    'provider_not_configured', 'provider_unavailable', 'provider_rate_limited',
    'provider_timeout', 'provider_rejected', 'invalid_output', 'evidence_check_failed',
    'input_too_large', 'no_usable_findings', 'budget_exceeded', 'unsupported_request',
    'research_not_usable', 'lead_not_found', 'lead_suppressed', 'internal_error') then
    raise exception 'Unknown or database-only analysis error code' using errcode = '22023';
  end if;

  select a.* into v_run
  from public.lead_analysis_runs a
  join public.leads l on l.workspace_id = a.workspace_id and l.id = a.lead_id
  join public.workspaces w on w.id = a.workspace_id
  where a.id = p_run_id
  for update of a;
  if not found then
    raise exception 'Analysis run % not found', p_run_id using errcode = 'P0002';
  end if;
  -- The lease must belong to this worker AND still be valid.
  if v_run.status <> 'running' or v_run.locked_by is distinct from p_worker_id
     or v_run.locked_until < pg_catalog.now() then
    raise exception 'Analysis run % is not held by this worker', p_run_id using errcode = '55000';
  end if;

  select l.suppressed into v_suppressed
  from public.leads l
  where l.workspace_id = v_run.workspace_id and l.id = v_run.lead_id
  for share;

  if v_run.cancel_requested_at is not null then
    update public.lead_analysis_runs a
    set status = 'cancelled', finished_at = pg_catalog.now(), locked_by = null,
        locked_until = null, error_code = 'cancelled',
        input_tokens = a.input_tokens + v_in, output_tokens = a.output_tokens + v_out,
        cost_usd = a.cost_usd + v_cost
    where a.id = p_run_id;
    return 'cancelled';
  elsif v_suppressed then
    -- A suppressed company is never retried and never keeps a different reason: suppression
    -- supersedes the code the worker reported (its spend is still recorded).
    update public.lead_analysis_runs a
    set status = 'failed', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
        error_code = 'lead_suppressed',
        input_tokens = a.input_tokens + v_in, output_tokens = a.output_tokens + v_out,
        cost_usd = a.cost_usd + v_cost
    where a.id = p_run_id;
    return 'failed';
  elsif p_error_code in ('provider_unavailable', 'provider_rate_limited', 'provider_timeout',
                         'internal_error')
        and v_run.attempts < v_run.max_attempts then
    v_delay := pg_catalog.make_interval(mins => least(60, (2 ^ v_run.attempts)::integer));
    update public.lead_analysis_runs a
    set status = 'queued', locked_by = null, locked_until = null,
        next_attempt_at = pg_catalog.now() + v_delay, error_code = p_error_code,
        input_tokens = a.input_tokens + v_in, output_tokens = a.output_tokens + v_out,
        cost_usd = a.cost_usd + v_cost
    where a.id = p_run_id;
    return 'queued';
  end if;

  update public.lead_analysis_runs a
  set status = 'failed', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
      error_code = p_error_code,
      input_tokens = a.input_tokens + v_in, output_tokens = a.output_tokens + v_out,
      cost_usd = a.cost_usd + v_cost
  where a.id = p_run_id;
  return 'failed';
end;
$$;

revoke execute on function public.worker_claim_analysis_runs(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.worker_heartbeat_analysis_run(uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.worker_complete_analysis_run(uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.worker_fail_analysis_run(uuid, text, text, integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.worker_claim_analysis_runs(text, integer, integer)
  to service_role;
grant execute on function public.worker_heartbeat_analysis_run(uuid, text, integer)
  to service_role;
grant execute on function public.worker_complete_analysis_run(uuid, text, jsonb)
  to service_role;
grant execute on function public.worker_fail_analysis_run(uuid, text, text, integer, integer, numeric)
  to service_role;
