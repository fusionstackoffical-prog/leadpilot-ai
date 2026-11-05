import type { ResearchFetchConfig } from "../engine/config.ts";
import type { ResearchFetcher } from "../engine/net/fetcher.ts";
import type { CompletionPayload } from "../engine/extract/payload.ts";

/**
 * Types shared by the research worker (Phase 3C). Everything here is plain TypeScript with no
 * framework or Supabase imports, so the worker logic can be tested with in-memory fakes.
 */

export type RunStatus =
  "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled";

/** A research run this worker has claimed (and holds the lease for). */
export type ClaimedRun = {
  id: string;
  workspaceId: string;
  leadId: string;
  /** null when the requesting account was deleted (the database sets it to null). */
  requestedBy: string | null;
  triggerSource: "manual" | "bulk" | "scheduled";
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
};

export type LeadForResearch = {
  id: string;
  workspaceId: string;
  companyName: string;
  website: string | null;
  suppressed: boolean;
};

/** The few run fields the worker re-reads to settle an uncertain situation. */
export type RunSnapshot = {
  status: RunStatus;
  lockedBy: string | null;
  cancelRequested: boolean;
};

export type RunFailure = {
  /** Stored in research_runs.error_code (at most 100 characters). */
  code: string;
  /** Stored in research_runs.error_message and shown to workspace members. Never a raw error. */
  message: string;
  retryable: boolean;
};

export type CompletionStatus = "completed" | "completed_with_warnings" | "cancelled";
export type FailureStatus = "queued" | "failed" | "cancelled";

export type PurgeCandidate = { sourceId: string; storagePath: string };

/**
 * Why a repository call failed, without database or storage details:
 *  - lease_lost      the run is not held by this worker any more (SQLSTATE 55000)
 *  - not_found       the run, lead or workspace no longer exists (P0002)
 *  - invalid_result  the database rejected the results themselves (22023, 54000, 23514)
 *  - storage_rejected  Storage refused the object itself (too large, wrong type)
 *  - storage_transient Storage could not be reached or failed; worth retrying
 *  - transient       any other database or network failure; the outcome of the call is unknown
 */
export type RepositoryErrorKind =
  | "lease_lost"
  | "not_found"
  | "invalid_result"
  | "storage_rejected"
  | "storage_transient"
  | "transient";

export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;

  constructor(kind: RepositoryErrorKind, message: string) {
    super(message);
    this.name = "RepositoryError";
    this.kind = kind;
  }
}

/**
 * Everything the worker needs from the outside world. The production implementation is a thin
 * adapter over the migration 009 worker functions and the private research-sources bucket;
 * tests use an in-memory fake. Implementations throw RepositoryError.
 */
export type ResearchWorkerRepository = {
  claimRuns(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedRun[]>;
  /** false = stop work: cancel requested, lease lost or the run is gone. */
  heartbeat(runId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  completeRun(
    runId: string,
    workerId: string,
    payload: CompletionPayload,
  ): Promise<CompletionStatus>;
  failRun(runId: string, workerId: string, failure: RunFailure): Promise<FailureStatus>;
  getRunSnapshot(run: Pick<ClaimedRun, "id" | "workspaceId">): Promise<RunSnapshot | null>;
  /** Scoped by BOTH workspace and lead id; null when the lead is not in that workspace. */
  getLead(workspaceId: string, leadId: string): Promise<LeadForResearch | null>;
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  /** Stores one gzip evidence object in the private research-sources bucket (idempotent). */
  uploadSource(path: string, body: Buffer): Promise<void>;
  removeSources(paths: string[]): Promise<void>;
  listPurgeCandidates(limit: number): Promise<PurgeCandidate[]>;
  markPurged(sourceIds: string[]): Promise<number>;
  listOrphanPaths(limit: number): Promise<string[]>;
};

/** Starts a recurring callback; returns the function that stops it. Injected for tests. */
export type Scheduler = (tick: () => Promise<void>, everyMs: number) => () => void;

export type FetcherFactory = (config: ResearchFetchConfig) => Pick<ResearchFetcher, "fetchPage">;

export type RunOutcome =
  | "completed"
  | "completed_with_warnings"
  | "cancelled"
  | "retry_scheduled"
  | "failed"
  /** This worker no longer holds the run; nothing was written. */
  | "lease_lost"
  /** The result of completing or failing the run could not be confirmed; the lease will expire. */
  | "unresolved";

export const WORKER_DEFAULTS = {
  batchSize: 3,
  leaseSeconds: 300,
  heartbeatMs: 30_000,
  crawlDeadlineMs: 120_000,
  maintenanceLimit: 200,
} as const;
