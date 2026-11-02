-- LeadPilot AI — foundation security hardening
-- 1. Serialize owner removals per workspace so concurrent changes can't leave zero owners.
-- 2. Block Supabase anonymous-auth users from workspaces, membership and profiles.
-- 3. Tighten function EXECUTE grants and default privileges for future objects.
-- 4. Reset table grants for API roles to an explicit allow-list (no TRUNCATE,
--    REFERENCES, TRIGGER; no client-controlled timestamps or identity columns).
-- Does not alter table structure, data, or the profile trigger.

-- ---------------------------------------------------------------------------
-- 1. Concurrency-safe last-owner protection
-- ---------------------------------------------------------------------------
-- A transaction-scoped advisory lock keyed on the workspace makes every owner
-- removal in that workspace (demotion, removal, leaving, or auth-user deletion
-- cascading into workspace_members) wait for the previous one to commit or roll
-- back. The function is VOLATILE, so under READ COMMITTED the owner check after
-- the lock runs on a fresh snapshot and sees the earlier transaction's result.
--
-- SECURITY DEFINER makes the owner count independent of the caller's RLS view.
-- Trigger functions cannot be called directly, and search_path is pinned.

create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('leadpilot.workspace_owner:' || old.workspace_id::text, 0)
    );

    if not exists (
         select 1 from public.workspace_members m
         where m.workspace_id = old.workspace_id
           and m.role = 'owner'
           and m.user_id <> old.user_id
       )
       -- Allow the cascade when the whole workspace is being deleted.
       and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
    then
      raise exception 'A workspace must have at least one owner' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Anonymous-auth users
-- ---------------------------------------------------------------------------
-- Supabase anonymous sign-ins (off by default) issue the `authenticated` role
-- with an `is_anonymous` JWT claim. These users must not hold workspace data.

create or replace function public.is_anonymous_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function public.create_workspace(
  workspace_name text,
  workspace_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  new_id uuid;
begin
  if caller is null or public.is_anonymous_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = workspace_timezone) then
    raise exception 'Unknown timezone: %', workspace_timezone using errcode = '22023';
  end if;

  insert into public.workspaces (name, timezone, created_by)
  values (trim(workspace_name), workspace_timezone, caller)
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, caller, 'owner');

  return new_id;
end;
$$;

-- Restrictive policies are ANDed with the existing permissive ones, so these
-- remove access for anonymous users without widening anything for others.
create policy "profiles_deny_anonymous" on public.profiles
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

create policy "workspaces_deny_anonymous" on public.workspaces
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

create policy "members_deny_anonymous" on public.workspace_members
  as restrictive for all to authenticated
  using (not (select public.is_anonymous_user()))
  with check (not (select public.is_anonymous_user()));

-- ---------------------------------------------------------------------------
-- 3. Function grants and default privileges
-- ---------------------------------------------------------------------------

-- Trigger-only functions: no API role needs EXECUTE.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.prevent_last_owner_removal() from public, anon, authenticated;

revoke execute on function public.is_anonymous_user() from public, anon;
grant execute on function public.is_anonymous_user() to authenticated;

-- Secure-by-default for objects created by future migrations (run as postgres):
-- no automatic table/sequence/function access for API roles. Every new table must
-- enable RLS and grant exactly what it needs. See docs/DATABASE_SECURITY.md.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
-- PUBLIC's EXECUTE default is global in PostgreSQL and can't be revoked per schema.
alter default privileges for role postgres
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 4. Explicit table grants for API roles
-- ---------------------------------------------------------------------------
-- Supabase's default privileges gave `authenticated` ALL on these tables, and
-- 001 only revoked some of them. Reset to an exact allow-list. REVOKE ALL also
-- removes column-level grants, so every grant needed is restated below.
-- Columns not listed (id, created_at, updated_at, created_by, email, and the
-- identity columns on update) stay database-controlled. RLS still decides which
-- rows each statement may touch.

revoke all on public.profiles, public.workspaces, public.workspace_members from anon, authenticated;

-- profiles: rows created by trigger; users read (RLS) and edit only their display name.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- workspaces: created only via create_workspace(); owners/admins edit settings; owners delete.
grant select, delete on public.workspaces to authenticated;
grant update (name, timezone) on public.workspaces to authenticated;

-- workspace_members: owners add members and change roles (RLS); members may leave.
-- workspace_id and user_id are insert-only; created_at always comes from the default.
grant select, delete on public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role) on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;
