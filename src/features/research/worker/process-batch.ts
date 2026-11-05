import { ResearchConfigError, type ResearchFetchConfig } from "../engine/config.ts";
import { emit, reportOnce, type WorkerLogger } from "./log.ts";
import { runMaintenance, type MaintenanceResult } from "./maintenance.ts";
import { processRun, type ProcessRunDeps } from "./process-run.ts";
import {
  WORKER_DEFAULTS,
  type FetcherFactory,
  type ResearchWorkerRepository,
  type RunOutcome,
} from "./types.ts";

export type BatchDeps = {
  /** Throws ResearchConfigError when research is not configured. Checked BEFORE any claim. */
  loadConfig: () => ResearchFetchConfig;
  createFetcher: FetcherFactory;
  /** Throws ResearchConfigError when the server-side database credentials are missing. */
  createRepository: () => ResearchWorkerRepository;
  /** A fresh id per call: a stale worker can never be mistaken for the current one. */
  newWorkerId: () => string;
  now?: () => Date;
  batchSize?: number;
  /** Receives fixed, detail-free infrastructure messages (see log.ts). Optional. */
  log?: WorkerLogger;
} & Pick<ProcessRunDeps, "schedule" | "sleep" | "leaseSeconds" | "heartbeatMs" | "crawlDeadlineMs">;

export type OutcomeCounts = Record<RunOutcome | "error", number>;

export type BatchResult =
  | { status: "not_configured" }
  | {
      status: "ok";
      claimed: number;
      outcomes: OutcomeCounts;
      maintenance: MaintenanceResult;
    };

export function emptyOutcomeCounts(): OutcomeCounts {
  return {
    completed: 0,
    completed_with_warnings: 0,
    cancelled: 0,
    retry_scheduled: 0,
    failed: 0,
    lease_lost: 0,
    unresolved: 0,
    error: 0,
  };
}

/**
 * One worker invocation: validate configuration, claim queued runs, research them in parallel
 * (each in isolation) and finish with housekeeping.
 *
 * If research is not configured nothing is claimed and nothing is touched, so queued runs wait
 * (they are never failed because of a missing setting). Errors while claiming propagate to the
 * caller; errors inside one run never affect the others.
 */
export async function runResearchBatch(deps: BatchDeps): Promise<BatchResult> {
  // Everything the worker needs is validated before the first database call: research settings
  // and the server-side database credentials. Failing here claims nothing.
  let config: ResearchFetchConfig;
  let repo: ResearchWorkerRepository;
  try {
    config = deps.loadConfig();
    repo = deps.createRepository();
  } catch (error) {
    if (error instanceof ResearchConfigError) {
      emit(deps.log, "research_not_configured");
      return { status: "not_configured" };
    }
    throw error;
  }

  const fetcher = deps.createFetcher(config); // shared: one rate limiter for the whole batch
  const workerId = deps.newWorkerId();

  let runs: Awaited<ReturnType<typeof repo.claimRuns>>;
  try {
    runs = await repo.claimRuns(
      workerId,
      deps.batchSize ?? WORKER_DEFAULTS.batchSize,
      deps.leaseSeconds ?? WORKER_DEFAULTS.leaseSeconds,
    );
  } catch (error) {
    // Reported here, where it happened; the HTTP handler will not log the same error again.
    reportOnce(deps.log, "claim_failed", error);
    throw error;
  }

  const outcomes = emptyOutcomeCounts();
  const settled = await Promise.all(
    runs.map((run) =>
      processRun(run, {
        repo,
        fetcher,
        workerId,
        now: deps.now,
        schedule: deps.schedule,
        sleep: deps.sleep,
        leaseSeconds: deps.leaseSeconds,
        heartbeatMs: deps.heartbeatMs,
        crawlDeadlineMs: deps.crawlDeadlineMs,
      }).catch((error): RunOutcome | "error" => {
        reportOnce(deps.log, "run_crashed", error);
        return "error";
      }),
    ),
  );
  for (const outcome of settled) {
    outcomes[outcome]++;
    if (outcome === "unresolved") emit(deps.log, "run_unresolved");
  }

  const maintenance = await runMaintenance(repo, WORKER_DEFAULTS.maintenanceLimit, deps.log);
  return { status: "ok", claimed: runs.length, outcomes, maintenance };
}
