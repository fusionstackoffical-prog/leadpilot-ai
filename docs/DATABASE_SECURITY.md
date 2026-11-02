# Database Security Rules

These rules apply to every migration in `supabase/migrations/`.

## Rule: every application table is locked down explicitly

Since `20261031000003_foundation_security_hardening.sql`, new tables, sequences and functions created by migrations get **no** privileges for `anon` or `authenticated` by default. Each new table must, in the same migration:

1. `alter table ... enable row level security;`
2. Carry `workspace_id uuid not null references public.workspaces (id) on delete cascade` (unless it is genuinely global), with an index.
3. Grant only what the API needs, e.g. `grant select, insert on public.x to authenticated;`. Prefer column-level `grant update (col, ...)` for updates. Never grant to `anon` unless the data is public.
4. Add policies using the helpers, scoped `to authenticated`:
   - read: `using ((select private.is_workspace_member(workspace_id)))`
   - write: `with check ((select private.has_workspace_role(workspace_id, array[...]::public.workspace_role[])))`
5. Add a restrictive anonymous-user policy:
   ```sql
   create policy "x_deny_anonymous" on public.x as restrictive for all to authenticated
     using (not (select public.is_anonymous_user()))
     with check (not (select public.is_anonymous_user()));
   ```
6. Never let a client set `workspace_id` to a workspace it isn't a member of (enforced by the `with check` above) or change it afterwards (omit it from column grants).

## Functions

- **Schema placement (since `20261101000004_private_rls_helpers.sql`):**
  - `public` is exposed by the Data API, so every function there is callable at `/rest/v1/rpc/<name>`. Put a function in `public` **only** if the app is meant to call it through the API (e.g. `create_workspace`).
  - Security helpers used by RLS policies, triggers or other functions (membership/role checks, ownership lookups, anything `security definer` that is not an API entry point) **must live in the `private` schema**, which the Data API does not expose.
  - `authenticated` has `USAGE` on `private`; grant `execute` on each helper explicitly. `anon` has no access.
  - Supabase advisor `0029_authenticated_security_definer_function_executable` should list only intentional API entry points.
- `security definer` functions must `set search_path = ''`, fully qualify every name, and validate `auth.uid()` themselves.
- Revoke `execute` from `public, anon` and grant only to the roles that call it.
- State-changing operations that must be atomic (e.g. approvals, sends) go through functions, not open `update` policies.

## Service role

The service-role key bypasses RLS. It is used only in `src/lib/supabase/admin.ts` (server-only) for trusted background work, never to serve a user request without an explicit authorization check.

## Verification after every migration

Run against the linked project and expect all zeros / the reviewed function list:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tables_without_rls,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') as anon_table_grants,
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')) as api_callable_functions,
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')) as api_security_definer_functions;
```

Expected today: `api_callable_functions` = `create_workspace, is_anonymous_user`; `api_security_definer_functions` = `create_workspace`.

Also run `npx supabase db advisors --linked` and resolve security findings.

## Known accepted behaviours

- A workspace always keeps at least one owner. Deleting the sole owner's auth account is blocked until the workspace is deleted or another owner is added.
- Owners can add existing users to their workspace directly. Before multiple independent tenants share the platform, replace this with an invitation/accept flow.
- Supabase **anonymous sign-ins must stay disabled**; the database also rejects anonymous-auth users on all workspace tables.
