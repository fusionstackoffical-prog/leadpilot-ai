-- LeadPilot AI — Phase 0 foundation
-- Profiles, workspaces, workspace membership, RLS and helper functions.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.workspace_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- workspaces: the tenant boundary. Every business table will carry workspace_id.
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  timezone text not null default 'America/New_York',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer avoids recursive RLS on members)
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace uuid,
  allowed public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and m.role = any (allowed)
  );
$$;

-- Creates a workspace and makes the caller its owner, atomically.
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
  if caller is null then
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

-- A workspace must always keep at least one owner.
create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger workspace_members_keep_owner
  before update or delete on public.workspace_members
  for each row execute function public.prevent_last_owner_removal();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Anonymous users never touch these tables.
revoke all on public.profiles, public.workspaces, public.workspace_members from anon;

-- profiles: see yourself and people you share a workspace with; edit only yourself.
create policy "profiles_select_self_or_teammate" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = profiles.id
    )
  );

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Profiles are created by trigger only; email is owned by auth.users.
revoke insert, delete, update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- workspaces: members read; owners/admins update; owners delete.
-- Inserts go through create_workspace() only.
create policy "workspaces_select_member" on public.workspaces
  for select to authenticated
  using ((select public.is_workspace_member(id)));

create policy "workspaces_update_admin" on public.workspaces
  for update to authenticated
  using ((select public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[])))
  with check ((select public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[])));

create policy "workspaces_delete_owner" on public.workspaces
  for delete to authenticated
  using ((select public.has_workspace_role(id, array['owner']::public.workspace_role[])));

revoke insert, update on public.workspaces from authenticated;
grant update (name, timezone) on public.workspaces to authenticated;

-- workspace_members: members see the roster; owners manage it.
create policy "members_select_member" on public.workspace_members
  for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy "members_insert_owner" on public.workspace_members
  for insert to authenticated
  with check ((select public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])));

create policy "members_update_owner" on public.workspace_members
  for update to authenticated
  using ((select public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])))
  with check ((select public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])));

revoke update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;

-- Owners can remove anyone; any member can leave.
create policy "members_delete_owner_or_self" on public.workspace_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

-- Function execution: only signed-in users.
revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
revoke execute on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
