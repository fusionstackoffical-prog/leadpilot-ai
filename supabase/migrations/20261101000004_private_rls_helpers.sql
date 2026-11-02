-- LeadPilot AI — move RLS helper functions out of the exposed API schema
-- is_workspace_member() and has_workspace_role() are SECURITY DEFINER helpers that
-- exist only for RLS policies. In `public` they were also callable through
-- /rest/v1/rpc (Supabase advisor 0029). The `private` schema is not exposed by the
-- Data API, so moving them keeps policy behaviour identical while removing that
-- surface. create_workspace() stays in `public` because the app calls it via RPC.
--
-- Policies reference functions by OID, so ALTER FUNCTION ... SET SCHEMA updates
-- every existing policy automatically; no policy is dropped or recreated.
-- Function bodies already use schema-qualified names and an empty search_path.

create schema if not exists private;

-- Only signed-in users evaluate policies that call these helpers.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_workspace_member(uuid) set schema private;
alter function public.has_workspace_role(uuid, public.workspace_role[]) set schema private;

-- Restate execute grants explicitly (SET SCHEMA preserves them; this documents intent).
revoke execute on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
revoke execute on function private.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;

-- Future functions created in `private` by migrations get no API-role access by default.
alter default privileges for role postgres in schema private
  revoke execute on functions from anon, authenticated;
