// processRun with an in-memory repository (mirroring migration 009's rules) and the real Phase 3A
// fetcher on fake DNS/HTTP. No Supabase, no real network, no real company.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import { evidenceStoragePath } from "../../src/features/research/engine/extract/payload.ts";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import type {
  FetchPageOptions,
  ResearchFetcher,
} from "../../src/features/research/engine/net/fetcher.ts";
import type { SafeFetchResult } from "../../src/features/research/engine/net/safe-fetch.ts";
import { processRun } from "../../src/features/research/worker/process-run.ts";
import {
  RepositoryError,
  type ResearchWorkerRepository,
} from "../../src/features/research/worker/types.ts";
import {
  ESTATE_SITE,
  fakeRepo,
  manualScheduler,
  noSleep,
  OTHER_WS,
  realFetcher,
} from "./worker-fakes.ts";
import { PUBLIC_V4 } from "./net-fakes.ts";

type Fetcher = Pick<ResearchFetcher, "fetchPage">;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A fetcher whose request never answers until the crawl aborts it. */
function hangingFetcher(started: () => void): Fetcher {
  return {
    fetchPage: (_url, options?: FetchPageOptions) =>
      new Promise<SafeFetchResult>((_resolve, reject) => {
        started();
        options?.signal?.addEventListener("abort", () =>
          reject(new ResearchFetchError("cancelled", "The request was cancelled")),
        );
      }),
  };
}

async function setup(
  seedOptions: Parameters<ReturnType<typeof fakeRepo>["seed"]>[0] = {},
  routes = ESTATE_SITE,
) {
  const world = fakeRepo();
  const seeded = world.seed(seedOptions);
  const sched = manualScheduler();
  const site = realFetcher(routes);
  const claimed = await world.claim("worker-A", seeded);
  const sleeps: number[] = [];
  const go = (
    overrides: { repo?: ResearchWorkerRepository; fetcher?: Fetcher; workerId?: string } = {},
  ) =>
    processRun(claimed, {
      repo: overrides.repo ?? world.repo,
      fetcher: overrides.fetcher ?? site.fetcher,
      workerId: overrides.workerId ?? "worker-A",
      schedule: sched.schedule,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
  return { world, seeded, sched, site, claimed, go, sleeps };
}

const isCompleted = (o: string) => o === "completed" || o === "completed_with_warnings";

describe("processRun: success", () => {
  it("researches the site, uploads the evidence, then completes the run", async () => {
    const t = await setup();
    const outcome = await t.go();
    assert.ok(isCompleted(outcome), outcome);
    assert.equal(t.seeded.status, outcome);

    // Ownership is checked before anything is fetched.
    assert.deepEqual(t.world.calls.slice(0, 2), ["getLead", "isWorkspaceMember"]);

    // Evidence is uploaded BEFORE the run is completed, at the path migration 009 derives.
    const firstUpload = t.world.calls.indexOf("uploadSource");
    const complete = t.world.calls.indexOf("completeRun");
    assert.ok(firstUpload > 0 && firstUpload < complete);
    const payload = t.world.completed.get(t.seeded.id)!;
    assert.equal(payload.sources.length, 4);
    assert.equal(t.world.calls.filter((c) => c === "uploadSource").length, 4);
    for (const source of payload.sources) {
      const path = evidenceStoragePath(
        { workspaceId: t.seeded.workspaceId, leadId: t.seeded.leadId, runId: t.seeded.id },
        source.text.sha256,
      );
      const stored = t.world.storage.get(path);
      assert.ok(stored, `uploaded ${path}`);
      assert.match(gunzipSync(stored).toString("utf8"), /^URL: https:\/\/primerealty\.ae\//);
    }

    // The findings come from the Phase 3B engine, backed by those sources.
    assert.ok(
      payload.findings.some(
        (f) => f.category === "contact_email" && f.value_text === "info@primerealty.ae",
      ),
    );
    // Only the company's own website was contacted.
    assert.ok(t.site.net.requests.every((r) => r.url.hostname === "primerealty.ae"));
    // The heartbeat timer is always stopped.
    assert.equal(t.sched.active(), 0);
  });

  it("starts the heartbeat while working and stops it afterwards", async () => {
    const t = await setup();
    const started = deferred();
    const finish = deferred();
    const fetcher: Fetcher = {
      fetchPage: async (url, options) => {
        started.resolve();
        await finish.promise;
        return t.site.fetcher.fetchPage(url, options);
      },
    };
    const pending = t.go({ fetcher });
    await started.promise;
    assert.equal(t.sched.active(), 1);
    await t.sched.tick();
    assert.ok(t.world.calls.includes("heartbeat"));
    finish.resolve();
    assert.ok(isCompleted(await pending));
    assert.equal(t.sched.active(), 0);
  });

  it("keeps working when a single heartbeat fails (the lease is much longer)", async () => {
    const t = await setup();
    t.world.inject("heartbeat", "transient", "transient");
    assert.ok(isCompleted(await t.go()));
  });

  it("lets a scheduled run (no requester) proceed", async () => {
    const t = await setup({ requestedBy: null, triggerSource: "scheduled" });
    assert.ok(isCompleted(await t.go()));
    assert.equal(t.world.calls.includes("isWorkspaceMember"), false);
  });
});

describe("processRun: ownership and eligibility (nothing is fetched on rejection)", () => {
  async function rejected(
    seed: Parameters<ReturnType<typeof fakeRepo>["seed"]>[0],
    code: string,
    prepare?: (t: Awaited<ReturnType<typeof setup>>) => void,
  ) {
    const t = await setup(seed);
    prepare?.(t);
    assert.equal(await t.go(), "failed");
    assert.equal(t.world.failures.length, 1);
    assert.equal(t.world.failures[0].failure.code, code);
    assert.equal(t.world.failures[0].failure.retryable, false);
    assert.equal(t.seeded.status, "failed");
    assert.equal(t.site.net.requests.length, 0, "no website was contacted");
    assert.equal(t.site.dns.calls.length, 0);
    assert.equal(t.world.calls.includes("uploadSource"), false);
    assert.equal(t.sched.active(), 0);
  }

  it("rejects a lead that is not in the run's workspace", () =>
    rejected({ lead: false }, "lead_not_found", (t) => {
      // The lead exists, but in another workspace.
      t.world.leads.set(`${OTHER_WS}/${t.seeded.leadId}`, {
        id: t.seeded.leadId,
        workspaceId: OTHER_WS,
        companyName: "Someone Else",
        website: "primerealty.ae",
        suppressed: false,
      });
    }));

  it("rejects a lead that no longer exists", () => rejected({ lead: false }, "lead_not_found"));
  it("rejects a suppressed lead", () => rejected({ suppressed: true }, "lead_suppressed"));
  it("rejects a lead without a website", () => rejected({ website: null }, "no_website"));
  it("rejects a blank website", () => rejected({ website: "   " }, "no_website"));

  it("rejects a run whose requester was removed from the workspace", () =>
    rejected({ member: false }, "requester_not_authorized"));

  it("rejects a person-requested run whose requester account is gone", () =>
    rejected({ requestedBy: null, triggerSource: "manual" }, "requester_not_authorized"));

  it("treats an unreachable database during the checks as retryable", async () => {
    const t = await setup();
    t.world.inject("getLead", "transient");
    assert.equal(await t.go(), "retry_scheduled");
    assert.equal(t.world.failures[0].failure.code, "database_unavailable");
    assert.equal(t.world.failures[0].failure.retryable, true);
    assert.equal(t.site.net.requests.length, 0);
  });
});

describe("processRun: failures and retries", () => {
  it("schedules a retry for a temporary website failure", async () => {
    const t = await setup({}, { ...ESTATE_SITE, "primerealty.ae/": { status: 503 } });
    assert.equal(await t.go(), "retry_scheduled");
    assert.equal(t.world.failures[0].failure.code, "http_status");
    assert.equal(t.world.failures[0].failure.retryable, true);
    assert.equal(t.seeded.status, "queued");
    assert.equal(t.world.calls.includes("uploadSource"), false);
    assert.equal(t.world.calls.includes("completeRun"), false);
  });

  it("gives up once the attempts are used up", async () => {
    const t = await setup(
      { maxAttempts: 1 },
      { ...ESTATE_SITE, "primerealty.ae/": { status: 503 } },
    );
    assert.equal(await t.go(), "failed");
    assert.equal(t.seeded.status, "failed");
  });

  it("succeeds on a later attempt of the same run", async () => {
    const t = await setup({}, { ...ESTATE_SITE, "primerealty.ae/": { status: 503 } });
    assert.equal(await t.go(), "retry_scheduled");
    // The database re-queues the SAME run; a worker claims it again as attempt 2.
    const again = await t.world.claim("worker-B", t.seeded);
    assert.equal(again.attempts, 2);
    const sched = manualScheduler();
    const outcome = await processRun(again, {
      repo: t.world.repo,
      fetcher: realFetcher(ESTATE_SITE).fetcher,
      workerId: "worker-B",
      schedule: sched.schedule,
      sleep: noSleep,
    });
    assert.ok(isCompleted(outcome));
    assert.equal(t.world.runs.size, 1, "no second run was created");
  });

  it("records a permanent website failure without retrying", async () => {
    const t = await setup({ website: "no-such-company.example" });
    assert.equal(await t.go(), "failed");
    const { code, retryable } = t.world.failures[0].failure;
    assert.equal(code, "dns_not_found");
    assert.equal(retryable, new ResearchFetchError("dns_not_found", "x").retryable);
  });

  it("records an unreadable home page as a permanent extraction failure", async () => {
    const t = await setup();
    const unreadable = (url: string) =>
      ({
        url,
        status: 200,
        contentType: "text/html",
        charset: "utf-8",
        truncated: false,
        redirects: [],
        remoteAddress: PUBLIC_V4,
        headers: {},
        get body(): Buffer {
          throw new RangeError("Maximum call stack size exceeded");
        },
      }) as SafeFetchResult;
    const outcome = await t.go({
      fetcher: { fetchPage: async (u) => unreadable(new URL(u).href) },
    });
    assert.equal(outcome, "failed");
    assert.equal(t.world.failures[0].failure.code, "page_unparseable");
    assert.equal(t.world.failures[0].failure.retryable, false);
  });

  it("never copies a raw error message into the stored failure", async () => {
    const t = await setup();
    const outcome = await t.go({
      fetcher: {
        fetchPage: async () => {
          throw new Error("password=hunter2 at postgres://internal-host/db");
        },
      },
    });
    assert.equal(outcome, "retry_scheduled");
    const { code, message } = t.world.failures[0].failure;
    assert.equal(code, "connection_failed"); // the generic 3A fallback for an unknown error
    assert.doesNotMatch(message, /hunter2|postgres|internal-host/);
  });

  it("does not throw when recording the failure fails: the lease will expire", async () => {
    const t = await setup({}, { ...ESTATE_SITE, "primerealty.ae/": { status: 503 } });
    t.world.inject("failRun", "transient");
    assert.equal(await t.go(), "unresolved");
    assert.equal(t.sched.active(), 0);
  });
});

describe("processRun: storage and database rejections", () => {
  it("does not complete the run when an upload fails; the failure is retryable", async () => {
    const t = await setup();
    t.world.inject("uploadSource", "storage_transient");
    assert.equal(await t.go(), "retry_scheduled");
    assert.equal(t.world.failures[0].failure.code, "storage_upload_failed");
    assert.equal(t.world.failures[0].failure.retryable, true);
    assert.equal(t.world.calls.includes("completeRun"), false);
    assert.equal(t.seeded.status, "queued");
  });

  it("does not complete the run when a later upload fails (earlier ones are orphans to sweep)", async () => {
    const t = await setup();
    // First upload succeeds, the second one fails.
    const original = t.world.repo.uploadSource;
    let n = 0;
    const repo: ResearchWorkerRepository = {
      ...t.world.repo,
      async uploadSource(path, body) {
        if (++n === 2) throw new RepositoryError("storage_transient", "x");
        return original(path, body);
      },
    };
    assert.equal(await t.go({ repo }), "retry_scheduled");
    assert.equal(t.world.storage.size, 1);
    assert.equal(t.world.calls.includes("completeRun"), false);
  });

  it("fails permanently when storage refuses the object", async () => {
    const t = await setup();
    t.world.inject("uploadSource", "storage_rejected");
    assert.equal(await t.go(), "failed");
    assert.equal(t.world.failures[0].failure.code, "storage_rejected");
    assert.equal(t.world.failures[0].failure.retryable, false);
  });

  it("fails permanently when the database rejects the results", async () => {
    const t = await setup();
    t.world.inject("completeRun", "invalid_result");
    assert.equal(await t.go(), "failed");
    assert.equal(t.world.failures[0].failure.code, "results_rejected");
    assert.equal(t.world.failures[0].failure.retryable, false);
  });
});

describe("processRun: cancellation", () => {
  it("records a cancellation requested before the work started, without fetching", async () => {
    const world = fakeRepo();
    const seeded = world.seed();
    world.requestCancel(seeded.id);
    const claimed = await world.claim("worker-A", seeded);
    const site = realFetcher();
    const sched = manualScheduler();
    const outcome = await processRun(claimed, {
      repo: world.repo,
      fetcher: site.fetcher,
      workerId: "worker-A",
      schedule: sched.schedule,
      sleep: noSleep,
    });
    assert.equal(outcome, "cancelled");
    assert.equal(seeded.status, "cancelled");
    assert.equal(world.failures[0].failure.code, "cancelled");
    assert.equal(world.failures[0].failure.retryable, false);
    assert.equal(site.net.requests.length, 0);
    assert.equal(sched.active(), 0);
  });

  it("stops the crawl when a cancellation is seen by the heartbeat", async () => {
    const t = await setup();
    const started = deferred();
    const pending = t.go({ fetcher: hangingFetcher(started.resolve) });
    await started.promise;
    t.world.requestCancel(t.seeded.id);
    await t.sched.tick();
    assert.equal(await pending, "cancelled");
    assert.equal(t.seeded.status, "cancelled");
    assert.equal(t.world.calls.includes("uploadSource"), false);
    assert.equal(t.world.calls.includes("completeRun"), false);
    assert.equal(t.sched.active(), 0);
  });

  it("does not complete when a cancellation arrives during the uploads", async () => {
    const t = await setup();
    const repo: ResearchWorkerRepository = {
      ...t.world.repo,
      async uploadSource(path, body) {
        t.world.requestCancel(t.seeded.id);
        return t.world.repo.uploadSource(path, body);
      },
    };
    assert.equal(await t.go({ repo }), "cancelled");
    assert.equal(t.world.calls.includes("completeRun"), false);
    assert.equal(t.seeded.status, "cancelled");
  });

  it("reports the database's answer when a cancellation lands just before completion", async () => {
    const t = await setup();
    const repo: ResearchWorkerRepository = {
      ...t.world.repo,
      async completeRun(runId, workerId, payload) {
        t.world.requestCancel(t.seeded.id);
        return t.world.repo.completeRun(runId, workerId, payload);
      },
    };
    assert.equal(await t.go({ repo }), "cancelled");
    assert.equal(t.world.completed.size, 0);
  });
});

describe("processRun: lease loss (nothing is written once the run is not ours)", () => {
  const noWrites = (t: Awaited<ReturnType<typeof setup>>) => {
    assert.equal(t.world.calls.includes("failRun"), false);
    assert.equal(t.world.calls.includes("completeRun"), false);
    assert.equal(t.sched.active(), 0);
  };

  it("stops the crawl when the heartbeat reports the lease was lost", async () => {
    const t = await setup();
    const started = deferred();
    const pending = t.go({ fetcher: hangingFetcher(started.resolve) });
    await started.promise;
    t.world.stealLease(t.seeded.id);
    await t.sched.tick();
    assert.equal(await pending, "lease_lost");
    noWrites(t);
    assert.equal(t.seeded.lockedBy, "another-worker", "the new owner is untouched");
  });

  it("stops before completing when the lease is lost during the uploads", async () => {
    const t = await setup();
    const repo: ResearchWorkerRepository = {
      ...t.world.repo,
      async uploadSource(path, body) {
        t.world.stealLease(t.seeded.id);
        return t.world.repo.uploadSource(path, body);
      },
    };
    assert.equal(await t.go({ repo }), "lease_lost");
    noWrites(t);
  });

  it("accepts the database's lease-lost answer when completing", async () => {
    const t = await setup();
    t.world.inject("completeRun", "lease_lost");
    assert.equal(await t.go(), "lease_lost");
    assert.equal(t.world.calls.includes("failRun"), false);
  });

  it("does not record a failure for a run it no longer holds", async () => {
    const t = await setup({}, { ...ESTATE_SITE, "primerealty.ae/": { status: 503 } });
    t.world.inject("failRun", "lease_lost");
    assert.equal(await t.go(), "lease_lost");
  });
});

describe("processRun: ambiguous completion", () => {
  it("treats a completion that was applied before the connection dropped as success", async () => {
    const t = await setup();
    t.world.inject("completeRun", "apply_then_transient");
    assert.ok(isCompleted(await t.go()));
    assert.equal(t.world.calls.filter((c) => c === "completeRun").length, 1, "not repeated");
    assert.equal(t.world.calls.includes("failRun"), false);
    assert.ok(t.world.completed.has(t.seeded.id));
  });

  it("repeats a completion that was not applied", async () => {
    const t = await setup();
    t.world.inject("completeRun", "transient");
    assert.ok(isCompleted(await t.go()));
    assert.equal(t.world.calls.filter((c) => c === "completeRun").length, 2);
    assert.equal(t.world.calls.includes("failRun"), false);
    assert.deepEqual(t.sleeps, [1_000]);
  });

  it("recognises that its first call committed when the repeat is refused", async () => {
    const t = await setup();
    // The first call commits, the connection drops, and the re-read also fails once.
    t.world.inject("completeRun", "apply_then_transient");
    t.world.inject("getRunSnapshot", "transient");
    assert.ok(isCompleted(await t.go()));
    assert.equal(t.world.calls.includes("failRun"), false);
    assert.equal(t.world.completed.size, 1);
  });

  it("stops when the run turns out to belong to another worker", async () => {
    const t = await setup();
    const repo: ResearchWorkerRepository = {
      ...t.world.repo,
      async completeRun() {
        t.world.stealLease(t.seeded.id);
        throw new RepositoryError("transient", "connection reset");
      },
    };
    assert.equal(await t.go({ repo }), "lease_lost");
    assert.equal(t.world.calls.includes("failRun"), false);
  });

  it("leaves the run to its lease when the outcome stays unknown", async () => {
    const t = await setup();
    t.world.inject("completeRun", "transient", "transient", "transient");
    assert.equal(await t.go(), "unresolved");
    assert.equal(t.world.calls.filter((c) => c === "completeRun").length, 3);
    assert.equal(t.world.calls.includes("failRun"), false, "never fails a possibly finished run");
    assert.equal(t.sched.active(), 0);
  });
});
