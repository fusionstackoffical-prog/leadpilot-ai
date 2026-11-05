/**
 * The only database columns the research dashboard reads. Each list is a literal string so the
 * Supabase client keeps its row types, and each is checked by tests/research/research-ui-guards.
 *
 * Deliberately absent: the private page text and where it is stored (`text_storage_path`,
 * `text_sha256`, `text_bytes`, `text_chars`, `text_purged_at`), content hashes (`value_hash`),
 * worker lease and idempotency fields (`locked_by`, `locked_until`, `idempotency_key`), AI usage
 * and cost fields, and `workspace_id`/`lead_id` where the caller already knows them.
 */

/** public.lead_research_summary (a security_invoker view over the caller's own workspaces). */
export const SUMMARY_COLUMNS =
  "lead_id, active_run_id, active_run_status, last_finished_run_id, last_finished_status, last_successful_run_id, last_researched_at, research_status" as const;

/**
 * public.research_runs. `requested_by` is another member's user id: it is read only on the
 * server to work out "requested by you" and cancel permission, and is never sent to the browser.
 */
export const RUN_COLUMNS =
  "id, status, trigger_source, requested_by, queued_at, started_at, finished_at, created_at, attempts, max_attempts, next_attempt_at, error_code, error_message, warnings, sources_count, facts_count, candidates_count, assessments_count, pages_fetched, cancel_requested_at" as const;

/** public.research_findings: value, evidence quote and how it was verified. */
export const FINDING_COLUMNS =
  "id, category, kind, field_key, value_text, value_json, source_id, evidence_quote, quote_check, quote_verified_at, confidence, created_at" as const;

/** public.lead_sources: safe metadata only. The stored text is never read by the dashboard. */
export const SOURCE_COLUMNS =
  "id, url, final_url, title, retrieved_at, http_status, source_type" as const;

/** What an action needs to know about a lead before queueing research. */
export const LEAD_FOR_ACTION_COLUMNS = "id, website, suppressed" as const;

/** What the cancel action needs to know about a run. */
export const RUN_FOR_CANCEL_COLUMNS = "id, lead_id, status, requested_by" as const;

/** Page sizes for the research views. */
export const HISTORY_LIMIT = 20;
export const FINDINGS_LIMIT = 300; // migration 009 allows at most 300 findings per run
export const SOURCES_LIMIT = 25; // ... and 25 sources
