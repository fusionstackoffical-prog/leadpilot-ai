-- Reverse of supabase/migrations/20261103000009_company_research.sql.
--
-- Kept outside supabase/migrations so the CLI never applies it. Run it only with explicit
-- approval, then record the rollback with:
--   npx supabase migration repair --status reverted 20261103000009 --linked
--
-- It drops only objects created by migration 009. Leads, imports and all other data are not
-- touched. WARNING: it permanently deletes all research runs, sources, findings and audit
-- events. Take a backup first if any research has been run.
--
-- Storage: Supabase blocks direct SQL deletes on storage tables. Empty and delete the private
-- `research-sources` bucket through the Storage API or dashboard after running this script.
-- An empty, unused private bucket is harmless if left in place.

begin;

drop view if exists public.lead_research_summary;

drop function if exists public.worker_research_orphan_objects(integer);
drop function if exists public.worker_mark_research_text_purged(uuid[]);
drop function if exists public.worker_research_text_due_for_purge(integer);
drop function if exists public.worker_fail_research_run(uuid, text, text, text, boolean);
drop function if exists public.worker_complete_research_run(uuid, text, jsonb);
drop function if exists public.worker_heartbeat_research_run(uuid, text, integer);
drop function if exists public.worker_claim_research_runs(text, integer, integer);
drop function if exists public.research_run_changes(uuid);
drop function if exists public.cancel_research_run(uuid);
drop function if exists public.request_lead_research(uuid, uuid[], text);

-- Dropping a table drops its triggers, policies and indexes; row triggers do not fire.
drop table if exists public.research_run_events;
drop table if exists public.research_findings;
drop table if exists public.lead_sources;
drop table if exists public.research_runs;

drop function if exists private.research_event_guard();
drop function if exists private.research_finding_evidence();
drop function if exists private.research_history_guard();
drop function if exists private.research_run_guard();

commit;
