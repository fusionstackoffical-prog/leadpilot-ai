// Infrastructure logging: only fixed, detail-free messages ever reach the console. Every test
// below captures ALL console output and checks it against a strict whitelist, with recognizable
// sensitive values planted in every failure path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { loadResearchFetchConfig } from "../../src/features/research/engine/config.ts";
import { createWorkerHandler } from "../../src/features/research/worker/handler.ts";
import {
  consoleLogger,
  emit,
  reasonOf,
  reportOnce,
  WORKER_LOG_MESSAGES,
  type WorkerLogEvent,
  type WorkerLogger,
} from "../../src/features/research/worker/log.ts";
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

// Made-up values that exist only in this file. None is a real secret, key, URL or person.
const SECRET = "log-test-only-secret-" + "0123456789abcdef".repeat(2);
const AUTH_HEADER = `Bearer ${SECRET}`;
const DB_ERROR =
  'connect failed postgres://svc_user:hunter2@db.internal.example:5432/prod relation "research_runs" violates constraint';
const RAW_SECRET_ERROR = `${DB_ERROR} Authorization: ${AUTH_HEADER} company=Prime Realty url=https://primerealty.ae/contact-us`;

const REASONS = [
  "lease_lost",
  "not_found",
  "invalid_result",
  "storage_rejected",
  "storage_transient",
  "transient",
  "unexpected",
] as const;

/** Every line the logger is allowed to produce: a fixed message, optionally plus a fixed reason. */
const ALLOWED_LINES = new Set(
  Object.values(WORKER_LOG_MESSAGES).flatMap((m) => [
    `[research-worker] ${m}`,
    ...REASONS.map((r) => `[research-worker] ${m} (${r})`),
  ]),
);

/** Captures everything written through any console method for the duration of one test. */
function captureConsole(t: TestContext) {
  const lines: string[] = [];
  const methods: Record<string, string[]> = { error: [], warn: [], log: [], info: [], debug: [] };
  for (const name of Object.keys(methods)) {
    t.mock.method(console, name as "error", (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      lines.push(text);
      methods[name].push(text);
    });
  }
  return { lines, methods };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

/** Nothing but whitelisted lines, and none of the planted sensitive values, may appear. */
function assertSafe(lines: string[], forbidden: string[] = []) {
  for (const line of lines) {
    assert.ok(ALLOWED_LINES.has(line), `unexpected log line: ${line}`);
    assert.doesNotMatch(line, UUID, "no identifiers");
    assert.doesNotMatch(line, /https?:|Bearer|Authorization|postgres|hunter2|primerealty/i);
    assert.doesNotMatch(line, /Prime Realty|research_runs|svc_user|internal\.example/);
    assert.ok(!line.includes(SECRET));
    for (const f of forbidden) assert.ok(!line.includes(f), `leaked ${f}`);
  }
}

function batchWorld(routes = ESTATE_SITE, log: WorkerLogger = consoleLogger) {
  const world = fakeRepo();
  const site = realFetcher(routes);
  const deps: BatchDeps = {
    loadConfig: () => TEST_CONFIG,
    createRepository: () => world.repo,
    createFetcher: () => site.fetcher,
    newWorkerId: () => "worker-log-test",
    schedule: manualScheduler().schedule,
    sleep: noSleep,
    log,
  };
  return { world, site, deps };
}

describe("log messages and reasons", () => {
  it("are a closed set of fixed sentences with no placeholders", () => {
    const events = Object.keys(WORKER_LOG_MESSAGES) as WorkerLogEvent[];
    assert.deepEqual(events.sort(), [
      "batch_failed",
      "claim_failed",
      "maintenance_orphan_sweep_failed",
      "maintenance_purge_failed",
      "research_not_configured",
      "run_crashed",
      "run_unresolved",
    ]);
    for (const event of events) {
      const message = WORKER_LOG_MESSAGES[event];
      assert.match(message, /^[A-Z][A-Za-z0-9 .,;'-]+\.$/, event);
      assert.doesNotMatch(message, /\$\{|%s|%d|\{\}/, event);
      assert.ok(message.length < 100, event);
    }
  });

  it("derive the reason word only from a known repository failure", () => {
    for (const kind of REASONS.filter((r) => r !== "unexpected")) {
      assert.equal(reasonOf(new RepositoryError(kind, RAW_SECRET_ERROR)), kind);
    }
    assert.equal(reasonOf(new RepositoryError("hunter2" as never, "x")), "unexpected");
    for (const other of [
      new Error(RAW_SECRET_ERROR),
      RAW_SECRET_ERROR,
      { kind: "transient" },
      null,
      undefined,
      42,
    ]) {
      assert.equal(reasonOf(other), "unexpected");
    }
  });
});

describe("consoleLogger", () => {
  it("writes exactly the fixed message, with the fixed reason when given", (t) => {
    const out = captureConsole(t);
    for (const event of Object.keys(WORKER_LOG_MESSAGES) as WorkerLogEvent[]) {
      consoleLogger(event);
      for (const reason of REASONS) consoleLogger(event, reason);
    }
    assert.equal(out.lines.length, 7 * 8);
    assertSafe(out.lines);
    assert.ok(
      out.lines.includes("[research-worker] Claiming queued research runs failed. (transient)"),
    );
    assert.ok(out.lines.includes("[research-worker] A research worker batch failed."));
  });

  it("uses warn for a missing configuration and error for failures", (t) => {
    const out = captureConsole(t);
    consoleLogger("research_not_configured");
    consoleLogger("claim_failed", "transient");
    assert.equal(out.methods.warn.length, 1);
    assert.equal(out.methods.error.length, 1);
    assert.equal(out.methods.log.length + out.methods.info.length + out.methods.debug.length, 0);
  });

  it("never prints a reason that is not in the fixed set", (t) => {
    const out = captureConsole(t);
    consoleLogger("claim_failed", RAW_SECRET_ERROR as never);
    consoleLogger("batch_failed", "hunter2" as never);
    assert.deepEqual(out.lines, [
      "[research-worker] Claiming queued research runs failed.",
      "[research-worker] A research worker batch failed.",
    ]);
  });
});

describe("emit and reportOnce", () => {
  it("never let a failing logger change what the worker does", () => {
    const throwing: WorkerLogger = () => {
      throw new Error(RAW_SECRET_ERROR);
    };
    assert.doesNotThrow(() => emit(throwing, "claim_failed", "transient"));
    assert.doesNotThrow(() => reportOnce(throwing, "batch_failed", new Error("x")));
    assert.doesNotThrow(() => emit(undefined, "claim_failed"));
    assert.doesNotThrow(() => reportOnce(undefined, "claim_failed", new Error("x")));
  });

  it("report one error once, however many layers see it", () => {
    const seen: string[] = [];
    const log: WorkerLogger = (event, reason) => seen.push(`${event}:${reason}`);
    const error = new RepositoryError("transient", RAW_SECRET_ERROR);
    reportOnce(log, "claim_failed", error);
    reportOnce(log, "batch_failed", error);
    reportOnce(log, "batch_failed", error);
    assert.deepEqual(seen, ["claim_failed:transient"]);
    reportOnce(log, "batch_failed", new Error("a different error"));
    assert.equal(seen.length, 2);
  });
});

describe("batch failures are logged without any detail", () => {
  it("claim failure: one fixed line, error still reaches the caller", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    world.seed();
    world.repo.claimRuns = async () => {
      throw new Error(RAW_SECRET_ERROR);
    };
    await assert.rejects(runResearchBatch(deps), /hunter2/); // the caller still gets the real error
    assert.deepEqual(out.lines, [
      "[research-worker] Claiming queued research runs failed. (unexpected)",
    ]);
    assertSafe(out.lines);
  });

  it("claim failure with a repository error: the fixed reason word is included", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    world.inject("claimRuns", "transient");
    await assert.rejects(runResearchBatch(deps), RepositoryError);
    assert.deepEqual(out.lines, [
      "[research-worker] Claiming queued research runs failed. (transient)",
    ]);
  });

  it("maintenance failures: one fixed line per failing step, research unaffected", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    const run = world.seed();
    world.repo.listPurgeCandidates = async () => {
      throw new Error(RAW_SECRET_ERROR);
    };
    world.inject("listOrphanPaths", "storage_transient");
    const result = await runResearchBatch(deps);
    assert.equal(result.status, "ok");
    assert.ok(["completed", "completed_with_warnings"].includes(run.status));
    assert.deepEqual(out.lines, [
      "[research-worker] Maintenance could not purge old source text. (unexpected)",
      "[research-worker] Maintenance could not remove unreferenced uploads. (storage_transient)",
    ]);
    assertSafe(out.lines, [run.id, run.leadId]);
  });

  it("runMaintenance alone logs through the optional logger and stays silent without one", async (t) => {
    const out = captureConsole(t);
    const world = fakeRepo();
    world.inject("listPurgeCandidates", "transient");
    await runMaintenance(world.repo);
    assert.deepEqual(out.lines, []);
    world.inject("listPurgeCandidates", "transient");
    await runMaintenance(world.repo, 200, consoleLogger);
    assert.deepEqual(out.lines, [
      "[research-worker] Maintenance could not purge old source text. (transient)",
    ]);
  });

  it("an unconfirmed run: a fixed line with no run, lead or company details", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld({ ...ESTATE_SITE, "primerealty.ae/": { status: 503 } });
    const run = world.seed();
    world.inject("failRun", "transient");
    const result = await runResearchBatch(deps);
    assert.equal(result.status === "ok" && result.outcomes.unresolved, 1);
    assert.deepEqual(out.lines, [
      "[research-worker] A research run's final state could not be confirmed; its lease will expire.",
    ]);
    assertSafe(out.lines, [run.id, run.leadId, "primerealty.ae"]);
  });

  it("a crashed run: a fixed line, the raw error is not logged", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    const run = world.seed();
    const result = await runResearchBatch({
      ...deps,
      schedule: () => {
        throw new Error(RAW_SECRET_ERROR);
      },
    });
    assert.equal(result.status === "ok" && result.outcomes.error, 1);
    assert.deepEqual(out.lines, [
      "[research-worker] A research run stopped unexpectedly. (unexpected)",
    ]);
    assertSafe(out.lines, [run.id, run.leadId]);
  });

  it("missing research configuration: one fixed warning, no setting names or values", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    world.seed();
    const result = await runResearchBatch({
      ...deps,
      loadConfig: () => loadResearchFetchConfig({}),
    });
    assert.deepEqual(result, { status: "not_configured" });
    assert.deepEqual(out.methods.warn, [
      "[research-worker] Research is not configured on the server, so no runs were claimed.",
    ]);
    assert.doesNotMatch(out.lines.join(" "), /RESEARCH_|https?:|CONTACT/);
  });

  it("routine outcomes are not logged: they are recorded on the run itself", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    world.seed(); // completes
    world.seed({ website: null }); // permanent per-run failure
    world.seed({ suppressed: true }); // permanent per-run failure
    const result = await runResearchBatch({ ...deps, batchSize: 5 });
    assert.equal(result.status === "ok" && result.claimed, 3);
    assert.deepEqual(out.lines, []);
  });
});

describe("HTTP handler logging", () => {
  const request = (auth: string | null = AUTH_HEADER, method = "POST") =>
    new Request("http://localhost:3000/api/research/worker", {
      method,
      headers: auth ? { authorization: auth, "x-company": "Prime Realty" } : {},
    });

  it("an unexpected batch failure: generic 500, one fixed line, nothing from the request or error", async (t) => {
    const out = captureConsole(t);
    const handle = createWorkerHandler({
      getSecret: () => SECRET,
      log: consoleLogger,
      runBatch: async () => {
        throw new Error(RAW_SECRET_ERROR);
      },
    });
    const res = await handle(request());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "worker_error" });
    assert.deepEqual(out.lines, ["[research-worker] A research worker batch failed. (unexpected)"]);
    assertSafe(out.lines);
  });

  it("a claim failure through the whole stack is logged once, not twice, and the response is generic", async (t) => {
    const out = captureConsole(t);
    const { world, deps } = batchWorld();
    world.seed();
    world.repo.claimRuns = async () => {
      throw new Error(RAW_SECRET_ERROR);
    };
    const handle = createWorkerHandler({
      getSecret: () => SECRET,
      log: consoleLogger,
      runBatch: () => runResearchBatch(deps),
    });
    const res = await handle(request());
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.deepEqual(JSON.parse(body), { error: "worker_error" });
    assert.doesNotMatch(body, /hunter2|postgres|primerealty|Prime Realty|Bearer/);
    assert.deepEqual(out.lines, [
      "[research-worker] Claiming queued research runs failed. (unexpected)",
    ]);
  });

  it("does not log rejected requests, so nobody can flood the log", async (t) => {
    const out = captureConsole(t);
    let runs = 0;
    const make = (secret: string | null) =>
      createWorkerHandler({
        getSecret: () => secret,
        log: consoleLogger,
        runBatch: async () => {
          runs++;
          return { status: "not_configured" as const };
        },
      });
    const configured = make(SECRET);
    for (const auth of [null, "Bearer wrong", `Basic ${SECRET}`]) await configured(request(auth));
    await configured(request(AUTH_HEADER, "GET"));
    await configured(request(AUTH_HEADER, "PUT"));
    await make(null)(request()); // secret not configured: 503
    assert.equal(runs, 0);
    assert.deepEqual(out.lines, []);
  });

  it("a successful batch and a 'not configured' answer add nothing beyond the batch's own warning", async (t) => {
    const out = captureConsole(t);
    const handle = createWorkerHandler({
      getSecret: () => SECRET,
      log: consoleLogger,
      runBatch: async () => ({ status: "not_configured" }),
    });
    const res = await handle(request());
    assert.equal(res.status, 503);
    assert.deepEqual(out.lines, []); // the handler itself logs only unexpected failures
  });
});

describe("a failing logger cannot change results", () => {
  it("returns the same batch result and the same 500 as without logging", async () => {
    const throwing: WorkerLogger = () => {
      throw new Error(RAW_SECRET_ERROR);
    };
    const a = batchWorld(ESTATE_SITE, throwing);
    a.world.seed();
    a.world.inject("listOrphanPaths", "transient");
    const b = batchWorld(ESTATE_SITE, () => {});
    b.world.seed();
    b.world.inject("listOrphanPaths", "transient");
    const withThrowing = await runResearchBatch(a.deps);
    const without = await runResearchBatch(b.deps);
    assert.deepEqual(withThrowing, without);

    const handle = createWorkerHandler({
      getSecret: () => SECRET,
      log: throwing,
      runBatch: async () => {
        throw new Error("x");
      },
    });
    const res = await handle(
      new Request("http://localhost:3000/api/research/worker", {
        method: "POST",
        headers: { authorization: AUTH_HEADER },
      }),
    );
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "worker_error" });
  });
});

describe("wiring", () => {
  it("production uses the console logger for both the handler and the batch", () => {
    const src = readFileSync(
      join(process.cwd(), "src/features/research/worker/production.ts"),
      "utf8",
    );
    assert.equal(src.match(/log: consoleLogger/g)?.length, 2);
  });
});
