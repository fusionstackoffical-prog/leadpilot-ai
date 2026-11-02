// Retry/idempotency behaviour of the import service against a scripted fake client.
// (The same code is exercised end-to-end against Supabase by the live suite.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeImport,
  ImportError,
  stageRows,
  uploadImportFile,
} from "../../src/features/imports/service.ts";
import type { StagedRow } from "../../src/features/imports/validate.ts";

type Result = {
  data?: unknown;
  error?: { code?: string; message: string; statusCode?: string } | null;
  count?: number;
};

/** Minimal chainable stand-in for the supabase-js query builder. */
function fakeClient(script: { upserts?: Result[]; count?: number; status?: string; rpc?: Result }) {
  const calls = { upserts: [] as unknown[][], updates: [] as unknown[], rpc: 0 };
  const upserts = [...(script.upserts ?? [])];
  const chain = (result: () => Result) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "neq", "order", "range", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => result();
    q.single = async () => result();
    q.then = (resolve: (v: Result) => unknown) => resolve(result());
    return q;
  };
  const client = {
    from: () => ({
      upsert: (rows: unknown[]) => {
        calls.upserts.push(rows);
        return Promise.resolve(upserts.shift() ?? { error: null });
      },
      select: () =>
        chain(() => ({
          count: script.count,
          data: { id: "imp", status: script.status },
          error: null,
        })),
      update: (values: unknown) => {
        calls.updates.push(values);
        return chain(() => ({
          data: { id: "imp", status: (values as { status?: string }).status },
          error: null,
        }));
      },
    }),
    rpc: async () => {
      calls.rpc++;
      return script.rpc ?? { data: { id: "imp", status: "completed" }, error: null };
    },
    storage: { from: () => ({ upload: async () => script.upserts?.[0] ?? { error: null } }) },
  };
  return { client: client as never, calls };
}

const rows = (n: number): StagedRow[] =>
  Array.from({ length: n }, (_, i) => ({
    rowNumber: i + 2,
    raw: {},
    mapped: {},
    status: "valid",
    issues: [],
  }));
const target = { workspaceId: "w", importId: "imp", sheetId: "s" };

describe("stageRows", () => {
  it("sends batches and verifies the stored count", async () => {
    const { client, calls } = fakeClient({ count: 1200 });
    const progress: number[] = [];
    await stageRows(client, target, rows(1200), { onProgress: (d) => progress.push(d) });
    assert.deepEqual(calls.upserts.map((b) => b.length).sort(), [200, 500, 500]);
    assert.equal(progress.at(-1), 1200, "progress ends at the total");
    assert.ok(
      progress.every((v, i) => i === 0 || v > progress[i - 1]),
      "progress only increases",
    );
  });

  it("retries a transient failure and then succeeds", async () => {
    const { client, calls } = fakeClient({
      count: 10,
      upserts: [{ error: { code: "08006", message: "network" } }, { error: null }],
    });
    await stageRows(client, target, rows(10), { attempts: 3, concurrency: 1 });
    assert.equal(calls.upserts.length, 2);
  });

  it("does not retry permission errors and reports where it stopped", async () => {
    const { client, calls } = fakeClient({
      upserts: [{ error: null }, { error: { code: "42501", message: "denied" } }],
    });
    await assert.rejects(
      stageRows(client, target, rows(800), { batchSize: 500, concurrency: 1 }),
      (e: ImportError) => {
        assert.match(e.message, /at row 502/);
        return e instanceof ImportError && e.step === "stage";
      },
    );
    assert.equal(calls.upserts.length, 2);
  });

  it("never reports success when the stored count doesn't match", async () => {
    const { client } = fakeClient({ count: 9 });
    await assert.rejects(stageRows(client, target, rows(10)), /Expected 10 saved rows but found 9/);
  });
});

describe("upload and completion are safe to retry", () => {
  it("treats 'already exists' on re-upload as success", async () => {
    const { client } = fakeClient({
      upserts: [{ error: { statusCode: "409", message: "The resource already exists" } }],
    });
    await uploadImportFile(
      client,
      { storage_path: "w/i/f.csv" } as never,
      new Blob(["x"]),
      "text/csv",
    );
  });

  it("maps size and type rejections to clear messages", async () => {
    const big = fakeClient({
      upserts: [{ error: { statusCode: "413", message: "Payload too large" } }],
    });
    await assert.rejects(
      uploadImportFile(big.client, { storage_path: "p" } as never, new Blob(["x"]), "text/csv"),
      /25 MiB/,
    );
    const mime = fakeClient({
      upserts: [{ error: { statusCode: "415", message: "mime type not supported" } }],
    });
    await assert.rejects(
      uploadImportFile(mime.client, { storage_path: "p" } as never, new Blob(["x"]), "text/csv"),
      /isn't allowed/,
    );
  });

  it("returns an already-completed import without calling the database again", async () => {
    const { client, calls } = fakeClient({ status: "completed" });
    const r = await completeImport(client, "imp");
    assert.equal(r.status, "completed");
    assert.equal(calls.rpc, 0);
  });
});
