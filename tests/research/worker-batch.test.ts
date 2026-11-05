// runResearchBatch and runMaintenance on fakes: configuration gate, isolation between runs,
// shared fetcher, fresh worker ids, and housekeeping that never affects research.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadResearchFetchConfig,
  ResearchConfigError,
} from "../../src/features/research/engine/config.ts";
import { runMaintenance } from "../../src/features/research/worker/maintenance.ts";
import {
  runResearchBatch,
  type BatchDeps,
} from "../../src/features/research/worker/process-batch.ts";
import { RepositoryError } from "../../src/features/research/worker/types.ts";
import {
  ESTATE_SITE,
  fakeRepo,
  manualScheduler,
  noSleep,
  realFetcher,
  TEST_CONFIG,
} from "./worker-fakes.ts";

function batchWorld(routes = ESTATE_SITE) {
  const world = fakeRepo();
  const site = realFetcher(routes);
  const sched = manualScheduler();
  const fetcherConfigs: unknown[] = [];
  const workerIds: string[] = [];
  let created = 0;
  const deps: BatchDeps = {
    loadConfig: () => TEST_CONFIG,
    createRepository: () => world.repo,
    createFetcher: (config) => {
      fetcherConfigs.push(config);
      return site.fetcher;
    },
    newWorkerId: () => {
      const id = `worker-${++created}`;
      workerIds.push(id);
      return id;
    },
    schedule: sched.schedule,
    sleep: noSleep,
  };
  return { world, site, sched, deps, fetcherConfigs, workerIds };
}

describe("runResearchBatch: configuration gate", () => {
  it("claims nothing and touches nothing when research is not configured", async () => {
    const t = batchWorld();
    const queued = [t.world.seed(), t.world.seed()];
    const result = await runResearchBatch({
      ...t.deps,
      // The real loader with no RESEARCH_BOT_CONTACT_URL, exactly as on this machine today.
      loadConfig: () => loadResearchFetchConfig({}),
    });
    assert.deepEqual(result, { status: "not_configured" });
    assert.deepEqual(t.world.calls, [], "no repository call of any kind, not even maintenance");
    assert.ok(
      queued.every((r) => r.status === "queued" && r.attempts === 0 && r.lockedBy === null),
    );
    assert.equal(t.site.net.requests.length, 0);
    assert.equal(t.workerIds.length, 0);
  });

  it("treats an invalid contact URL the same way", async () => {
    const t = batchWorld();
    const run = t.world.seed();
    for (const bad of ["http://insecure.example.com/bot", "https://localhost/bot", "not a url"]) {
      const result = await runResearchBatch({
        ...t.deps,
        loadConfig: () => loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: bad }),
      });
      assert.equal(result.status, "not_configured", bad);
    }
    assert.equal(run.status, "queued");
    assert.deepEqual(t.world.calls, []);
  });

  it("claims nothing when the server-side database credentials are missing", async () => {
    const t = batchWorld();
    const run = t.world.seed();
    const result = await runResearchBatch({
      ...t.deps,
      createRepository: () => {
        throw new ResearchConfigError("no service key");
      },
    });
    assert.deepEqual(result, { status: "not_configured" });
    assert.equal(run.status, "queued");
    assert.equal(t.workerIds.length, 0);
  });

  it("does not hide unexpected errors as configuration problems", async () => {
    const t = batchWorld();
    await assert.rejects(
      runResearchBatch({
        ...t.deps,
        loadConfig: () => {
          throw new TypeError("bug");
        },
      }),
      TypeError,
    );
  });
});

describe("runResearchBatch: running claimed jobs", () => {
  it("does nothing but housekeeping when no run is queued", async () => {
    const t = batchWorld();
    const result = await runResearchBatch(t.deps);
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.claimed, 0);
    assert.deepEqual(t.world.calls, ["claimRuns", "listPurgeCandidates", "listOrphanPaths"]);
  });

  it("researches every claimed run, with one fetcher and one fresh worker id", async () => {
    const t = batchWorld();
    const a = t.world.seed();
    const b = t.world.seed();
    const result = await runResearchBatch(t.deps);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.claimed, 2);
    assert.equal(result.outcomes.completed + result.outcomes.completed_with_warnings, 2);
    assert.ok(["completed", "completed_with_warnings"].includes(a.status));
    assert.ok(["completed", "completed_with_warnings"].includes(b.status));
    assert.equal(t.fetcherConfigs.length, 1, "one shared fetcher, so one per-host rate limiter");
    assert.equal(t.workerIds.length, 1);
    assert.equal(a.attempts, 1);
    assert.equal(t.sched.active(), 0);

    // A second invocation gets a different worker id, so a stale worker can never match it.
    await runResearchBatch(t.deps);
    assert.equal(t.workerIds.length, 2);
    assert.notEqual(t.workerIds[0], t.workerIds[1]);
  });

  it("limits a batch to the configured size", async () => {
    const t = batchWorld();
    for (let i = 0; i < 5; i++) t.world.seed();
    const result = await runResearchBatch({ ...t.deps, batchSize: 2 });
    assert.equal(result.status === "ok" && result.claimed, 2);
    const queued = [...t.world.runs.values()].filter((r) => r.status === "queued");
    assert.equal(queued.length, 3);
  });

  it("isolates runs: one failing or throwing run never affects the others", async () => {
    const t = batchWorld();
    const good = t.world.seed();
    const noSite = t.world.seed({ website: null });
    const suppressed = t.world.seed({ suppressed: true });
    const dbDown = t.world.seed();
    const good2 = t.world.seed();
    // The database fails while checking ONE run's lead.
    const original = t.world.repo.getLead;
    t.world.repo.getLead = async (workspaceId, leadId) => {
      if (leadId === dbDown.leadId) throw new RepositoryError("transient", "x");
      return original(workspaceId, leadId);
    };
    const result = await runResearchBatch({ ...t.deps, batchSize: 5 });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.claimed, 5);
    assert.ok(["completed", "completed_with_warnings"].includes(good.status));
    assert.ok(["completed", "completed_with_warnings"].includes(good2.status));
    assert.equal(noSite.status, "failed");
    assert.equal(suppressed.status, "failed");
    assert.equal(dbDown.status, "queued", "retry scheduled");
    assert.equal(result.outcomes.retry_scheduled, 1);
    assert.equal(result.outcomes.failed, 2);
    assert.equal(result.outcomes.completed + result.outcomes.completed_with_warnings, 2);
    assert.equal(t.sched.active(), 0);
  });

  it("counts a run as unresolved when even recording its failure fails, and carries on", async () => {
    const t = batchWorld();
    const crashing = t.world.seed();
    const fine = t.world.seed();
    const original = t.world.repo.getLead;
    // A defect inside one run's own failure handling must still be contained.
    t.world.repo.getLead = async (workspaceId, leadId) => {
      if (leadId === crashing.leadId) throw new Error("boom");
      return original(workspaceId, leadId);
    };
    t.world.repo.failRun = async () => {
      throw new Error("boom again");
    };
    const result = await runResearchBatch(t.deps);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.outcomes.unresolved, 1);
    assert.ok(["completed", "completed_with_warnings"].includes(fine.status));
  });

  it("contains a defect thrown outside a run's own error handling", async () => {
    const t = batchWorld();
    t.world.seed();
    t.world.seed();
    const result = await runResearchBatch({
      ...t.deps,
      // Throws before processRun's own try block begins.
      schedule: () => {
        throw new Error("defect");
      },
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.outcomes.error, 2);
    assert.equal(result.maintenance.errors, 0, "housekeeping still ran");
    assert.ok(t.world.calls.includes("listOrphanPaths"));
  });

  it("propagates a claim failure to the caller and writes nothing", async () => {
    const t = batchWorld();
    t.world.inject("claimRuns", "transient");
    await assert.rejects(runResearchBatch(t.deps), RepositoryError);
    assert.deepEqual(t.world.calls, ["claimRuns"]);
  });

  it("still returns research results when maintenance fails", async () => {
    const t = batchWorld();
    t.world.seed();
    t.world.inject("listPurgeCandidates", "transient");
    t.world.inject("listOrphanPaths", "transient");
    const result = await runResearchBatch(t.deps);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.claimed, 1);
    assert.equal(result.maintenance.errors, 2);
  });
});

describe("runMaintenance", () => {
  it("removes the text from storage first, then marks exactly those sources purged", async () => {
    const world = fakeRepo();
    world.lists.purge = [
      { sourceId: "s1", storagePath: "a/b/c/1.txt.gz" },
      { sourceId: "s2", storagePath: "a/b/c/2.txt.gz" },
    ];
    world.storage.set("a/b/c/1.txt.gz", Buffer.from("x"));
    const result = await runMaintenance(world.repo);
    assert.deepEqual(world.removed[0], ["a/b/c/1.txt.gz", "a/b/c/2.txt.gz"]);
    assert.deepEqual(world.marked, [["s1", "s2"]]);
    assert.ok(world.calls.indexOf("removeSources") < world.calls.indexOf("markPurged"));
    assert.equal(result.purged, 2);
    assert.equal(world.storage.size, 0);
  });

  it("does not mark anything purged when the storage removal fails (retried next time)", async () => {
    const world = fakeRepo();
    world.lists.purge = [{ sourceId: "s1", storagePath: "p/1.txt.gz" }];
    world.inject("removeSources", "storage_transient");
    const result = await runMaintenance(world.repo);
    assert.equal(world.calls.includes("markPurged"), false);
    assert.deepEqual(result, { purged: 0, orphansRemoved: 0, errors: 1 });
  });

  it("removes orphaned uploads, and an orphan failure does not stop the purge", async () => {
    const world = fakeRepo();
    world.lists.orphans = ["o/1.txt.gz", "o/2.txt.gz"];
    const result = await runMaintenance(world.repo);
    assert.deepEqual(world.removed, [["o/1.txt.gz", "o/2.txt.gz"]]);
    assert.equal(result.orphansRemoved, 2);

    const world2 = fakeRepo();
    world2.lists.purge = [{ sourceId: "s", storagePath: "p" }];
    world2.lists.orphans = ["o"];
    world2.inject("listOrphanPaths", "transient");
    const result2 = await runMaintenance(world2.repo);
    assert.equal(result2.purged, 1);
    assert.equal(result2.errors, 1);
  });

  it("only acts on what the database lists, within the limit", async () => {
    const world = fakeRepo();
    world.lists.purge = Array.from({ length: 5 }, (_, i) => ({
      sourceId: `s${i}`,
      storagePath: `p${i}`,
    }));
    await runMaintenance(world.repo, 3);
    assert.equal(world.limits.purge, 3);
    assert.equal(world.limits.orphans, 3);
    assert.deepEqual(world.marked, [["s0", "s1", "s2"]]);
  });

  it("does nothing when nothing is due", async () => {
    const world = fakeRepo();
    const result = await runMaintenance(world.repo);
    assert.deepEqual(result, { purged: 0, orphansRemoved: 0, errors: 0 });
    assert.equal(world.calls.includes("removeSources"), false);
  });
});
