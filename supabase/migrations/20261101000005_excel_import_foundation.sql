-- LeadPilot AI — Excel/CSV import foundation
-- 1. excel_imports: one row per uploaded file (import history, status, counters).
-- 2. excel_import_sheets: worksheets detected in a workbook (one for CSV).
-- 3. import_rows: every data row (header excluded) with raw + mapped values,
--    normalized duplicate keys (computed in the database), row status and issues.
-- 4. Server-side functions that detect in-file duplicates and compute counters,
--    so clients can never write their own totals.
-- Deletes: uploader deletes own imports; owners/admins delete any in their
-- workspace. The stored file must be deleted first (guard trigger). There is no
-- audit_log table yet; deletion auditing is added with it.
-- 5. Private `imports` storage bucket; objects at {workspace_id}/{import_id}/{file}.
-- 6. RLS on every table and storage policies tied to workspace membership.
-- Leads are not created here: rows link to leads in a later migration.
-- No data is inserted except the bucket definition.

-- ---------------------------------------------------------------------------
-- 1. excel_imports
-- ---------------------------------------------------------------------------

create table public.excel_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,

  -- File identity. The file itself lives in storage; no credentials are stored here.
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_type text not null check (file_type in ('xlsx', 'xls', 'csv')),
  mime_type text check (char_length(mime_type) <= 127),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text unique,

  -- Client-generated key: retrying "create import" returns the same row.
  idempotency_key uuid not null,

  status text not null default 'uploading' check (status in (
    'uploading', 'uploaded', 'parsed', 'importing',
    'completed', 'completed_with_errors', 'failed', 'cancelled'
  )),
  duplicate_handling text not null default 'skip_duplicates' check (duplicate_handling in (
    'add_new_only', 'update_existing', 'skip_duplicates', 'staging_only'
  )),
  column_mapping jsonb not null default '{}'::jsonb
    check (jsonb_typeof(column_mapping) = 'object' and pg_column_size(column_mapping) <= 16384),

  -- Set by trigger: most recent earlier import of the same bytes in this workspace.
  duplicate_of_import_id uuid references public.excel_imports (id) on delete set null,

  -- Counters: written only by refresh/complete functions below.
  worksheet_count integer not null default 0 check (worksheet_count >= 0),
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  new_records integer not null default 0 check (new_records >= 0),
  updated_records integer not null default 0 check (updated_records >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),

  error_summary text check (char_length(error_summary) <= 2000),
  started_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, idempotency_key),
  -- Target for composite FKs so child rows can't point across workspaces.
  unique (workspace_id, id),
  -- Objects must live under this workspace and this import.
  check (
    storage_path is null
    or (
      storage_path like workspace_id::text || '/' || id::text || '/%'
      and storage_path !~ '(^|/)\.\.?(/|$)'
      and char_length(storage_path) <= 400
    )
  )
);

create index excel_imports_workspace_created_idx
  on public.excel_imports (workspace_id, created_at desc);
create index excel_imports_workspace_sha_idx
  on public.excel_imports (workspace_id, file_sha256);
create index excel_imports_workspace_status_idx
  on public.excel_imports (workspace_id, status);
create index excel_imports_created_by_idx
  on public.excel_imports (created_by);
create index excel_imports_duplicate_of_idx
  on public.excel_imports (duplicate_of_import_id) where duplicate_of_import_id is not null;

create trigger excel_imports_set_updated_at
  before update on public.excel_imports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. excel_import_sheets
-- ---------------------------------------------------------------------------

create table public.excel_import_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  import_id uuid not null,
  sheet_index integer not null check (sheet_index between 0 and 999),
  sheet_name text not null check (char_length(sheet_name) between 1 and 255),
  header_row_number integer not null default 1 check (header_row_number >= 1),
  column_headers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(column_headers) = 'array' and pg_column_size(column_headers) <= 16384),
  selected boolean not null default true,

  rows_read integer not null default 0 check (rows_read >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (workspace_id, import_id)
    references public.excel_imports (workspace_id, id) on delete cascade,
  unique (import_id, sheet_index),   -- idempotent re-parse
  unique (import_id, id)             -- composite FK target for rows
);

create index excel_import_sheets_workspace_idx on public.excel_import_sheets (workspace_id);

create trigger excel_import_sheets_set_updated_at
  before update on public.excel_import_sheets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. import_rows
-- ---------------------------------------------------------------------------

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  import_id uuid not null,
  sheet_id uuid not null,
  -- Spreadsheet row number as shown in Excel (header row is never stored).
  row_number integer not null check (row_number >= 1),

  -- Original cell values keyed by source column, kept so nothing is silently lost.
  raw_data jsonb not null
    check (jsonb_typeof(raw_data) = 'object' and pg_column_size(raw_data) <= 32768),
  -- Values mapped to canonical fields.
  mapped_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(mapped_data) = 'object' and pg_column_size(mapped_data) <= 32768),

  -- Normalized duplicate keys. Always derived from mapped_data by the
  -- import_rows_normalize trigger; clients cannot write them.
  normalized_company_name text check (char_length(normalized_company_name) <= 255),
  normalized_city text check (char_length(normalized_city) <= 120),
  normalized_state text check (char_length(normalized_state) <= 120),
  normalized_domain text check (char_length(normalized_domain) <= 253),
  normalized_email text check (char_length(normalized_email) <= 320),
  normalized_phone text check (normalized_phone ~ '^\+[1-9][0-9]{7,14}$'),

  status text not null default 'pending' check (status in (
    'pending', 'valid', 'invalid', 'duplicate', 'imported', 'skipped', 'failed'
  )),
  issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(issues) = 'array' and pg_column_size(issues) <= 8192),
  duplicate_of_row_id uuid references public.import_rows (id) on delete set null,
  error_message text check (char_length(error_message) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (workspace_id, import_id)
    references public.excel_imports (workspace_id, id) on delete cascade,
  foreign key (import_id, sheet_id)
    references public.excel_import_sheets (import_id, id) on delete cascade,
  unique (sheet_id, row_number)      -- retried batch inserts can't double-count
);

create index import_rows_workspace_idx on public.import_rows (workspace_id);
create index import_rows_import_status_idx on public.import_rows (import_id, status);
create index import_rows_duplicate_of_idx
  on public.import_rows (duplicate_of_row_id) where duplicate_of_row_id is not null;
create index import_rows_workspace_domain_idx
  on public.import_rows (workspace_id, normalized_domain) where normalized_domain is not null;
create index import_rows_workspace_email_idx
  on public.import_rows (workspace_id, normalized_email) where normalized_email is not null;
create index import_rows_workspace_phone_idx
  on public.import_rows (workspace_id, normalized_phone) where normalized_phone is not null;
create index import_rows_workspace_company_idx
  on public.import_rows (workspace_id, normalized_company_name, normalized_city, normalized_state)
  where normalized_company_name is not null;

create trigger import_rows_set_updated_at
  before update on public.import_rows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3b. Normalization (single source of truth for duplicate keys)
-- ---------------------------------------------------------------------------
-- Canonical mapped_data keys used here: company_name, website, business_email,
-- phone, city, state. raw_data is never modified.

-- Case-folded, trimmed, inner whitespace (incl. NBSP) collapsed; '' -> null.
create or replace function private.normalize_text(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.regexp_replace(value, '[\s  -​　]+', ' ', 'g')
  )), '');
$$;

-- "https://User@WWW.Example.com:443/path?q#x" -> "example.com". Subdomains other
-- than a leading www. are kept (no registrable-domain guessing).
create or replace function private.normalize_domain(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := private.normalize_text(value);
begin
  if d is null then
    return null;
  end if;
  d := pg_catalog.regexp_replace(d, '^[a-z][a-z0-9+.-]*://', '');   -- scheme
  d := pg_catalog.regexp_replace(d, '^//', '');
  d := pg_catalog.regexp_replace(d, '[/?#\s].*$', '');               -- path, query, fragment
  d := pg_catalog.regexp_replace(d, '^.*@', '');                     -- user-info
  d := pg_catalog.regexp_replace(d, ':[0-9]*$', '');                 -- port
  d := pg_catalog.regexp_replace(d, '\.+$', '');                     -- trailing dot
  d := pg_catalog.regexp_replace(d, '^www\.', '');
  if char_length(d) between 4 and 253
     and d ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$' then
    return d;
  end if;
  return null;
end;
$$;

create or replace function private.normalize_email(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when e ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
         and char_length(e) <= 320
    then e
  end
  from (
    select pg_catalog.regexp_replace(private.normalize_text(value), '^mailto:', '') as e
  ) x;
$$;

-- E.164. Bare 10-digit and 1+10-digit numbers are treated as US/NANP;
-- '+' numbers are kept as given; trailing extensions are dropped.
create or replace function private.normalize_phone(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := private.normalize_text(value);
  digits text;
begin
  if s is null then
    return null;
  end if;
  s := pg_catalog.regexp_replace(s, '\s*(ext\.?|extension|x|#)\s*[0-9]+\s*$', '');
  digits := pg_catalog.regexp_replace(s, '[^0-9]', '', 'g');
  if s like '+%' then
    if digits ~ '^[1-9][0-9]{7,14}$' then
      return '+' || digits;
    end if;
    return null;
  end if;
  if digits ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
    return '+1' || digits;
  end if;
  if digits ~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then
    return '+' || digits;
  end if;
  return null;
end;
$$;

-- US states, DC and territories by name or code -> two-letter code; anything
-- else is returned normalized (upper-case) so non-US values still compare exactly.
create or replace function private.normalize_us_state(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select m.code from (values
      ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
      ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('district of columbia','DC'),
      ('washington dc','DC'),('washington d.c.','DC'),('florida','FL'),('georgia','GA'),
      ('hawaii','HI'),('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),
      ('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
      ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),
      ('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
      ('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),
      ('north carolina','NC'),('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),
      ('oregon','OR'),('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),
      ('south dakota','SD'),('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),
      ('virginia','VA'),('washington','WA'),('west virginia','WV'),('wisconsin','WI'),
      ('wyoming','WY'),('puerto rico','PR'),('guam','GU'),('u.s. virgin islands','VI'),
      ('us virgin islands','VI'),('american samoa','AS'),('northern mariana islands','MP')
    ) as m(name, code)
    where m.name = n),
    case when n ~ '^[a-z]{2}\.?$' then pg_catalog.upper(pg_catalog.left(n, 2)) end,
    pg_catalog.upper(n)
  )
  from (select private.normalize_text(value) as n) x
  where n is not null;
$$;

create or replace function private.import_row_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.normalized_company_name := pg_catalog.left(private.normalize_text(new.mapped_data ->> 'company_name'), 255);
  new.normalized_city := pg_catalog.left(private.normalize_text(new.mapped_data ->> 'city'), 120);
  new.normalized_state := pg_catalog.left(private.normalize_us_state(new.mapped_data ->> 'state'), 120);
  new.normalized_domain := private.normalize_domain(new.mapped_data ->> 'website');
  new.normalized_email := private.normalize_email(new.mapped_data ->> 'business_email');
  new.normalized_phone := private.normalize_phone(new.mapped_data ->> 'phone');
  return new;
end;
$$;

create trigger import_rows_normalize
  before insert or update on public.import_rows
  for each row execute function private.import_row_normalize();

revoke execute on function private.normalize_text(text) from public, anon, authenticated;
revoke execute on function private.normalize_domain(text) from public, anon, authenticated;
revoke execute on function private.normalize_email(text) from public, anon, authenticated;
revoke execute on function private.normalize_phone(text) from public, anon, authenticated;
revoke execute on function private.normalize_us_state(text) from public, anon, authenticated;
revoke execute on function private.import_row_normalize() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Integrity triggers
-- ---------------------------------------------------------------------------
-- API clients connect as `authenticated`; the SECURITY DEFINER functions below
-- run as their owner, so `current_user` tells the two apart. These guards are
-- therefore SECURITY INVOKER (a definer trigger would always see its owner), and
-- their lookups run under the caller's RLS.

create or replace function private.excel_import_guard()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller's role
set search_path = ''
as $$
declare
  is_client boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if is_client and new.status <> 'uploading' then
      raise exception 'New imports must start in uploading status' using errcode = '22023';
    end if;
    new.duplicate_of_import_id := (
      select i.id from public.excel_imports i
      where i.workspace_id = new.workspace_id
        and i.file_sha256 = new.file_sha256
        and i.status in ('completed', 'completed_with_errors')
      order by i.completed_at desc nulls last
      limit 1
    );
    return new;
  end if;

  -- UPDATE: identity columns are also blocked by column grants; this covers definers too.
  if new.workspace_id <> old.workspace_id or new.file_sha256 <> old.file_sha256
     or new.idempotency_key <> old.idempotency_key
     or new.created_by is distinct from old.created_by then
    raise exception 'Import identity cannot change' using errcode = '22023';
  end if;
  if old.storage_path is not null and new.storage_path is distinct from old.storage_path then
    raise exception 'storage_path cannot change once set' using errcode = '22023';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'uploading' and new.status in ('uploaded', 'failed', 'cancelled'))
      or (old.status = 'uploaded' and new.status in ('parsed', 'failed', 'cancelled'))
      or (old.status = 'parsed' and new.status in ('importing', 'failed', 'cancelled'))
      or (old.status = 'importing' and new.status in ('completed', 'completed_with_errors', 'failed'))
      or (old.status = 'failed' and new.status in ('uploaded', 'parsed', 'cancelled'))
    ) then
      raise exception 'Invalid import status change: % -> %', old.status, new.status
        using errcode = '22023';
    end if;
    if is_client and new.status in ('completed', 'completed_with_errors') then
      raise exception 'Use complete_excel_import() to finish an import' using errcode = '42501';
    end if;
    if new.status = 'importing' then
      new.started_at := coalesce(old.started_at, now());
    end if;
    if new.status in ('completed', 'completed_with_errors', 'failed', 'cancelled') then
      new.completed_at := now();
    elsif old.status = 'failed' then
      new.completed_at := null;  -- retry
    end if;
  end if;

  if is_client and old.status in ('completed', 'completed_with_errors', 'cancelled')
     and (new.column_mapping <> old.column_mapping
          or new.duplicate_handling <> old.duplicate_handling
          or new.error_summary is distinct from old.error_summary) then
    raise exception 'Finished imports are read-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger excel_imports_guard
  before insert or update on public.excel_imports
  for each row execute function private.excel_import_guard();

-- Sheets and rows: client writes only while the import is still being staged.
create or replace function private.excel_import_child_guard()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller's role
set search_path = ''
as $$
declare
  parent_status text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select i.status into parent_status
  from public.excel_imports i
  where i.id = new.import_id
  for share;

  if parent_status is null or parent_status not in ('uploaded', 'parsed', 'importing', 'failed') then
    raise exception 'Import is not accepting changes (status %)', coalesce(parent_status, 'missing')
      using errcode = '42501';
  end if;

  -- 'duplicate' and 'imported' are server-managed: clients can't set or clear
  -- them, but may still edit other fields of such rows.
  -- (Nested IF: sheets have no status column, and PL/pgSQL doesn't short-circuit.)
  if tg_table_name = 'import_rows' then
    if (tg_op = 'INSERT' and new.status in ('duplicate', 'imported'))
       or (tg_op = 'UPDATE' and new.status is distinct from old.status
           and (new.status in ('duplicate', 'imported') or old.status in ('duplicate', 'imported')))
    then
      raise exception 'Row status duplicate/imported is set by the server' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger excel_import_sheets_guard
  before insert or update on public.excel_import_sheets
  for each row execute function private.excel_import_child_guard();

create trigger import_rows_guard
  before insert or update on public.import_rows
  for each row execute function private.excel_import_child_guard();

-- Deleting an import whose file is still stored would leave an object nobody can
-- reach (storage policies resolve access through the import row). The app must
-- delete the object first, then the row. Whole-workspace deletion is allowed to
-- cascade; its objects are left unreachable and are removed by server cleanup.
create or replace function private.excel_import_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.storage_path is not null
     and exists (
       select 1 from storage.objects o
       where o.bucket_id = 'imports' and o.name = old.storage_path
     )
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
  then
    raise exception 'Delete the uploaded file before deleting the import'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger excel_imports_delete_guard
  before delete on public.excel_imports
  for each row execute function private.excel_import_delete_guard();

revoke execute on function private.excel_import_guard() from public, anon, authenticated;
revoke execute on function private.excel_import_child_guard() from public, anon, authenticated;
revoke execute on function private.excel_import_delete_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Duplicate detection and counters (server-side only)
-- ---------------------------------------------------------------------------
-- A row is a duplicate when an earlier row (by sheet order, then row number) in
-- the same import shares any of: normalized website domain, business email,
-- phone, or the exact normalized company name together with city AND state.
-- Company name alone never marks a duplicate, and there is no fuzzy matching
-- (spec §8). Each duplicate row is counted once, however many keys match.
-- Matching against existing leads is added with the leads table.

create or replace function private.refresh_excel_import_counts(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with ordered as (
    select r.id, r.status, r.normalized_domain d, r.normalized_email e, r.normalized_phone p,
           case
             when r.normalized_company_name is not null and r.normalized_city is not null
                  and r.normalized_state is not null
             then pg_catalog.jsonb_build_array(r.normalized_company_name, r.normalized_city, r.normalized_state)
           end as cl,
           row_number() over (order by s.sheet_index, r.row_number) as pos
    from public.import_rows r
    join public.excel_import_sheets s on s.id = r.sheet_id
    where r.import_id = p_import_id
      and s.selected
      and r.status in ('valid', 'duplicate', 'imported')
  ),
  firsts as (
    select id, pos, status,
           least(
             case when d is not null then first_value(pos) over (partition by d order by pos) end,
             case when e is not null then first_value(pos) over (partition by e order by pos) end,
             case when p is not null then first_value(pos) over (partition by p order by pos) end,
             case when cl is not null then first_value(pos) over (partition by cl order by pos) end
           ) as first_pos
    from ordered
  )
  update public.import_rows r
  set status = case when f.first_pos < f.pos then 'duplicate' else 'valid' end,
      duplicate_of_row_id = case when f.first_pos < f.pos then o.id end
  from firsts f
  left join ordered o on o.pos = f.first_pos
  where r.id = f.id
    and f.status in ('valid', 'duplicate')
    and (r.status, r.duplicate_of_row_id) is distinct from
        (case when f.first_pos < f.pos then 'duplicate' else 'valid' end,
         case when f.first_pos < f.pos then o.id end);

  update public.excel_import_sheets s
  set rows_read = c.rows_read,
      rows_imported = c.rows_imported,
      duplicate_rows = c.duplicate_rows,
      invalid_rows = c.invalid_rows
  from (
    select s2.id,
           count(r.id)::int as rows_read,
           count(r.id) filter (where r.status = 'imported')::int as rows_imported,
           count(r.id) filter (where r.status = 'duplicate')::int as duplicate_rows,
           count(r.id) filter (where r.status = 'invalid')::int as invalid_rows
    from public.excel_import_sheets s2
    left join public.import_rows r on r.sheet_id = s2.id
    where s2.import_id = p_import_id
    group by s2.id
  ) c
  where s.id = c.id;

  update public.excel_imports i
  set worksheet_count = c.worksheet_count,
      rows_read = c.rows_read,
      rows_imported = c.rows_imported,
      duplicate_rows = c.duplicate_rows,
      invalid_rows = c.invalid_rows,
      failed_rows = c.failed_rows
  from (
    select count(distinct s.id)::int as worksheet_count,
           count(r.id) filter (where s.selected)::int as rows_read,
           count(r.id) filter (where s.selected and r.status = 'imported')::int as rows_imported,
           count(r.id) filter (where s.selected and r.status = 'duplicate')::int as duplicate_rows,
           count(r.id) filter (where s.selected and r.status = 'invalid')::int as invalid_rows,
           count(r.id) filter (where s.selected and r.status = 'failed')::int as failed_rows
    from public.excel_import_sheets s
    left join public.import_rows r on r.sheet_id = s.id
    where s.import_id = p_import_id
  ) c
  where i.id = p_import_id;
end;
$$;

revoke execute on function private.refresh_excel_import_counts(uuid) from public, anon, authenticated;

-- Locks the import, checks the caller's membership and returns its status.
create or replace function private.lock_excel_import_for_caller(p_import_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status text;
begin
  if auth.uid() is null or public.is_anonymous_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select i.workspace_id, i.status into v_workspace, v_status
  from public.excel_imports i
  where i.id = p_import_id
  for update;
  -- Same error for "missing" and "not yours", so ids can't be probed.
  if v_workspace is null or not private.is_workspace_member(v_workspace) then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

revoke execute on function private.lock_excel_import_for_caller(uuid) from public, anon, authenticated;

-- Recompute duplicates and counters (preview/validation step). Safe to repeat.
create or replace function public.refresh_excel_import(p_import_id uuid)
returns public.excel_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := private.lock_excel_import_for_caller(p_import_id);
  result public.excel_imports;
begin
  if v_status not in ('uploaded', 'parsed', 'importing', 'failed') then
    raise exception 'Import cannot be refreshed in status %', v_status using errcode = '22023';
  end if;
  perform private.refresh_excel_import_counts(p_import_id);
  select * into result from public.excel_imports where id = p_import_id;
  return result;
end;
$$;

-- Finish an import. Idempotent: calling it again on a finished import returns it unchanged.
create or replace function public.complete_excel_import(p_import_id uuid)
returns public.excel_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := private.lock_excel_import_for_caller(p_import_id);
  result public.excel_imports;
begin
  if v_status in ('completed', 'completed_with_errors') then
    select * into result from public.excel_imports where id = p_import_id;
    return result;
  end if;
  if v_status <> 'importing' then
    raise exception 'Import must be importing to complete (status %)', v_status using errcode = '22023';
  end if;

  perform private.refresh_excel_import_counts(p_import_id);

  update public.excel_imports i
  set status = case
        when i.invalid_rows + i.failed_rows > 0 then 'completed_with_errors'
        else 'completed'
      end
  where i.id = p_import_id
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.refresh_excel_import(uuid) from public, anon;
grant execute on function public.refresh_excel_import(uuid) to authenticated;
revoke execute on function public.complete_excel_import(uuid) from public, anon;
grant execute on function public.complete_excel_import(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.excel_imports enable row level security;
alter table public.excel_import_sheets enable row level security;
alter table public.import_rows enable row level security;

-- excel_imports: members read and stage; uploader or owner/admin delete.
create policy "excel_imports_select_member" on public.excel_imports
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "excel_imports_insert_member" on public.excel_imports
  for insert to authenticated
  with check (
    (select private.is_workspace_member(workspace_id))
    and created_by = (select auth.uid())
  );

create policy "excel_imports_update_member" on public.excel_imports
  for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

create policy "excel_imports_delete_uploader_or_admin" on public.excel_imports
  for delete to authenticated
  using (
    status <> 'importing'
    and (
      created_by = (select auth.uid())
      or (select private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
    )
  );

-- excel_import_sheets: members read and stage; removed only with their import.
create policy "excel_import_sheets_select_member" on public.excel_import_sheets
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "excel_import_sheets_insert_member" on public.excel_import_sheets
  for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));

create policy "excel_import_sheets_update_member" on public.excel_import_sheets
  for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

-- import_rows: same shape as sheets.
create policy "import_rows_select_member" on public.import_rows
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "import_rows_insert_member" on public.import_rows
  for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));

create policy "import_rows_update_member" on public.import_rows
  for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

-- Anonymous-auth users get nothing (restrictive, ANDed with the above).
create policy "excel_imports_deny_anonymous" on public.excel_imports
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

create policy "excel_import_sheets_deny_anonymous" on public.excel_import_sheets
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

create policy "import_rows_deny_anonymous" on public.import_rows
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

-- ---------------------------------------------------------------------------
-- 7. Table grants (explicit allow-list; see docs/DATABASE_SECURITY.md)
-- ---------------------------------------------------------------------------
-- Not granted to clients: created_by (defaults to auth.uid()), counters,
-- duplicate_of_*, started_at/completed_at, timestamps.

revoke all on public.excel_imports, public.excel_import_sheets, public.import_rows
  from anon, authenticated;

grant select, delete on public.excel_imports to authenticated;
grant insert (id, workspace_id, file_name, file_type, mime_type, file_size_bytes,
              file_sha256, storage_path, idempotency_key, duplicate_handling)
  on public.excel_imports to authenticated;
grant update (status, column_mapping, duplicate_handling, error_summary, archived_at, storage_path)
  on public.excel_imports to authenticated;

grant select on public.excel_import_sheets to authenticated;
grant insert (workspace_id, import_id, sheet_index, sheet_name, header_row_number,
              column_headers, selected)
  on public.excel_import_sheets to authenticated;
grant update (header_row_number, column_headers, selected)
  on public.excel_import_sheets to authenticated;

grant select on public.import_rows to authenticated;
grant insert (workspace_id, import_id, sheet_id, row_number, raw_data, mapped_data,
              status, issues, error_message)
  on public.import_rows to authenticated;
-- raw_data is insert-only: original spreadsheet values are never rewritten.
grant update (mapped_data, status, issues, error_message)
  on public.import_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage: private `imports` bucket
-- ---------------------------------------------------------------------------
-- Object name must equal an excel_imports.storage_path, which the CHECK above
-- pins to {workspace_id}/{import_id}/... . Upload is allowed only for the
-- uploader while the import is in `uploading`; no UPDATE policy, so files can't
-- be overwritten or moved. Downloads use short-lived signed URLs from the server.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imports',
  'imports',
  false,
  26214400,  -- 25 MiB, matches excel_imports.file_size_bytes
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_upload_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.excel_imports i
    where i.storage_path = object_name
      and i.status = 'uploading'
      and i.created_by = (select auth.uid())
      and private.is_workspace_member(i.workspace_id)
  );
$$;

create or replace function private.can_read_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.excel_imports i
    where i.storage_path = object_name
      and private.is_workspace_member(i.workspace_id)
  );
$$;

create or replace function private.can_delete_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.excel_imports i
    where i.storage_path = object_name
      and i.status <> 'importing'
      and (
        i.created_by = (select auth.uid())
        or private.has_workspace_role(i.workspace_id, array['owner', 'admin']::public.workspace_role[])
      )
  );
$$;

revoke execute on function private.can_upload_import_object(text) from public, anon;
grant execute on function private.can_upload_import_object(text) to authenticated;
revoke execute on function private.can_read_import_object(text) from public, anon;
grant execute on function private.can_read_import_object(text) to authenticated;
revoke execute on function private.can_delete_import_object(text) from public, anon;
grant execute on function private.can_delete_import_object(text) to authenticated;

create policy "imports_bucket_insert_uploader" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imports'
    and not (select public.is_anonymous_user())
    and private.can_upload_import_object(name)
  );

create policy "imports_bucket_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imports'
    and not (select public.is_anonymous_user())
    and private.can_read_import_object(name)
  );

create policy "imports_bucket_delete_uploader_or_admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imports'
    and not (select public.is_anonymous_user())
    and private.can_delete_import_object(name)
  );
