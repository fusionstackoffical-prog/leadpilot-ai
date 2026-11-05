// Test doubles for the research worker: an in-memory repository that mirrors the rules of the
// migration 009 worker functions, a manual heartbeat scheduler, and the real fetcher running on
// fake DNS/HTTP. Nothing here touches Supabase or the network.
import { DEFAULT_FETCH_LIMITS } from "../../src/features/research/engine/config.ts";
import {
  evidenceStoragePath,
  type CompletionPayload,
} from "../../src/features/research/engine/extract/payload.ts";
import { createResearchFetcher } from "../../src/features/research/engine/net/fetcher.ts";
import {
  RepositoryError,
  type ClaimedRun,
  type LeadForResearch,
  type PurgeCandidate,
  type ResearchWorkerRepository,
  type RunFailure,
  type RunStatus,
  type Scheduler,
} from "../../src/features/research/worker/types.ts";
import { ESTATE_ABOUT, ESTATE_CONTACT, ESTATE_HOME, ESTATE_LISTINGS } from "./extract-fixtures.ts";
import {
  fakeClock,
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  UA,
  type FakeRoute,
} from "./net-fakes.ts";

export const WS = "11111111-1111-4111-8111-111111111111";
export const OTHER_WS = "22222222-2222-4222-8222-222222222222";
export const USER = "33333333-3333-4333-8333-333333333333";

export type Fault =
  | "transient"
  | "lease_lost"
  | "not_found"
  | "invalid_result"
  | "storage_rejected"
  | "storage_transient"
  /** completeRun only: the database applies the completion, then the connection drops. */
  | "apply_then_transient";

export type FakeRun = {
  id: string;
  workspaceId: string;
  leadId: string;
  requestedBy: string | null;
  triggerSource: "manual" | "bulk" | "scheduled";
  status: RunStatus;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  cancelRequested: boolean;
  errorCode: string | null;
};

let counter = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/** In-memory repository. `inject(method, ...faults)` makes the next calls to a method fail. */
export function fakeRepo() {
  const runs = new Map<string, FakeRun>();
  const leads = new Map<string, LeadForResearch>();
  const members = new Set<string>();
  const storage = new Map<string, Buffer>();
  const completed = new Map<string, CompletionPayload>();
  const failures: { runId: string; failure: RunFailure }[] = [];
  const calls: string[] = [];
  const removed: string[][] = [];
  const marked: string[][] = [];
  const limits: Record<string, number> = {};
  const lists = { purge: [] as PurgeCandidate[], orphans: [] as string[] };
  const faults = new Map<string, Fault[]>();

  const nextFault = (method: string) => faults.get(method)?.shift();
  const raise = (fault: Fault): never => {
    const kind = fault === "apply_then_transient" ? "transient" : fault;
    throw new RepositoryError(kind, "fake failure");
  };
  const claimed = (r: FakeRun): ClaimedRun => ({
    id: r.id,
    workspaceId: r.workspaceId,
    leadId: r.leadId,
    requestedBy: r.requestedBy,
    triggerSource: r.triggerSource,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    cancelRequested: r.cancelRequested,
  });
  const holds = (r: FakeRun | undefined, workerId: string): r is FakeRun =>
    !!r && r.status === "running" && r.lockedBy === workerId;

  const repo: ResearchWorkerRepository = {
    async claimRuns(workerId, limit) {
      calls.push("claimRuns");
      const f = nextFault("claimRuns");
      if (f) raise(f);
      const out: ClaimedRun[] = [];
      for (const r of runs.values()) {
        if (out.length >= limit) break;
        if (r.status !== "queued") continue;
        r.status = "running";
        r.attempts += 1;
        r.lockedBy = workerId;
        out.push(claimed(r));
      }
      return out;
    },

    async heartbeat(runId, workerId) {
      calls.push("heartbeat");
      const f = nextFault("heartbeat");
      if (f) raise(f);
      const r = runs.get(runId);
      return holds(r, workerId) && !r.cancelRequested;
    },

    async completeRun(runId, workerId, payload) {
      calls.push("completeRun");
      const f = nextFault("completeRun");
      const apply = () => {
        const r = runs.get(runId);
        if (!r) throw new RepositoryError("not_found", "fake");
        if (!holds(r, workerId)) throw new RepositoryError("lease_lost", "fake");
        if (r.cancelRequested) {
          r.status = "cancelled";
          r.lockedBy = null;
          return "cancelled" as const;
        }
        // Migration 009: every source text must already be in storage.
        for (const s of payload.sources) {
          const path = evidenceStoragePath(
            { workspaceId: r.workspaceId, leadId: r.leadId, runId: r.id },
            s.text.sha256,
          );
          if (!storage.has(path)) throw new RepositoryError("invalid_result", "fake");
        }
        r.status = payload.warnings.length > 0 ? "completed_with_warnings" : "completed";
        r.lockedBy = null;
        completed.set(r.id, payload);
        return r.status as "completed" | "completed_with_warnings";
      };
      if (f === "apply_then_transient") {
        apply();
        return raise(f);
      }
      if (f) raise(f);
      return apply();
    },

    async failRun(runId, workerId, failure) {
      calls.push("failRun");
      const f = nextFault("failRun");
      if (f) raise(f);
      const r = runs.get(runId);
      if (!r) throw new RepositoryError("not_found", "fake");
      if (!holds(r, workerId)) throw new RepositoryError("lease_lost", "fake");
      failures.push({ runId, failure });
      r.lockedBy = null;
      r.errorCode = failure.code;
      if (r.cancelRequested) {
        r.status = "cancelled";
        return "cancelled";
      }
      if (failure.retryable && r.attempts < r.maxAttempts) {
        r.status = "queued";
        return "queued";
      }
      r.status = "failed";
      return "failed";
    },

    async getRunSnapshot(run) {
      calls.push("getRunSnapshot");
      const f = nextFault("getRunSnapshot");
      if (f) raise(f);
      const r = runs.get(run.id);
      if (!r || r.workspaceId !== run.workspaceId) return null;
      return { status: r.status, lockedBy: r.lockedBy, cancelRequested: r.cancelRequested };
    },

    async getLead(workspaceId, leadId) {
      calls.push("getLead");
      const f = nextFault("getLead");
      if (f) raise(f);
      return leads.get(`${workspaceId}/${leadId}`) ?? null;
    },

    async isWorkspaceMember(workspaceId, userId) {
      calls.push("isWorkspaceMember");
      const f = nextFault("isWorkspaceMember");
      if (f) raise(f);
      return members.has(`${workspaceId}/${userId}`);
    },

    async uploadSource(path, body) {
      calls.push("uploadSource");
      const f = nextFault("uploadSource");
      if (f) raise(f);
      storage.set(path, body);
    },

    async removeSources(paths) {
      calls.push("removeSources");
      const f = nextFault("removeSources");
      if (f) raise(f);
      removed.push(paths);
      for (const p of paths) storage.delete(p);
    },

    async listPurgeCandidates(limit) {
      calls.push("listPurgeCandidates");
      limits.purge = limit;
      const f = nextFault("listPurgeCandidates");
      if (f) raise(f);
      return lists.purge.slice(0, limit);
    },

    async markPurged(ids) {
      calls.push("markPurged");
      const f = nextFault("markPurged");
      if (f) raise(f);
      marked.push(ids);
      return ids.length;
    },

    async listOrphanPaths(limit) {
      calls.push("listOrphanPaths");
      limits.orphans = limit;
      const f = nextFault("listOrphanPaths");
      if (f) raise(f);
      return lists.orphans.slice(0, limit);
    },
  };

  /** Adds a queued run with a researchable lead and a member requester. */
  function seed(
    options: {
      workspaceId?: string;
      website?: string | null;
      suppressed?: boolean;
      requestedBy?: string | null;
      triggerSource?: FakeRun["triggerSource"];
      maxAttempts?: number;
      member?: boolean;
      lead?: boolean;
    } = {},
  ) {
    const workspaceId = options.workspaceId ?? WS;
    const leadId = uuid();
    const requestedBy = options.requestedBy === undefined ? USER : options.requestedBy;
    if (options.lead !== false) {
      leads.set(`${workspaceId}/${leadId}`, {
        id: leadId,
        workspaceId,
        companyName: "Prime Realty",
        website: options.website === undefined ? "primerealty.ae" : options.website,
        suppressed: options.suppressed ?? false,
      });
    }
    if (requestedBy && options.member !== false) members.add(`${workspaceId}/${requestedBy}`);
    const run: FakeRun = {
      id: uuid(),
      workspaceId,
      leadId,
      requestedBy,
      triggerSource: options.triggerSource ?? "manual",
      status: "queued",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      lockedBy: null,
      cancelRequested: false,
      errorCode: null,
    };
    runs.set(run.id, run);
    return run;
  }

  /** Claims a run the way the database would, and returns it as the worker sees it. */
  async function claim(workerId: string, run: FakeRun) {
    const got = await repo.claimRuns(workerId, 100, 300);
    calls.length = 0; // tests assert only on what happens after the claim
    const mine = got.find((r) => r.id === run.id);
    if (!mine) throw new Error("run was not claimable");
    return mine;
  }

  return {
    repo,
    runs,
    leads,
    members,
    storage,
    completed,
    failures,
    calls,
    removed,
    marked,
    limits,
    lists,
    seed,
    claim,
    inject(method: string, ...f: Fault[]) {
      faults.set(method, [...(faults.get(method) ?? []), ...f]);
    },
    /** Another worker takes over the run (the lease expired and the run was reclaimed). */
    stealLease(runId: string) {
      runs.get(runId)!.lockedBy = "another-worker";
    },
    requestCancel(runId: string) {
      runs.get(runId)!.cancelRequested = true;
    },
  };
}

/** A heartbeat timer the test drives by hand. */
export function manualScheduler() {
  const active = new Set<() => Promise<void>>();
  const schedule: Scheduler = (tick) => {
    active.add(tick);
    return () => {
      active.delete(tick);
    };
  };
  return {
    schedule,
    tick: async () => {
      for (const t of [...active]) await t();
    },
    active: () => active.size,
  };
}

export const noSleep = async () => {};

const robotsAllowAll: FakeRoute = {
  body: "User-agent: *\nAllow: /\n",
  headers: { "content-type": "text/plain" },
};

/** The Phase 3B "Prime Realty" site, served from fake HTTP. */
export const ESTATE_SITE: Record<string, FakeRoute> = {
  "primerealty.ae/robots.txt": robotsAllowAll,
  "primerealty.ae/": { body: ESTATE_HOME },
  "primerealty.ae/listings": { body: ESTATE_LISTINGS },
  "primerealty.ae/about": { body: ESTATE_ABOUT },
  "primerealty.ae/contact-us": { body: ESTATE_CONTACT },
};

/** The real Phase 3A fetcher over fake DNS and HTTP. */
export function realFetcher(routes: Record<string, FakeRoute> = ESTATE_SITE) {
  const dns = fakeResolver({ "primerealty.ae": [PUBLIC_V4] });
  const net = fakeTransport(routes);
  const fetcher = createResearchFetcher({
    config: {
      ...DEFAULT_FETCH_LIMITS,
      contactUrl: "https://leadpilot.example.com/bot",
      userAgent: UA,
    },
    resolver: dns.resolver,
    transport: net.transport,
    clock: fakeClock().clock,
  });
  return { fetcher, net, dns };
}

export const TEST_CONFIG = {
  ...DEFAULT_FETCH_LIMITS,
  contactUrl: "https://leadpilot.example.com/bot",
  userAgent: UA,
};
