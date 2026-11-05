// Worker endpoint behaviour: secret authentication, exact-path matching, the HTTP handler and
// guards on how the worker is wired. Plain Request/Response objects; no server is started.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  loadWorkerSecret,
  verifyWorkerSecret,
  WORKER_SECRET_MIN_LENGTH,
} from "../../src/features/research/worker/auth.ts";
import {
  isWorkerEndpoint,
  WORKER_ENDPOINT_PATH,
} from "../../src/features/research/worker/endpoint.ts";
import { createWorkerHandler } from "../../src/features/research/worker/handler.ts";
import {
  emptyOutcomeCounts,
  type BatchResult,
} from "../../src/features/research/worker/process-batch.ts";

// A made-up value that only exists in this test file; it is not a real secret.
const SECRET = "test-only-secret-" + "0123456789abcdef".repeat(2);

const okResult = (over: Partial<ReturnType<typeof emptyOutcomeCounts>> = {}): BatchResult => ({
  status: "ok",
  claimed: 3,
  outcomes: {
    ...emptyOutcomeCounts(),
    completed: 1,
    completed_with_warnings: 1,
    failed: 1,
    ...over,
  },
  maintenance: { purged: 2, orphansRemoved: 1, errors: 0 },
});

function harness(options: { secret?: string | null; result?: () => Promise<BatchResult> } = {}) {
  let calls = 0;
  const handle = createWorkerHandler({
    getSecret: () => (options.secret === undefined ? SECRET : options.secret),
    runBatch: async () => {
      calls++;
      return options.result ? options.result() : okResult();
    },
  });
  const call = (init: RequestInit = {}, auth: string | null = `Bearer ${SECRET}`) =>
    handle(
      new Request("http://localhost:3000/api/research/worker", {
        method: "POST",
        ...init,
        headers: { ...(auth ? { authorization: auth } : {}), ...(init.headers as object) },
      }),
    );
  return { call, runs: () => calls };
}

describe("loadWorkerSecret", () => {
  it("returns the secret only when it is long enough, trimmed", () => {
    assert.equal(loadWorkerSecret({}), null);
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: "" }), null);
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: "   " }), null);
    assert.equal(
      loadWorkerSecret({ RESEARCH_WORKER_SECRET: "x".repeat(WORKER_SECRET_MIN_LENGTH - 1) }),
      null,
    );
    assert.equal(
      loadWorkerSecret({ RESEARCH_WORKER_SECRET: "x".repeat(WORKER_SECRET_MIN_LENGTH) }),
      "x".repeat(32),
    );
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: `  ${SECRET}\n` }), SECRET);
  });

  it("has no default value", () => {
    assert.equal(loadWorkerSecret({ SOMETHING_ELSE: SECRET }), null);
  });

  it("rejects a secret that contains whitespace anywhere inside it", () => {
    const half = "abcdef0123456789";
    // The case from the review: long enough, but with a space in the middle.
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: `${half} ${half}` }), null);
    for (const ws of [" ", "  ", "\t", "\n", "\r", "\r\n", "\v", "\f", " ", " ", "　"]) {
      assert.equal(
        loadWorkerSecret({ RESEARCH_WORKER_SECRET: `${half}${ws}${half}` }),
        null,
        JSON.stringify(ws),
      );
    }
    // Still rejected when only a few characters are separated from an otherwise valid secret.
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: `${SECRET} x` }), null);
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: `x ${SECRET}` }), null);
  });

  it("rejects characters that cannot travel in an Authorization header", () => {
    const base = "a".repeat(WORKER_SECRET_MIN_LENGTH);
    for (const bad of ["\u0000", "\u0007", "\u001b", "\u007f", "é", "日", "😀", "​"]) {
      assert.equal(
        loadWorkerSecret({ RESEARCH_WORKER_SECRET: `${base}${bad}${base}` }),
        null,
        JSON.stringify(bad),
      );
    }
  });

  it("keeps the minimum length: 31 characters fail, 32 pass", () => {
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: "k".repeat(31) }), null);
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: "k".repeat(32) }), "k".repeat(32));
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: "k".repeat(200) }), "k".repeat(200));
    // Length counts the secret itself, not surrounding whitespace that is ignored.
    assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: ` ${"k".repeat(31)} ` }), null);
  });

  it("accepts any visible-ASCII secret of sufficient length", () => {
    const valid = [
      SECRET,
      "0123456789abcdef".repeat(4), // what `randomBytes(32).toString("hex")` produces
      "Ab-_9".repeat(8), // base64url style
      "!#$%&()*+,-./:;<=>?@[]^_{|}~".padEnd(40, "!"), // punctuation
      "q\"w'e`r".padEnd(40, "z"), // quote characters are ordinary characters here
    ];
    for (const secret of valid) {
      assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: secret }), secret);
    }
  });

  it("still ignores whitespace around the value (a trailing newline is common)", () => {
    for (const wrapped of [`${SECRET}\n`, `\t${SECRET} `, `\r\n${SECRET}\r\n`]) {
      assert.equal(loadWorkerSecret({ RESEARCH_WORKER_SECRET: wrapped }), SECRET);
    }
  });

  it("fails safely: an invalid secret means 'not configured' and nothing runs", async () => {
    const half = "abcdef0123456789";
    const invalid = [`${half} ${half}`, `${half}\t${half}`, "short", "", `${SECRET} x`];
    for (const value of invalid) {
      let runs = 0;
      const handle = createWorkerHandler({
        getSecret: () => loadWorkerSecret({ RESEARCH_WORKER_SECRET: value }),
        runBatch: async () => {
          runs++;
          return okResult();
        },
      });
      // Even a caller presenting exactly the invalid value gets "not configured", never access.
      for (const auth of [`Bearer ${value}`, `Bearer ${value.replace(/\s+/g, "")}`, null]) {
        const res = await handle(
          new Request("http://localhost:3000/api/research/worker", {
            method: "POST",
            headers: auth ? { authorization: auth } : {},
          }),
        );
        assert.equal(res.status, 503, `${JSON.stringify(value)} / ${auth}`);
        assert.deepEqual(await res.json(), { error: "worker_not_configured" });
      }
      assert.equal(runs, 0);
    }
  });
});

describe("verifyWorkerSecret", () => {
  it("accepts exactly the configured secret as a Bearer token", () => {
    assert.equal(verifyWorkerSecret(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(verifyWorkerSecret(`bearer ${SECRET}`, SECRET), true);
    assert.equal(verifyWorkerSecret(`Bearer   ${SECRET}`, SECRET), true);
  });

  it("rejects everything else", () => {
    const bad: (string | null | undefined)[] = [
      null,
      undefined,
      "",
      "Bearer",
      "Bearer ",
      SECRET, // no scheme
      `Basic ${SECRET}`,
      `Token ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer x${SECRET}`,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${SECRET.toUpperCase()}`,
      `Bearer ${SECRET} extra`,
      `Bearer ${SECRET}\n`,
      `Bearer a b`,
    ];
    for (const header of bad)
      assert.equal(verifyWorkerSecret(header, SECRET), false, String(header));
  });

  it("can never authenticate a secret that contains whitespace (defence in depth)", () => {
    const spaced = "abcdef0123456789 abcdef0123456789";
    for (const header of [
      `Bearer ${spaced}`,
      "Bearer abcdef0123456789",
      "Bearer abcdef0123456789abcdef0123456789",
      `Bearer ${spaced.replace(" ", "\t")}`,
    ]) {
      assert.equal(verifyWorkerSecret(header, spaced), false, header);
    }
  });

  it("compares the whole value: a prefix or extension of the secret is rejected", () => {
    assert.equal(verifyWorkerSecret(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(verifyWorkerSecret(`Bearer ${SECRET.slice(0, 20)}`, SECRET), false);
    assert.equal(verifyWorkerSecret(`Bearer ${SECRET}${SECRET}`, SECRET), false);
  });
});

describe("isWorkerEndpoint (the only proxy exemption)", () => {
  it("matches the exact path and nothing else", () => {
    assert.equal(WORKER_ENDPOINT_PATH, "/api/research/worker");
    assert.equal(isWorkerEndpoint("/api/research/worker"), true);
    for (const other of [
      "/api/research/worker/",
      "/api/research/worker/x",
      "/api/research/worker2",
      "/api/research/workers",
      "/api/research/worker.json",
      "/api/research",
      "/api",
      "/api/research/worker/../worker2",
      "/API/research/worker",
      "/api/Research/Worker",
      "//api/research/worker",
      "/x/api/research/worker",
      "/research",
      "/",
      "",
    ]) {
      assert.equal(isWorkerEndpoint(other), false, other);
    }
  });
});

describe("worker handler", () => {
  it("answers only POST, before looking at any secret", async () => {
    const h = harness({ secret: null });
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const res = await h.call({ method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "POST");
    }
    assert.equal(h.runs(), 0);
  });

  it("refuses to run when no secret is configured", async () => {
    for (const secret of [null, ""]) {
      const h = harness({ secret });
      const res = await h.call();
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "worker_not_configured" });
      assert.equal(h.runs(), 0);
    }
  });

  it("rejects missing or wrong credentials without running anything", async () => {
    const h = harness();
    for (const auth of [null, "", "Bearer", `Bearer wrong-${SECRET}`, `Basic ${SECRET}`, SECRET]) {
      const res = await h.call({}, auth);
      assert.equal(res.status, 401, String(auth));
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      assert.equal(res.headers.get("www-authenticate"), "Bearer");
    }
    assert.equal(h.runs(), 0);
  });

  it("returns only counts, never identifiers, company data or the secret", async () => {
    const h = harness();
    const res = await h.call();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      status: "ok",
      claimed: 3,
      completed: 2,
      cancelled: 0,
      retry_scheduled: 0,
      failed: 1,
      lease_lost: 0,
      unresolved: 0,
      errors: 0,
      maintenance: { purged: 2, orphans_removed: 1, errors: 0 },
    });
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, new RegExp(SECRET));
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "no UUIDs");
  });

  it("is never cached and always JSON", async () => {
    const h = harness();
    for (const res of [await h.call(), await h.call({}, null), await h.call({ method: "GET" })]) {
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    }
  });

  it("does not read the request body", async () => {
    const h = harness();
    const res = await h.call({
      body: '{"run":"anything"}',
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 200);
  });

  it("reports missing research configuration safely", async () => {
    const h = harness({ result: async () => ({ status: "not_configured" }) });
    const res = await h.call();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "research_not_configured" });
  });

  it("hides internal errors completely", async () => {
    const h = harness({
      result: async () => {
        throw new Error(`boom ${SECRET} postgres://user:pw@internal/db company=Acme run=123`);
      },
    });
    const res = await h.call();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "worker_error" });
  });

  it("runs one batch at a time and recovers afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    const h = harness({
      result: async () => {
        if (first) {
          first = false;
          await gate;
        }
        return okResult();
      },
    });
    const running = h.call();
    await new Promise((r) => setImmediate(r));
    const busy = await h.call();
    assert.equal(busy.status, 409);
    assert.deepEqual(await busy.json(), { error: "worker_busy" });
    // An unauthenticated caller learns nothing about whether a batch is running.
    assert.equal((await h.call({}, "Bearer nope")).status, 401);
    release();
    assert.equal((await running).status, 200);
    assert.equal((await h.call()).status, 200);
    assert.equal(h.runs(), 2);
  });

  it("is available again after a failed batch", async () => {
    let n = 0;
    const h = harness({
      result: async () => {
        if (n++ === 0) throw new Error("x");
        return okResult();
      },
    });
    assert.equal((await h.call()).status, 500);
    assert.equal((await h.call()).status, 200);
  });
});

describe("how the worker is wired (guards)", () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const workerDir = "src/features/research/worker";
  const workerFiles = readdirSync(join(root, workerDir)).filter((f) => f.endsWith(".ts"));

  it("keeps service-role access in production.ts only", () => {
    const mentions = workerFiles.filter((f) =>
      /createAdminClient|SERVICE_ROLE|lib\/supabase\/admin/.test(read(`${workerDir}/${f}`)),
    );
    assert.deepEqual(mentions, ["production.ts"]);
    assert.match(read(`${workerDir}/production.ts`), /^import "server-only";/);
    assert.doesNotMatch(
      read("src/app/api/research/worker/route.ts"),
      /createAdminClient|SERVICE_ROLE/,
    );
  });

  it("exposes a POST route only", () => {
    const route = read("src/app/api/research/worker/route.ts");
    assert.match(route, /export async function POST\(/);
    assert.doesNotMatch(
      route,
      /export\s+(async\s+)?(function|const)\s+(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
    );
    assert.match(route, /export const runtime = "nodejs"/);
  });

  it("never reads the secret from NEXT_PUBLIC_ variables, and only log.ts may use the console", () => {
    for (const f of workerFiles) {
      const src = read(`${workerDir}/${f}`);
      assert.doesNotMatch(src, /NEXT_PUBLIC_/, f);
      if (f === "log.ts") continue;
      assert.doesNotMatch(src, /\bconsole\b/, `${f} must log only through log.ts`);
    }
    assert.doesNotMatch(read("src/app/api/research/worker/route.ts"), /\bconsole\b/);
    // log.ts is the single sink and uses exactly two console calls: error and warn.
    const sink = read(`${workerDir}/log.ts`).match(/console\.\w+/g);
    assert.deepEqual(sink?.sort(), ["console.error", "console.warn"]);
  });

  it("lets the proxy skip the login redirect for the exact worker path only", () => {
    const proxy = read("src/lib/supabase/proxy.ts");
    assert.match(proxy, /const PUBLIC_PATHS = \["\/login", "\/auth", "\/setup"\];/);
    assert.equal(proxy.match(/isWorkerEndpoint\(/g)?.length, 1);
    assert.match(proxy, /if \(isWorkerEndpoint\(pathname\)\) return NextResponse\.next\(\);/);
    // The login redirect for everything else is still in place.
    assert.match(proxy, /if \(!signedIn && !isPublicPath\(pathname\)\)/);
  });

  it("keeps the worker logic free of framework and alias imports (so it is testable)", () => {
    for (const f of workerFiles.filter((f) => f !== "production.ts")) {
      const src = read(`${workerDir}/${f}`);
      assert.doesNotMatch(src, /from "@\//, `${f} must use relative imports`);
      assert.doesNotMatch(src, /from "next\//, f);
      assert.doesNotMatch(src, /import "server-only"/, f);
    }
  });
});
