import type { BadgeTone } from "@/components/ui/badge";

/**
 * Research status logic. Pure TypeScript with no framework or Node imports, so it can be tested
 * directly and imported by client components (the status poller).
 *
 * Two levels of status exist:
 *  - a RUN has one of six database statuses (migration 009);
 *  - a COMPANY has a headline status derived from public.lead_research_summary.
 *
 * The view has two behaviours the headline must handle without hiding information:
 *  1. A failed latest run shadows an older successful one: `research_status` says "failed" even
 *     though earlier results exist. Those earlier results stay available (`hasEarlierResult`).
 *  2. It has no "cancelled" status. A cancelled latest run is visible only through
 *     `last_finished_status`, so that field is what the headline is derived from.
 */

export type RunStatus =
  "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled";

export const RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

/** Queued or running: the only states in which a run can still change on its own. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

export function isSuccessfulStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "completed_with_warnings";
}

/** How often the open page refreshes while a run is active (approved: 8 seconds). */
export const POLL_INTERVAL_MS = 8_000;

/** Polling runs only while a run is active AND the tab is visible. */
export function shouldPoll(active: boolean, visibility: string): boolean {
  return active && visibility === "visible";
}

type Label = { label: string; tone: BadgeTone };

export const RUN_STATUS: Record<RunStatus, Label> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  completed_with_warnings: { label: "Completed with warnings", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export type CompanyStatus =
  | "not_researched"
  | "queued"
  | "running"
  | "researched"
  | "researched_with_warnings"
  | "failed"
  | "cancelled";

export const COMPANY_STATUS: Record<CompanyStatus, Label> = {
  not_researched: { label: "Not researched", tone: "neutral" },
  queued: RUN_STATUS.queued,
  running: RUN_STATUS.running,
  researched: { label: "Researched", tone: "success" },
  researched_with_warnings: { label: "Researched with warnings", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: RUN_STATUS.cancelled,
};

/** The columns of public.lead_research_summary this module reads. */
export type SummaryRow = {
  active_run_id: string | null;
  active_run_status: string | null;
  last_finished_run_id: string | null;
  last_finished_status: string | null;
  last_researched_at: string | null;
  last_successful_run_id: string | null;
  research_status?: string | null;
};

export type CompanyResearchState = {
  /** Headline: what is happening now, or else how the most recent attempt ended. */
  status: CompanyStatus;
  /** A run is queued or running. */
  active: boolean;
  activeRunId: string | null;
  /** When the last SUCCESSFUL research finished (never a failed or cancelled attempt). */
  lastResearchedAt: string | null;
  lastSuccessfulRunId: string | null;
  /** The most recently finished run of any kind. */
  latestFinishedRunId: string | null;
  latestFinishedStatus: RunStatus | null;
  /** An earlier successful run exists, so results can be shown even if the latest attempt did not succeed. */
  hasEarlierResult: boolean;
};

export const NOT_RESEARCHED: CompanyResearchState = {
  status: "not_researched",
  active: false,
  activeRunId: null,
  lastResearchedAt: null,
  lastSuccessfulRunId: null,
  latestFinishedRunId: null,
  latestFinishedStatus: null,
  hasEarlierResult: false,
};

/** Derives a company's research state from its lead_research_summary row (or lack of one). */
export function deriveCompanyState(row: SummaryRow | null | undefined): CompanyResearchState {
  if (!row) return NOT_RESEARCHED;

  const finished = isRunStatus(row.last_finished_status) ? row.last_finished_status : null;
  const lastSuccessfulRunId = row.last_successful_run_id ?? null;
  const base = {
    activeRunId: null as string | null,
    lastResearchedAt: row.last_researched_at ?? null,
    lastSuccessfulRunId,
    latestFinishedRunId: finished ? (row.last_finished_run_id ?? null) : null,
    latestFinishedStatus: finished,
    hasEarlierResult: lastSuccessfulRunId !== null,
  };

  // 1. Work in progress wins over everything else.
  if (row.active_run_status === "queued" || row.active_run_status === "running") {
    return {
      ...base,
      status: row.active_run_status,
      active: true,
      activeRunId: row.active_run_id ?? null,
    };
  }

  // 2. Otherwise the headline is how the latest finished attempt ended. This is the only place a
  //    cancelled run can be seen: the view's own research_status never says "cancelled".
  const headline: CompanyStatus =
    finished === "failed"
      ? "failed"
      : finished === "cancelled"
        ? "cancelled"
        : finished === "completed"
          ? "researched"
          : finished === "completed_with_warnings"
            ? "researched_with_warnings"
            : "not_researched";
  return { ...base, status: headline, active: false };
}

export type StatusDescription = { headline: string; detail: string };

/** Plain-language status for the profile header. Contains no dates (the caller adds them). */
export function describeCompanyState(state: CompanyResearchState): StatusDescription {
  const earlier = state.hasEarlierResult;
  switch (state.status) {
    case "not_researched":
      return {
        headline: "Not researched",
        detail: "This company hasn't been researched yet. Nothing has been looked up or inferred.",
      };
    case "queued":
      return {
        headline: "Research queued",
        detail:
          "Waiting for the research worker. In this phase the worker is started manually, so research begins only when it is run.",
      };
    case "running":
      return {
        headline: "Research running",
        detail:
          "The research worker is reading the company's website. This page refreshes automatically.",
      };
    case "researched":
      return {
        headline: "Researched",
        detail:
          "Findings come from the company's own website. Each confirmed item shows its source and an exact supporting quote.",
      };
    case "researched_with_warnings":
      return {
        headline: "Researched with warnings",
        detail:
          "Some pages couldn't be read, or some information wasn't found. See the warnings below.",
      };
    case "failed":
      return {
        headline: "Latest attempt failed",
        detail: earlier
          ? "Results from the last successful research are still shown below."
          : "No results are available yet. Start new research once the problem is fixed.",
      };
    case "cancelled":
      return {
        headline: "Latest attempt cancelled",
        detail: earlier
          ? "Results from the last successful research are still shown below."
          : "No results are available. You can start new research.",
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Run descriptions and retry guidance
// ---------------------------------------------------------------------------------------------

type Advice = "try_again" | "fix_first" | "unlikely";

/**
 * What a stored run error code means for the person reading it. `fix_first` codes cannot succeed
 * until the company's data changes, so a retry is not permitted until then. The codes come from
 * the Phase 3A fetch errors, the Phase 3B extraction errors, the worker and the database.
 */
const ERROR_GUIDANCE: Record<string, { advice: Advice; text: string }> = {
  // The company itself must change first.
  no_website: { advice: "fix_first", text: "This company has no website. Add one first." },
  invalid_url: {
    advice: "fix_first",
    text: "The website address isn't valid. Correct it before researching again.",
  },
  lead_suppressed: { advice: "fix_first", text: "This company is suppressed." },
  lead_not_found: { advice: "fix_first", text: "This company no longer exists in the workspace." },
  // The website itself blocks or cannot be read; another attempt is unlikely to help.
  blocked_address: { advice: "unlikely", text: "The website address isn't a public website." },
  dns_not_found: { advice: "unlikely", text: "The website's domain doesn't exist." },
  outside_boundary: {
    advice: "unlikely",
    text: "The website redirects to a different website, so it wasn't researched.",
  },
  robots_disallowed: {
    advice: "unlikely",
    text: "The website's robots.txt doesn't allow research.",
  },
  redirect_blocked: { advice: "unlikely", text: "The website redirected somewhere not allowed." },
  too_many_redirects: { advice: "unlikely", text: "The website redirected too many times." },
  tls_error: { advice: "unlikely", text: "The website's HTTPS certificate couldn't be verified." },
  unsupported_content_type: { advice: "unlikely", text: "The website isn't a readable web page." },
  response_too_large: { advice: "unlikely", text: "The website's page was too large." },
  decode_error: { advice: "unlikely", text: "The website's text couldn't be decoded." },
  page_unparseable: { advice: "unlikely", text: "The website's home page couldn't be read." },
  payload_invalid: { advice: "unlikely", text: "The results couldn't be packaged for storage." },
  storage_rejected: { advice: "unlikely", text: "Storage refused the saved page text." },
  results_rejected: { advice: "unlikely", text: "The database rejected the research results." },
  run_not_found: { advice: "unlikely", text: "The research run no longer exists." },
  // Usually temporary.
  dns_temporary: { advice: "try_again", text: "The domain couldn't be looked up right now." },
  connect_timeout: { advice: "try_again", text: "The website didn't respond in time." },
  timeout: { advice: "try_again", text: "The website took too long to respond." },
  connection_failed: { advice: "try_again", text: "The connection to the website failed." },
  robots_unavailable: {
    advice: "try_again",
    text: "The website's robots.txt couldn't be read right now.",
  },
  http_status: { advice: "try_again", text: "The website returned an error." },
  crawl_deadline_exceeded: {
    advice: "try_again",
    text: "The website didn't finish loading within the time limit.",
  },
  storage_upload_failed: { advice: "try_again", text: "Saving the page text failed." },
  database_unavailable: { advice: "try_again", text: "The database couldn't be reached." },
  internal_error: { advice: "try_again", text: "An internal error stopped the run." },
  lease_expired: { advice: "try_again", text: "The research worker stopped responding." },
  lease_lost: { advice: "try_again", text: "The run was taken over by another worker." },
  research_not_configured: {
    advice: "try_again",
    text: "Research wasn't fully configured on the server.",
  },
  requester_not_authorized: {
    advice: "try_again",
    text: "The person who asked for this research no longer has access. Ask again from a current account.",
  },
};

export type RetryInfo = {
  /** A new research request is allowed (the company's own data permits it). */
  permitted: boolean;
  /** The system will retry this run by itself; nothing to do. */
  automatic: boolean;
  text: string;
};

export type RunLike = {
  status: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
};

export type RunDescription = {
  label: string;
  tone: BadgeTone;
  /** One short line about the run, or null. */
  detail: string | null;
  retry: RetryInfo | null;
};

export function describeRun(run: RunLike): RunDescription {
  const known = isRunStatus(run.status) ? run.status : "failed";
  const { label, tone } = RUN_STATUS[known];
  const attempts = `attempt ${run.attempts} of ${run.max_attempts}`;

  switch (known) {
    case "queued":
      return run.attempts > 0
        ? {
            label,
            tone,
            detail: `Waiting for another attempt (${attempts} used).`,
            retry: {
              permitted: false,
              automatic: true,
              text: "A retry is scheduled automatically.",
            },
          }
        : { label, tone, detail: "Waiting for the research worker.", retry: null };
    case "running":
      return { label, tone, detail: `Working (${attempts}).`, retry: null };
    case "completed":
      return { label, tone, detail: null, retry: null };
    case "completed_with_warnings":
      return { label, tone, detail: "Finished, with warnings.", retry: null };
    case "cancelled":
      return {
        label,
        tone,
        detail: "Cancelled before it finished.",
        retry: { permitted: true, automatic: false, text: "You can start new research." },
      };
    case "failed": {
      const guide = run.error_code ? ERROR_GUIDANCE[run.error_code] : undefined;
      const exhausted = run.attempts >= run.max_attempts ? ` (${attempts} used)` : "";
      if (guide?.advice === "fix_first") {
        return {
          label,
          tone,
          detail: guide.text,
          retry: {
            permitted: false,
            automatic: false,
            text: "Retry isn't permitted until this is fixed.",
          },
        };
      }
      return {
        label,
        tone,
        detail: `${guide?.text ?? "The run didn't finish."}${exhausted}`,
        retry: {
          permitted: true,
          automatic: false,
          text:
            guide?.advice === "unlikely"
              ? "You can start new research, but it is unlikely to help."
              : "You can start new research; it may succeed.",
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Results of the two database functions and their errors
// ---------------------------------------------------------------------------------------------

export type ActionResult = { status: "success" | "info" | "error"; message: string };

const GENERIC_REQUEST_ERROR = "Research couldn't be started. Please try again.";
const GENERIC_CANCEL_ERROR = "Research couldn't be cancelled. Please try again.";

/** request_lead_research: queued | duplicate_request | already_active | not_found | limit_reached */
export function describeRequestOutcome(outcome: string | null | undefined): ActionResult {
  switch (outcome) {
    case "queued":
      return {
        status: "success",
        message:
          "Research queued. It starts the next time the research worker is run (the worker is started manually for now).",
      };
    case "duplicate_request":
      return {
        status: "info",
        message:
          "This request was already received, so no new run was created. Reload the page to request research again.",
      };
    case "already_active":
      return {
        status: "info",
        message: "Research is already queued or running for this company.",
      };
    case "not_found":
      return {
        status: "error",
        message:
          "This company wasn't found in your workspace, or it is suppressed, so it can't be researched.",
      };
    case "limit_reached":
      return {
        status: "error",
        message:
          "The research limit was reached (200 active runs, or 300 new runs in 24 hours). Try again later.",
      };
    default:
      return { status: "error", message: GENERIC_REQUEST_ERROR };
  }
}

/** Errors raised by request_lead_research, by SQLSTATE. */
export function describeRequestError(code: string | null | undefined): ActionResult {
  if (code === "42501") {
    return {
      status: "error",
      message:
        "You don't have permission to request research in this workspace. Sign in again if your session expired.",
    };
  }
  if (code === "22023") {
    return {
      status: "error",
      message: "The request wasn't valid. Reload the page and try again.",
    };
  }
  return { status: "error", message: GENERIC_REQUEST_ERROR };
}

/** cancel_research_run: cancelled | cancel_requested | <the run's finished status> */
export function describeCancelResult(result: string | null | undefined): ActionResult {
  if (result === "cancelled") return { status: "success", message: "Research cancelled." };
  if (result === "cancel_requested") {
    return {
      status: "success",
      message:
        "Cancellation requested. The run stops at its next checkpoint, usually within seconds.",
    };
  }
  if (isRunStatus(result) && !isActiveStatus(result)) {
    return {
      status: "info",
      message: "This run had already finished, so there was nothing to cancel.",
    };
  }
  return {
    status: "error",
    message: "Cancellation couldn't be confirmed. Reload the page and check the run's status.",
  };
}

/** Errors raised by cancel_research_run, by SQLSTATE. */
export function describeCancelError(code: string | null | undefined): ActionResult {
  if (code === "42501") {
    return {
      status: "error",
      message:
        "Only the person who requested this research, or a workspace owner or admin, can cancel it.",
    };
  }
  if (code === "P0002") {
    return { status: "error", message: "That research run wasn't found." };
  }
  return { status: "error", message: GENERIC_CANCEL_ERROR };
}
