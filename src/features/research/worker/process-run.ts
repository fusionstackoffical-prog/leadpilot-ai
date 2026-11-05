import { researchCompanyWebsite } from "../engine/extract/extract.ts";
import {
  buildCompletionPayload,
  evidenceStoragePath,
  type CompletionPayload,
} from "../engine/extract/payload.ts";
import type { ResearchFetcher } from "../engine/net/fetcher.ts";
import { classifyRunFailure, RunRejectedError } from "./classify.ts";
import {
  RepositoryError,
  WORKER_DEFAULTS,
  type ClaimedRun,
  type ResearchWorkerRepository,
  type RunFailure,
  type RunOutcome,
  type Scheduler,
} from "./types.ts";

export type ProcessRunDeps = {
  repo: ResearchWorkerRepository;
  /** One fetcher is shared by a whole batch so the per-host rate limit holds across runs. */
  fetcher: Pick<ResearchFetcher, "fetchPage">;
  workerId: string;
  now?: () => Date;
  schedule?: Scheduler;
  sleep?: (ms: number) => Promise<void>;
  leaseSeconds?: number;
  heartbeatMs?: number;
  crawlDeadlineMs?: number;
};

/** How many times a completion that may or may not have been applied is re-attempted. */
const MAX_COMPLETE_ATTEMPTS = 3;
const COMPLETE_RETRY_DELAY_MS = 1_000;

export const intervalScheduler: Scheduler = (tick, everyMs) => {
  const timer = setInterval(() => {
    void tick();
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Researches one claimed run and records exactly one outcome, never throwing.
 *
 *  1. Re-checks that the lead belongs to the run's workspace, is not suppressed, has a website
 *     and that the requester is still a member.
 *  2. Crawls and extracts through the Phase 3A fetcher and Phase 3B engine while heartbeating.
 *  3. Uploads the evidence text to the private bucket BEFORE completing the run.
 *  4. Completes atomically; an uncertain completion is resolved by re-reading the run.
 *
 * Whenever the heartbeat reports the run is no longer ours (cancelled, lease lost) the crawl is
 * aborted. A cancellation is recorded through the failure function (the database turns it into
 * "cancelled"); a lost lease is left alone because another worker now owns the run.
 */
export async function processRun(run: ClaimedRun, deps: ProcessRunDeps): Promise<RunOutcome> {
  const { repo, fetcher, workerId } = deps;
  const leaseSeconds = deps.leaseSeconds ?? WORKER_DEFAULTS.leaseSeconds;
  const heartbeatMs = deps.heartbeatMs ?? WORKER_DEFAULTS.heartbeatMs;
  const crawlDeadlineMs = deps.crawlDeadlineMs ?? WORKER_DEFAULTS.crawlDeadlineMs;
  const schedule = deps.schedule ?? intervalScheduler;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => new Date());

  const abort = new AbortController();
  let stopped = false;
  let beating = false;

  /** false = the run is no longer ours to work on; the crawl has been aborted. */
  const beat = async (): Promise<boolean> => {
    if (stopped) return false;
    if (beating) return true;
    beating = true;
    try {
      const ok = await repo.heartbeat(run.id, workerId, leaseSeconds);
      if (!ok) {
        stopped = true;
        abort.abort();
      }
      return ok;
    } catch {
      // The lease is long compared with the heartbeat interval, so one failed beat is not fatal.
      // If it stays down, the database rejects the completion because the lease expired.
      return true;
    } finally {
      beating = false;
    }
  };

  const recordFailure = async (failure: RunFailure): Promise<RunOutcome> => {
    try {
      const status = await repo.failRun(run.id, workerId, failure);
      return status === "queued" ? "retry_scheduled" : status;
    } catch (error) {
      if (
        error instanceof RepositoryError &&
        (error.kind === "lease_lost" || error.kind === "not_found")
      ) {
        return "lease_lost";
      }
      return "unresolved";
    }
  };

  /** The heartbeat said stop: record a cancellation if one was requested, else leave the run. */
  const settleStopped = async (): Promise<RunOutcome> => {
    let snapshot;
    try {
      snapshot = await repo.getRunSnapshot(run);
    } catch {
      return "unresolved";
    }
    if (
      snapshot &&
      snapshot.status === "running" &&
      snapshot.lockedBy === workerId &&
      snapshot.cancelRequested
    ) {
      return recordFailure({
        code: "cancelled",
        message: "Cancelled while running.",
        retryable: false,
      });
    }
    return "lease_lost";
  };

  /** The finished status of this run if it is already finished, else null. */
  const finishedStatus = async (): Promise<RunOutcome | null> => {
    try {
      const snapshot = await repo.getRunSnapshot(run);
      if (
        snapshot &&
        (snapshot.status === "completed" ||
          snapshot.status === "completed_with_warnings" ||
          snapshot.status === "cancelled")
      ) {
        return snapshot.status;
      }
    } catch {
      // Unknown; the caller treats this like "not finished".
    }
    return null;
  };

  /**
   * Completes the run. If the call fails in a way that leaves its outcome unknown (a dropped
   * connection after the database may already have committed), the run is re-read: finished
   * means success, still ours means the call did not happen and is repeated, anything else
   * means the run is no longer ours.
   */
  const complete = async (payload: CompletionPayload): Promise<RunOutcome> => {
    for (let attempt = 1; attempt <= MAX_COMPLETE_ATTEMPTS; attempt++) {
      try {
        return await repo.completeRun(run.id, workerId, payload);
      } catch (error) {
        if (!(error instanceof RepositoryError)) throw error;
        if (error.kind === "lease_lost" || error.kind === "not_found") {
          // After an earlier uncertain attempt this can mean "our first call did commit".
          return (await finishedStatus()) ?? "lease_lost";
        }
        if (error.kind !== "transient") throw error;

        let snapshot;
        try {
          snapshot = await repo.getRunSnapshot(run);
        } catch {
          await sleep(COMPLETE_RETRY_DELAY_MS);
          continue;
        }
        if (!snapshot) return "lease_lost";
        if (snapshot.status === "completed" || snapshot.status === "completed_with_warnings") {
          return snapshot.status;
        }
        if (snapshot.status === "cancelled") return "cancelled";
        if (snapshot.status === "running" && snapshot.lockedBy === workerId) {
          await sleep(COMPLETE_RETRY_DELAY_MS);
          continue;
        }
        return "lease_lost";
      }
    }
    return "unresolved";
  };

  const stopHeartbeat = schedule(async () => {
    await beat();
  }, heartbeatMs);

  try {
    if (run.cancelRequested) return await settleStopped();

    const lead = await requireResearchableLead(run, repo);
    const { pages, extraction } = await researchCompanyWebsite(
      lead.website,
      fetcher,
      { companyName: lead.companyName },
      { signal: abort.signal, deadlineMs: crawlDeadlineMs, now },
    );
    if (stopped) return await settleStopped();

    const { payload, uploads } = buildCompletionPayload(pages, extraction);

    if (!(await beat())) return await settleStopped();
    // Evidence goes to storage first: migration 009 refuses to complete a run whose source
    // text is not already stored, and a stored but unreferenced upload is cleaned up later.
    for (const upload of uploads) {
      if (stopped) return await settleStopped();
      await repo.uploadSource(
        evidenceStoragePath(
          { workspaceId: run.workspaceId, leadId: run.leadId, runId: run.id },
          upload.sha256,
        ),
        upload.body,
      );
    }

    if (!(await beat())) return await settleStopped();
    return await complete(payload);
  } catch (error) {
    if (error instanceof RepositoryError && error.kind === "lease_lost") return "lease_lost";
    // Aborting the crawl surfaces as an error; the heartbeat verdict explains it.
    if (stopped) return await settleStopped();
    return await recordFailure(classifyRunFailure(error));
  } finally {
    stopHeartbeat();
  }
}

/**
 * Verifies, with fresh reads, that this run may be researched. The lead is looked up by BOTH
 * the run's workspace and lead id, so a run can never process another workspace's company.
 */
async function requireResearchableLead(run: ClaimedRun, repo: ResearchWorkerRepository) {
  const lead = await repo.getLead(run.workspaceId, run.leadId);
  if (!lead || lead.id !== run.leadId || lead.workspaceId !== run.workspaceId) {
    throw new RunRejectedError("lead_not_found", "The company no longer exists in this workspace.");
  }
  if (lead.suppressed) {
    throw new RunRejectedError(
      "lead_suppressed",
      "The company is suppressed and cannot be researched.",
    );
  }

  if (run.requestedBy !== null) {
    if (!(await repo.isWorkspaceMember(run.workspaceId, run.requestedBy))) {
      throw new RunRejectedError(
        "requester_not_authorized",
        "The person who requested this research is no longer a member of the workspace.",
      );
    }
  } else if (run.triggerSource !== "scheduled") {
    // A person asked for this run but their account no longer exists.
    throw new RunRejectedError(
      "requester_not_authorized",
      "The person who requested this research no longer has access.",
    );
  }

  const website = lead.website?.trim();
  if (!website) {
    throw new RunRejectedError("no_website", "The company has no website to research.");
  }
  return { companyName: lead.companyName, website };
}
