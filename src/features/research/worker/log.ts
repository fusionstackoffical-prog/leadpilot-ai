import { RepositoryError } from "./types.ts";

/**
 * Safe operator logging for the research worker.
 *
 * A log line is built ONLY from two closed sets: a fixed message per event and, optionally, a
 * fixed reason word. No error object, error message, header, URL, company name, lead id, run id,
 * count or any other runtime value can reach the output, so nothing sensitive can leak through
 * the logs no matter what fails. Details about an individual run live on the run itself in the
 * database (error code and message), never here.
 *
 * Only infrastructure failures are logged. Routine outcomes (completed, retried, failed runs)
 * and rejected requests (wrong secret, wrong method) are deliberately not logged: the first are
 * recorded per run in the database, and logging the second would let anyone flood the terminal.
 */

export type WorkerLogEvent =
  | "research_not_configured"
  | "claim_failed"
  | "run_unresolved"
  | "run_crashed"
  | "maintenance_purge_failed"
  | "maintenance_orphan_sweep_failed"
  | "batch_failed";

export type WorkerLogReason = RepositoryError["kind"] | "unexpected";

export type WorkerLogger = (event: WorkerLogEvent, reason?: WorkerLogReason) => void;

export const WORKER_LOG_MESSAGES: Record<WorkerLogEvent, string> = {
  research_not_configured: "Research is not configured on the server, so no runs were claimed.",
  claim_failed: "Claiming queued research runs failed.",
  run_unresolved: "A research run's final state could not be confirmed; its lease will expire.",
  run_crashed: "A research run stopped unexpectedly.",
  maintenance_purge_failed: "Maintenance could not purge old source text.",
  maintenance_orphan_sweep_failed: "Maintenance could not remove unreferenced uploads.",
  batch_failed: "A research worker batch failed.",
};

const REASONS: ReadonlySet<string> = new Set<WorkerLogReason>([
  "lease_lost",
  "not_found",
  "invalid_result",
  "storage_rejected",
  "storage_transient",
  "transient",
  "unexpected",
]);

/** The fixed reason word for an error. Anything that is not a known repository failure is "unexpected". */
export function reasonOf(error: unknown): WorkerLogReason {
  return error instanceof RepositoryError && REASONS.has(error.kind) ? error.kind : "unexpected";
}

/** Calls the logger, never letting a failing logger affect the worker. */
export function emit(
  log: WorkerLogger | undefined,
  event: WorkerLogEvent,
  reason?: WorkerLogReason,
): void {
  if (!log) return;
  try {
    log(event, reason);
  } catch {
    // Logging must never change what the worker does.
  }
}

const reported = new WeakSet<object>();

/**
 * Logs a failure once. An error that is rethrown up the stack (for example a failed claim that
 * the HTTP handler later sees as a failed batch) is reported where it first happened and is not
 * logged again further up.
 */
export function reportOnce(
  log: WorkerLogger | undefined,
  event: WorkerLogEvent,
  error: unknown,
): void {
  if (typeof error === "object" && error !== null) {
    if (reported.has(error)) return;
    reported.add(error);
  }
  emit(log, event, reasonOf(error));
}

/** Writes to the server's console (the terminal running `next dev` / `next start`). */
export const consoleLogger: WorkerLogger = (event, reason) => {
  const message = WORKER_LOG_MESSAGES[event];
  const line =
    reason && REASONS.has(reason)
      ? `[research-worker] ${message} (${reason})`
      : `[research-worker] ${message}`;
  if (event === "research_not_configured") console.warn(line);
  else console.error(line);
};
