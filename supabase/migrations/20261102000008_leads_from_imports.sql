-- LeadPilot AI — lead database fed by Excel/CSV imports
-- Until now accepted import rows stayed in import_rows only (status 'valid');
-- there was no leads table, so the Lead Database and lead metrics had no source.
--
-- 1. public.leads (spec §16), workspace-scoped, read-only to clients via RLS.
-- 2. import_rows.lead_id links each accepted row to the lead it created or matched.
-- 3. private.commit_import_leads(): turns a finished import's accepted rows into
--    leads, matching existing leads with the same four rules as in-file duplicate
--    detection (domain, email, phone, or company + city + state; never name alone),
--    so re-importing the same data links to existing leads instead of duplicating.
--    Runs automatically when an import reaches completed/completed_with_errors.
-- 4. public.lead_overview_metrics(): Overview lead KPIs, SECURITY INVOKER (RLS).
-- 5. Backfill: commits imports that were already completed before this migration.
--
-- Imported leads start unverified and not scored: nothing here marks a lead as
-- verified or qualified.

-- ---------------------------------------------------------------------------
-- 1. leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  company_name text not null check (char_length(company_name) between 1 and 255),
  website text check (char_length(website) <= 2000),
  business_email text check (char_length(business_email) <= 320),
  phone text check (char_length(phone) <= 100),
  address text check (char_length(address) <= 500),
  city text check (char_length(city) <= 120),
  state text check (char_length(state) <= 120),
  postal_code text check (char_length(postal_code) <= 20),
  country text check (char_length(country) <= 120),
  services text check (char_length(services) <= 2000),
  decision_maker_name text check (char_length(decision_maker_name) <= 255),
  decision_maker_title text check (char_length(decision_maker_title) <= 255),
  notes text check (char_length(notes) <= 5000),
  source_url text check (char_length(source_url) <= 2000),
  source_name text check (char_length(source_name) <= 255),
  source_import_id uuid references public.excel_imports (id) on delete set null,

  -- Matching keys, always derived by trigger from the columns above.
  normalized_company_name text,
  normalized_domain text,
  normalized_email text,
  normalized_phone text,
  normalized_city text,
  normalized_state text,

  lead_score integer check (lead_score between 0 and 100),
  lead_score_reason text check (char_length(lead_score_reason) <= 2000),
  qualification_status text not null default 'not_scored'
    check (qualification_status in ('not_scored', 'qualified', 'not_qualified')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'invalid', 'risky')),
  suppressed boolean not null default false,

  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, id)
);

create index leads_workspace_discovered_idx on public.leads (workspace_id, discovered_at desc);
create index leads_workspace_company_idx on public.leads (workspace_id, normalized_company_name);
create index leads_workspace_domain_idx
  on public.leads (workspace_id, normalized_domain) where normalized_domain is not null;
create index leads_workspace_email_idx
  on public.leads (workspace_id, normalized_email) where normalized_email is not null;
create index leads_workspace_phone_idx
  on public.leads (workspace_id, normalized_phone) where normalized_phone is not null;
create index leads_workspace_location_idx
  on public.leads (workspace_id, normalized_company_name, normalized_city, normalized_state)
  where normalized_city is not null and normalized_state is not null;
create index leads_source_import_idx
  on public.leads (source_import_id) where source_import_id is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create or replace function private.lead_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.normalized_company_name := pg_catalog.left(private.normalize_text(new.company_name), 255);
  new.normalized_city := pg_catalog.left(private.normalize_text(new.city), 120);
  new.normalized_state := pg_catalog.left(private.normalize_us_state(new.state), 120);
  new.normalized_domain := private.normalize_domain(new.website);
  new.normalized_email := private.normalize_email(new.business_email);
  new.normalized_phone := private.normalize_phone(new.phone);
  return new;
end;
$$;

create trigger leads_normalize
  before insert or update of company_name, website, business_email, phone, city, state
  on public.leads
  for each row execute function private.lead_normalize();

revoke execute on function private.lead_normalize() from public, anon, authenticated;

alter table public.leads enable row level security;

create policy "leads_select_member" on public.leads
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "leads_deny_anonymous" on public.leads
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

-- Clients read only; leads are written by commit_import_leads().
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;

-- ---------------------------------------------------------------------------
-- 2. import_rows.lead_id
-- ---------------------------------------------------------------------------

alter table public.import_rows add column lead_id uuid;
alter table public.import_rows
  add constraint import_rows_lead_fkey
  foreign key (workspace_id, lead_id) references public.leads (workspace_id, id)
  on delete set null (lead_id);
-- Covers the composite FK (advisor lint 0001) and lead-deletion lookups.
create index import_rows_workspace_lead_idx
  on public.import_rows (workspace_id, lead_id) where lead_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Commit accepted rows to leads
-- ---------------------------------------------------------------------------

create or replace function private.commit_import_leads(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_handling text;
  v_file text;
  v_found_at timestamptz;
  v_new integer := 0;
  v_updated integer := 0;
  v_failed integer := 0;
  v_lead uuid;
  r record;
  m jsonb;
begin
  select i.workspace_id, i.duplicate_handling, i.file_name, coalesce(i.completed_at, pg_catalog.now())
    into v_workspace, v_handling, v_file, v_found_at
  from public.excel_imports i
  where i.id = p_import_id and i.status in ('completed', 'completed_with_errors')
  for update;
  if v_workspace is null or v_handling = 'staging_only' then
    return;
  end if;

  -- One committer per workspace at a time, so concurrent imports can't both
  -- create the same company.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leadpilot.leads:' || v_workspace::text, 0)
  );

  for r in
    select ir.id, ir.mapped_data, ir.normalized_domain, ir.normalized_email, ir.normalized_phone,
           ir.normalized_company_name, ir.normalized_city, ir.normalized_state
    from public.import_rows ir
    join public.excel_import_sheets s on s.id = ir.sheet_id
    where ir.import_id = p_import_id
      and s.selected
      and ir.status = 'valid'
      and ir.lead_id is null
    order by s.sheet_index, ir.row_number
  loop
    m := r.mapped_data;

    -- A lead needs a company name. The app never stages such rows as valid, but if
    -- one arrives it is marked failed with a reason instead of aborting the commit.
    if r.normalized_company_name is null then
      update public.import_rows
      set status = 'failed', error_message = 'Missing company name; not added to leads.'
      where id = r.id;
      v_failed := v_failed + 1;
      continue;
    end if;

    select l.id into v_lead
    from public.leads l
    where l.workspace_id = v_workspace
      and (
        (r.normalized_domain is not null and l.normalized_domain = r.normalized_domain)
        or (r.normalized_email is not null and l.normalized_email = r.normalized_email)
        or (r.normalized_phone is not null and l.normalized_phone = r.normalized_phone)
        or (r.normalized_company_name is not null and r.normalized_city is not null
            and r.normalized_state is not null
            and l.normalized_company_name = r.normalized_company_name
            and l.normalized_city = r.normalized_city
            and l.normalized_state = r.normalized_state)
      )
    order by l.discovered_at, l.id
    limit 1;

    if v_lead is null then
      insert into public.leads (
        workspace_id, company_name, website, business_email, phone, address, city, state,
        postal_code, country, services, decision_maker_name, decision_maker_title, notes,
        source_url, source_name, source_import_id, discovered_at
      ) values (
        v_workspace,
        pg_catalog.left(m ->> 'company_name', 255),
        pg_catalog.left(m ->> 'website', 2000),
        pg_catalog.left(m ->> 'business_email', 320),
        pg_catalog.left(m ->> 'phone', 100),
        pg_catalog.left(m ->> 'address', 500),
        pg_catalog.left(m ->> 'city', 120),
        pg_catalog.left(m ->> 'state', 120),
        pg_catalog.left(m ->> 'postal_code', 20),
        pg_catalog.left(m ->> 'country', 120),
        pg_catalog.left(m ->> 'services', 2000),
        pg_catalog.left(coalesce(m ->> 'contact_full_name',
          nullif(pg_catalog.btrim(coalesce(m ->> 'contact_first_name', '') || ' ' || coalesce(m ->> 'contact_last_name', '')), '')), 255),
        pg_catalog.left(m ->> 'job_title', 255),
        pg_catalog.left(m ->> 'notes', 5000),
        pg_catalog.left(m ->> 'source_url', 2000),
        pg_catalog.left(coalesce(m ->> 'source_name', 'Excel import: ' || v_file), 255),
        p_import_id,
        v_found_at
      )
      returning id into v_lead;
      v_new := v_new + 1;
    elsif v_handling = 'update_existing' then
      -- Fill only empty fields; never overwrite an existing value.
      update public.leads l set
        website = coalesce(l.website, pg_catalog.left(m ->> 'website', 2000)),
        business_email = coalesce(l.business_email, pg_catalog.left(m ->> 'business_email', 320)),
        phone = coalesce(l.phone, pg_catalog.left(m ->> 'phone', 100)),
        address = coalesce(l.address, pg_catalog.left(m ->> 'address', 500)),
        city = coalesce(l.city, pg_catalog.left(m ->> 'city', 120)),
        state = coalesce(l.state, pg_catalog.left(m ->> 'state', 120)),
        postal_code = coalesce(l.postal_code, pg_catalog.left(m ->> 'postal_code', 20)),
        country = coalesce(l.country, pg_catalog.left(m ->> 'country', 120)),
        services = coalesce(l.services, pg_catalog.left(m ->> 'services', 2000))
      where l.id = v_lead
        and (l.website is null and m ? 'website' or l.business_email is null and m ? 'business_email'
             or l.phone is null and m ? 'phone' or l.address is null and m ? 'address'
             or l.city is null and m ? 'city' or l.state is null and m ? 'state'
             or l.postal_code is null and m ? 'postal_code' or l.country is null and m ? 'country'
             or l.services is null and m ? 'services');
      if found then
        v_updated := v_updated + 1;
      end if;
    end if;

    update public.import_rows set status = 'imported', lead_id = v_lead where id = r.id;
  end loop;

  perform private.refresh_excel_import_counts(p_import_id);
  update public.excel_imports
  set new_records = new_records + v_new,
      updated_records = updated_records + v_updated,
      -- The status was settled before leads were committed; record any rows that
      -- couldn't become leads (also counted in failed_rows) so they're visible.
      error_summary = case
        when v_failed > 0 then pg_catalog.left(coalesce(error_summary || ' ', '')
          || v_failed || ' row(s) could not be added to leads (missing company name).', 2000)
        else error_summary
      end
  where id = p_import_id;
end;
$$;

revoke execute on function private.commit_import_leads(uuid) from public, anon, authenticated;

create or replace function private.excel_import_commit_on_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.commit_import_leads(new.id);
  return null;
end;
$$;

revoke execute on function private.excel_import_commit_on_complete() from public, anon, authenticated;

-- Fires only on the transition into a finished state, so the counter update
-- inside commit_import_leads() can't re-trigger it.
create trigger excel_imports_commit_leads
  after update of status on public.excel_imports
  for each row
  when (new.status in ('completed', 'completed_with_errors')
        and old.status is distinct from new.status)
  execute function private.excel_import_commit_on_complete();

-- ---------------------------------------------------------------------------
-- 4. Overview lead metrics (caller's RLS applies)
-- ---------------------------------------------------------------------------
-- unique_companies: one identity per website domain; without a domain, per
-- company + city + state; otherwise the lead itself (never merged by name alone).
-- new_leads: leads first discovered in [p_from, p_to).

create or replace function public.lead_overview_metrics(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  total_leads bigint,
  unique_companies bigint,
  new_leads bigint,
  verified_contacts bigint,
  qualified_leads bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pg_catalog.count(*),
    pg_catalog.count(distinct coalesce(
      'd:' || l.normalized_domain,
      case when l.normalized_city is not null and l.normalized_state is not null
           then 'c:' || l.normalized_company_name || '|' || l.normalized_city || '|' || l.normalized_state end,
      'l:' || l.id::text
    )),
    pg_catalog.count(*) filter (where l.discovered_at >= p_from and l.discovered_at < p_to),
    pg_catalog.count(*) filter (where l.verification_status = 'verified'),
    pg_catalog.count(*) filter (where l.qualification_status = 'qualified')
  from public.leads l
  where l.workspace_id = p_workspace_id
    and not l.suppressed;
$$;

revoke execute on function public.lead_overview_metrics(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.lead_overview_metrics(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill imports completed before this migration (idempotent)
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.excel_imports
    where status in ('completed', 'completed_with_errors')
    order by completed_at, created_at
  loop
    perform private.commit_import_leads(v_id);
  end loop;
end;
$$;
