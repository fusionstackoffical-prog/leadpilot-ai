// The Supabase adapter against a fake client that records every call. Nothing here touches a
// real Supabase project or the network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.ts";
import {
  createSupabaseRepository,
  databaseError,
  storageError,
} from "../../src/features/research/worker/supabase-repository.ts";
import { RepositoryError } from "../../src/features/research/worker/types.ts";
import type { CompletionPayload } from "../../src/features/research/engine/extract/payload.ts";

type Reply = { data?: unknown; error?: unknown };

function fakeClient(
  script: {
    rpc?: Record<string, Reply | Error>;
    tables?: Record<string, Reply | Error>;
    upload?: Reply | Error;
    remove?: Reply | Error;
  } = {},
) {
  const log = {
    rpc: [] as { name: string; args: unknown }[],
    queries: [] as { table: string; select: string; filters: [string, unknown][] }[],
    uploads: [] as { bucket: string; path: string; body: unknown; options: unknown }[],
    removes: [] as { bucket: string; paths: string[] }[],
  };
  const settle = (r: Reply | Error | undefined): Promise<Reply> =>
    r instanceof Error ? Promise.reject(r) : Promise.resolve(r ?? { data: null, error: null });

  const client = {
    rpc(name: string, args: unknown) {
      log.rpc.push({ name, args });
      return settle(script.rpc?.[name]);
    },
    from(table: string) {
      const q = { table, select: "", filters: [] as [string, unknown][] };
      log.queries.push(q);
      const builder = {
        select(columns: string) {
          q.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          q.filters.push([column, value]);
          return builder;
        },
        maybeSingle: () => settle(script.tables?.[table]),
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: unknown, options: unknown) {
            log.uploads.push({ bucket, path, body, options });
            return settle(script.upload);
          },
          remove(paths: string[]) {
            log.removes.push({ bucket, paths });
            return settle(script.remove);
          },
        };
      },
    },
  } as unknown as SupabaseClient<Database>;
  return { client, log, repo: createSupabaseRepository(client) };
}

const kind = (k: string) => (e: unknown) => e instanceof RepositoryError && e.kind === k;
const LEAKY = {
  code: "XX000",
  message: 'relation "research_runs" secret=hunter2',
  details: "d",
  hint: "h",
};

const RUN_ROW = {
  id: "run-1",
  workspace_id: "ws-1",
  lead_id: "lead-1",
  requested_by: "user-1",
  trigger_source: "manual",
  attempts: 1,
  max_attempts: 3,
  cancel_requested_at: null,
};

describe("databaseError / storageError", () => {
  it("maps SQLSTATE codes to repository kinds", () => {
    const table: [string | undefined | null, string][] = [
      ["55000", "lease_lost"],
      ["P0002", "not_found"],
      ["22023", "invalid_result"],
      ["22P02", "invalid_result"],
      ["54000", "invalid_result"],
      ["23514", "invalid_result"],
      ["23505", "invalid_result"],
      ["42501", "transient"],
      ["PGRST301", "transient"],
      ["", "transient"],
      [undefined, "transient"],
      [null, "transient"],
    ];
    for (const [code, expected] of table) {
      assert.equal(databaseError({ code }).kind, expected, String(code));
    }
  });

  it("maps storage statuses: refused objects are permanent, everything else retries", () => {
    for (const status of [400, 413, 415, 422, "413"]) {
      assert.equal(storageError({ status }).kind, "storage_rejected", String(status));
    }
    assert.equal(storageError({ statusCode: "413" }).kind, "storage_rejected");
    for (const status of [401, 403, 404, 409, 500, 502, undefined]) {
      assert.equal(storageError({ status }).kind, "storage_transient", String(status));
    }
  });
});

describe("claimRuns / heartbeat", () => {
  it("calls the migration 009 function with its exact parameter names and maps the rows", async () => {
    const { repo, log } = fakeClient({
      rpc: {
        worker_claim_research_runs: {
          data: [
            RUN_ROW,
            { ...RUN_ROW, id: "run-2", trigger_source: "scheduled", requested_by: null },
            {
              ...RUN_ROW,
              id: "run-3",
              trigger_source: "something-new",
              cancel_requested_at: "2026-11-05T00:00:00Z",
            },
          ],
          error: null,
        },
      },
    });
    const runs = await repo.claimRuns("worker-1", 3, 300);
    assert.deepEqual(log.rpc, [
      {
        name: "worker_claim_research_runs",
        args: { p_worker_id: "worker-1", p_limit: 3, p_lease_seconds: 300 },
      },
    ]);
    assert.deepEqual(runs[0], {
      id: "run-1",
      workspaceId: "ws-1",
      leadId: "lead-1",
      requestedBy: "user-1",
      triggerSource: "manual",
      attempts: 1,
      maxAttempts: 3,
      cancelRequested: false,
    });
    assert.equal(runs[1].triggerSource, "scheduled");
    assert.equal(runs[1].requestedBy, null);
    assert.equal(runs[2].triggerSource, "manual", "an unknown source gets the stricter rule");
    assert.equal(runs[2].cancelRequested, true);
  });

  it("returns an empty list when nothing is queued", async () => {
    const { repo } = fakeClient({
      rpc: { worker_claim_research_runs: { data: null, error: null } },
    });
    assert.deepEqual(await repo.claimRuns("w", 3, 300), []);
  });

  it("maps heartbeat answers and its parameters", async () => {
    const t = fakeClient({ rpc: { worker_heartbeat_research_run: { data: true, error: null } } });
    assert.equal(await t.repo.heartbeat("run-1", "worker-1", 300), true);
    assert.deepEqual(t.log.rpc[0].args, {
      p_run_id: "run-1",
      p_worker_id: "worker-1",
      p_lease_seconds: 300,
    });
    const f = fakeClient({ rpc: { worker_heartbeat_research_run: { data: false, error: null } } });
    assert.equal(await f.repo.heartbeat("run-1", "worker-1", 300), false);
  });
});

describe("completeRun / failRun", () => {
  const payload = {
    pipeline_version: "research-v1",
    warnings: [],
    usage: { pages_fetched: 1 },
    sources: [],
    findings: [],
  } as unknown as CompletionPayload;

  it("passes the run, worker and payload and returns the database's status", async () => {
    for (const status of ["completed", "completed_with_warnings", "cancelled"]) {
      const t = fakeClient({
        rpc: { worker_complete_research_run: { data: status, error: null } },
      });
      assert.equal(await t.repo.completeRun("run-1", "worker-1", payload), status);
      assert.deepEqual(t.log.rpc[0], {
        name: "worker_complete_research_run",
        args: { p_run_id: "run-1", p_worker_id: "worker-1", p_result: payload },
      });
    }
  });

  it("treats an unknown completion answer as uncertain, never as success", async () => {
    const t = fakeClient({
      rpc: { worker_complete_research_run: { data: "something", error: null } },
    });
    await assert.rejects(t.repo.completeRun("r", "w", payload), kind("transient"));
  });

  it("passes the failure and returns the database's status", async () => {
    for (const status of ["queued", "failed", "cancelled"]) {
      const t = fakeClient({ rpc: { worker_fail_research_run: { data: status, error: null } } });
      const out = await t.repo.failRun("run-1", "worker-1", {
        code: "http_status",
        message: "m",
        retryable: true,
      });
      assert.equal(out, status);
      assert.deepEqual(t.log.rpc[0].args, {
        p_run_id: "run-1",
        p_worker_id: "worker-1",
        p_error_code: "http_status",
        p_error_message: "m",
        p_retryable: true,
      });
    }
  });

  it("translates database errors by code and never exposes their text", async () => {
    const cases: [string, string][] = [
      ["55000", "lease_lost"],
      ["P0002", "not_found"],
      ["23514", "invalid_result"],
      ["08006", "transient"],
    ];
    for (const [code, expected] of cases) {
      const t = fakeClient({
        rpc: { worker_complete_research_run: { data: null, error: { ...LEAKY, code } } },
      });
      await assert.rejects(t.repo.completeRun("r", "w", payload), (e: unknown) => {
        assert.ok(e instanceof RepositoryError);
        assert.equal(e.kind, expected);
        assert.doesNotMatch(e.message, /research_runs|hunter2|XX000/);
        return true;
      });
    }
  });

  it("turns a thrown network error into a transient error with a fixed message", async () => {
    const t = fakeClient({
      rpc: {
        worker_complete_research_run: new TypeError("fetch failed: https://x.supabase.co key=abc"),
      },
    });
    await assert.rejects(t.repo.completeRun("r", "w", payload), (e: unknown) => {
      assert.ok(e instanceof RepositoryError && e.kind === "transient");
      assert.doesNotMatch(e.message, /supabase|key=abc/);
      return true;
    });
  });
});

describe("reads are always scoped by workspace", () => {
  it("looks up a run by workspace AND id", async () => {
    const t = fakeClient({
      tables: {
        research_runs: {
          data: { status: "running", locked_by: "worker-1", cancel_requested_at: null },
          error: null,
        },
      },
    });
    const snap = await t.repo.getRunSnapshot({ id: "run-1", workspaceId: "ws-1" });
    assert.deepEqual(snap, { status: "running", lockedBy: "worker-1", cancelRequested: false });
    assert.equal(t.log.queries[0].table, "research_runs");
    assert.deepEqual(t.log.queries[0].filters, [
      ["workspace_id", "ws-1"],
      ["id", "run-1"],
    ]);
  });

  it("returns null for a missing run and rejects an unknown status as uncertain", async () => {
    const none = fakeClient({ tables: { research_runs: { data: null, error: null } } });
    assert.equal(await none.repo.getRunSnapshot({ id: "r", workspaceId: "w" }), null);
    const odd = fakeClient({
      tables: {
        research_runs: {
          data: { status: "weird", locked_by: null, cancel_requested_at: null },
          error: null,
        },
      },
    });
    await assert.rejects(odd.repo.getRunSnapshot({ id: "r", workspaceId: "w" }), kind("transient"));
  });

  it("looks up a lead by workspace AND id and selects only what it needs", async () => {
    const t = fakeClient({
      tables: {
        leads: {
          data: {
            id: "lead-1",
            workspace_id: "ws-1",
            company_name: "Acme",
            website: "acme.com",
            suppressed: false,
          },
          error: null,
        },
      },
    });
    const lead = await t.repo.getLead("ws-1", "lead-1");
    assert.deepEqual(lead, {
      id: "lead-1",
      workspaceId: "ws-1",
      companyName: "Acme",
      website: "acme.com",
      suppressed: false,
    });
    assert.deepEqual(t.log.queries[0].filters, [
      ["workspace_id", "ws-1"],
      ["id", "lead-1"],
    ]);
    assert.equal(t.log.queries[0].select, "id, workspace_id, company_name, website, suppressed");
    const none = fakeClient({ tables: { leads: { data: null, error: null } } });
    assert.equal(await none.repo.getLead("ws-1", "lead-1"), null);
  });

  it("checks membership by workspace AND user", async () => {
    const yes = fakeClient({
      tables: { workspace_members: { data: { user_id: "u" }, error: null } },
    });
    assert.equal(await yes.repo.isWorkspaceMember("ws-1", "user-1"), true);
    assert.deepEqual(yes.log.queries[0].filters, [
      ["workspace_id", "ws-1"],
      ["user_id", "user-1"],
    ]);
    const no = fakeClient({ tables: { workspace_members: { data: null, error: null } } });
    assert.equal(await no.repo.isWorkspaceMember("ws-1", "user-1"), false);
  });

  it("does not turn a database error into 'not a member'", async () => {
    const t = fakeClient({ tables: { workspace_members: { data: null, error: LEAKY } } });
    await assert.rejects(t.repo.isWorkspaceMember("ws-1", "user-1"), kind("transient"));
  });
});

describe("private research-sources bucket", () => {
  it("uploads gzip evidence idempotently to the private bucket", async () => {
    const t = fakeClient({ upload: { data: { path: "p" }, error: null } });
    const body = Buffer.from("gzip bytes");
    await t.repo.uploadSource("ws/lead/run/abc.txt.gz", body);
    assert.deepEqual(t.log.uploads, [
      {
        bucket: "research-sources",
        path: "ws/lead/run/abc.txt.gz",
        body,
        options: { contentType: "application/gzip", upsert: true },
      },
    ]);
  });

  it("classifies upload errors without exposing their text", async () => {
    for (const [error, expected] of [
      [{ status: 413, message: "secret hunter2" }, "storage_rejected"],
      [{ statusCode: "415", message: "secret hunter2" }, "storage_rejected"],
      [{ status: 500, message: "secret hunter2" }, "storage_transient"],
      [{ message: "fetch failed hunter2" }, "storage_transient"],
    ] as const) {
      const t = fakeClient({ upload: { data: null, error } });
      await assert.rejects(t.repo.uploadSource("p", Buffer.from("x")), (e: unknown) => {
        assert.ok(e instanceof RepositoryError);
        assert.equal(e.kind, expected);
        assert.doesNotMatch(e.message, /hunter2/);
        return true;
      });
    }
    const thrown = fakeClient({ upload: new Error("socket hang up hunter2") });
    await assert.rejects(
      thrown.repo.uploadSource("p", Buffer.from("x")),
      kind("storage_transient"),
    );
  });

  it("removes objects from the same bucket, and skips the call for an empty list", async () => {
    const t = fakeClient({ remove: { data: [], error: null } });
    await t.repo.removeSources([]);
    assert.equal(t.log.removes.length, 0);
    await t.repo.removeSources(["a", "b"]);
    assert.deepEqual(t.log.removes, [{ bucket: "research-sources", paths: ["a", "b"] }]);
    const bad = fakeClient({ remove: { data: null, error: { status: 500 } } });
    await assert.rejects(bad.repo.removeSources(["a"]), kind("storage_transient"));
  });
});

describe("maintenance functions", () => {
  it("lists purge candidates, orphans and marks purged using the 009 parameter names", async () => {
    const t = fakeClient({
      rpc: {
        worker_research_text_due_for_purge: {
          data: [{ source_id: "s1", run_id: "r1", storage_path: "p1" }],
          error: null,
        },
        worker_research_orphan_objects: {
          data: [{ storage_path: "o1" }, { storage_path: "o2" }],
          error: null,
        },
        worker_mark_research_text_purged: { data: 1, error: null },
      },
    });
    assert.deepEqual(await t.repo.listPurgeCandidates(200), [
      { sourceId: "s1", storagePath: "p1" },
    ]);
    assert.deepEqual(await t.repo.listOrphanPaths(200), ["o1", "o2"]);
    assert.equal(await t.repo.markPurged(["s1"]), 1);
    assert.deepEqual(
      t.log.rpc.map((c) => [c.name, c.args]),
      [
        ["worker_research_text_due_for_purge", { p_limit: 200 }],
        ["worker_research_orphan_objects", { p_limit: 200 }],
        ["worker_mark_research_text_purged", { p_source_ids: ["s1"] }],
      ],
    );
  });

  it("does not call the database to mark nothing", async () => {
    const t = fakeClient();
    assert.equal(await t.repo.markPurged([]), 0);
    assert.equal(t.log.rpc.length, 0);
  });
});
