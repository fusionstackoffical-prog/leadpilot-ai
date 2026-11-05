import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  FINDING_COLUMNS,
  FINDINGS_LIMIT,
  HISTORY_LIMIT,
  RUN_COLUMNS,
  SOURCE_COLUMNS,
  SOURCES_LIMIT,
  SUMMARY_COLUMNS,
} from "./columns.ts";
import {
  countFindings,
  groupFindings,
  missingInformation,
  plain,
  presentSource,
  presentWarnings,
  type MissingItem,
  type PresentedSource,
  type PresentedWarning,
  type ResearchSections,
} from "./presenter.ts";
import {
  deriveCompanyState,
  isActiveStatus,
  isRunStatus,
  NOT_RESEARCHED,
  type CompanyResearchState,
  type RunStatus,
} from "./status.ts";
import type { Json } from "../../types/database.ts";

/**
 * Research reads for the dashboard. Every query runs as the signed-in user (RLS-scoped client)
 * and filters by workspace and, where relevant, lead. Only the allow-listed columns in
 * columns.ts are selected, so private page text, storage paths and hashes are never read.
 */

/** One research run, shaped for display. Contains no other member's user id. */
export type RunView = {
  id: string;
  status: RunStatus;
  triggerSource: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  /** The worker's stored, readable failure reason, shown as plain text. */
  errorMessage: string | null;
  warningCount: number;
  sourcesCount: number;
  factsCount: number;
  candidatesCount: number;
  assessmentsCount: number;
  pagesFetched: number;
  /** The signed-in user asked for this run. (The requester's id itself is never returned.) */
  requestedByYou: boolean;
  /** The run is active AND the user is its requester or a workspace owner/admin. */
  canCancel: boolean;
};

export type SelectedRun = {
  run: RunView;
  sections: ResearchSections;
  missing: MissingItem[];
  warnings: PresentedWarning[];
  counts: { confirmed: number; unconfirmed: number };
  /** The pages this run read: address, title, time and HTTP status. Never the stored text. */
  sources: PresentedSource[];
  /** Showing the latest successful run (true) or one the user picked from the history (false). */
  isDefault: boolean;
};

export type ResearchOverview = {
  state: CompanyResearchState;
  runs: RunView[];
  activeRun: RunView | null;
  selected: SelectedRun | null;
  /** The ?run= value didn't match a run of this company, so the default run is shown instead. */
  requestedRunNotFound: boolean;
};

type RunRow = {
  id: string;
  status: string;
  trigger_source: string;
  requested_by: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  error_code: string | null;
  error_message: string | null;
  warnings: Json;
  sources_count: number;
  facts_count: number;
  candidates_count: number;
  assessments_count: number;
  pages_fetched: number;
};

function toRunView(row: RunRow, userId: string, role: string): RunView {
  const status = isRunStatus(row.status) ? row.status : "failed";
  const requestedByYou = row.requested_by !== null && row.requested_by === userId;
  return {
    id: row.id,
    status,
    triggerSource: row.trigger_source,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: status === "queued" ? row.next_attempt_at : null,
    errorCode: row.error_code,
    errorMessage: plain(row.error_message, 300) || null,
    warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0,
    sourcesCount: row.sources_count,
    factsCount: row.facts_count,
    candidatesCount: row.candidates_count,
    assessmentsCount: row.assessments_count,
    pagesFetched: row.pages_fetched,
    requestedByYou,
    canCancel: isActiveStatus(status) && (requestedByYou || role === "owner" || role === "admin"),
  };
}

/** Research status for a page of companies, in one query. Companies with no runs are "not researched". */
export async function getResearchStatuses(
  workspaceId: string,
  leadIds: string[],
): Promise<Record<string, CompanyResearchState>> {
  const states: Record<string, CompanyResearchState> = {};
  for (const id of leadIds) states[id] = NOT_RESEARCHED;
  if (leadIds.length === 0) return states;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_research_summary")
    .select(SUMMARY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .in("lead_id", leadIds);
  if (error) throw new Error("Could not load research status.");

  for (const row of data ?? []) {
    if (row.lead_id) states[row.lead_id] = deriveCompanyState(row);
  }
  return states;
}

export async function getResearchOverview(args: {
  workspaceId: string;
  leadId: string;
  userId: string;
  /** The user's role in this workspace (decides who may cancel someone else's run). */
  role: string;
  /** A run the user picked from the history, already validated as a UUID. */
  runId?: string | null;
}): Promise<ResearchOverview> {
  const { workspaceId, leadId, userId, role, runId } = args;
  const supabase = await createClient();

  const runsQuery = (id?: string) => {
    let q = supabase
      .from("research_runs")
      .select(RUN_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId);
    if (id) q = q.eq("id", id);
    return q;
  };

  const [summaryResult, runsResult] = await Promise.all([
    supabase
      .from("lead_research_summary")
      .select(SUMMARY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId)
      .maybeSingle(),
    runsQuery().order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  if (summaryResult.error) throw new Error("Could not load research status.");
  if (runsResult.error) throw new Error("Could not load research history.");

  const state = deriveCompanyState(summaryResult.data);
  const rows = (runsResult.data ?? []) as RunRow[];
  const runs = rows.map((r) => toRunView(r, userId, role));
  const activeRun =
    runs.find((r) => r.id === state.activeRunId) ??
    runs.find((r) => isActiveStatus(r.status)) ??
    null;

  // Which run to show: the one picked from the history, else the latest SUCCESSFUL run (so a
  // newer failed or cancelled attempt never hides earlier results), else the newest run.
  const findRow = async (id: string): Promise<RunRow | null> => {
    const known = rows.find((r) => r.id === id);
    if (known) return known;
    const { data, error } = await runsQuery(id).maybeSingle();
    if (error) throw new Error("Could not load research history.");
    return (data as RunRow | null) ?? null;
  };

  let requestedRunNotFound = false;
  let chosen: RunRow | null = null;
  let isDefault = true;
  if (runId) {
    chosen = await findRow(runId);
    if (chosen) isDefault = chosen.id === state.lastSuccessfulRunId;
    else requestedRunNotFound = true;
  }
  if (!chosen) {
    isDefault = true;
    chosen = state.lastSuccessfulRunId
      ? await findRow(state.lastSuccessfulRunId)
      : (rows[0] ?? null);
  }
  if (!chosen) {
    return { state, runs, activeRun, selected: null, requestedRunNotFound };
  }

  const run = toRunView(chosen, userId, role);
  const hasFindings = run.factsCount + run.candidatesCount + run.assessmentsCount > 0;
  const [findingsResult, sourcesResult] = hasFindings
    ? await Promise.all([
        supabase
          .from("research_findings")
          .select(FINDING_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("lead_id", leadId)
          .eq("run_id", run.id)
          .order("category")
          .order("field_key")
          .limit(FINDINGS_LIMIT),
        supabase
          .from("lead_sources")
          .select(SOURCE_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("lead_id", leadId)
          .eq("run_id", run.id)
          .order("retrieved_at")
          .limit(SOURCES_LIMIT),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (findingsResult.error || sourcesResult.error)
    throw new Error("Could not load research results.");

  const sections = groupFindings(findingsResult.data ?? [], sourcesResult.data ?? []);
  return {
    state,
    runs,
    activeRun,
    selected: {
      run,
      sections,
      missing: missingInformation(sections),
      warnings: presentWarnings(chosen.warnings),
      counts: countFindings(sections),
      sources: (sourcesResult.data ?? []).map(presentSource),
      isDefault,
    },
    requestedRunNotFound,
  };
}
