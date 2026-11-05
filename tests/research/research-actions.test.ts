// The Research and Cancel actions: authentication, workspace derivation, validation,
// configuration gating, eligibility, every database outcome and the cancel permissions. All
// dependencies are in-memory fakes: no Supabase, no network, no real company.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.ts";
import {
  cancelResearchCore,
  createResearchGateway,
  IDLE_STATE,
  requestResearchCore,
  type ResearchActionDeps,
  type ResearchGateway,
} from "../../src/features/research/actions-core.ts";
import {
  LEAD_FOR_ACTION_COLUMNS,
  RUN_FOR_CANCEL_COLUMNS,
} from "../../src/features/research/columns.ts";
import {
  INVALID_WEBSITE_MESSAGE,
  NEEDS_WEBSITE_MESSAGE,
  researchEligibility,
  SUPPRESSED_MESSAGE,
} from "../../src/features/research/eligibility.ts";
import {
  evaluateResearchSetup,
  SETUP_LABELS,
  type ResearchSetup,
} from "../../src/features/research/setup-core.ts";

const USER = { id: "33333333-3333-4333-8333-333333333333" };
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const LEAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_LEAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = "key-0123456789abcdef";
const READY: ResearchSetup = { ready: true };

type GatewayOverrides = {
  loadLead?: Awaited<ReturnType<ResearchGateway["loadLead"]>>;
  request?: Awaited<ReturnType<ResearchGateway["requestResearch"]>>;
  loadRun?: Awaited<ReturnType<ResearchGateway["loadRun"]>>;
  cancel?: Awaited<ReturnType<ResearchGateway["cancelResearch"]>>;
};

function harness(
  options: {
    user?: { id: string } | null;
    workspace?: { id: string; role: string } | null;
    setup?: ResearchSetup;
  } & GatewayOverrides = {},
) {
  const calls: string[] = [];
  const seen = {
    loadLead: [] as { workspaceId: string; leadId: string }[],
    request: [] as { workspaceId: string; leadId: string; requestKey: string }[],
    loadRun: [] as { workspaceId: string; runId: string }[],
    cancel: [] as string[],
  };
  const revalidated: string[] = [];

  const gateway: ResearchGateway = {
    async loadLead(workspaceId, leadId) {
      calls.push("loadLead");
      seen.loadLead.push({ workspaceId, leadId });
      return (
        options.loadLead ?? {
          ok: true,
          value: { website: "https://acme-co.com", suppressed: false },
        }
      );
    },
    async requestResearch(args) {
      calls.push("requestResearch");
      seen.request.push(args);
      return options.request ?? { ok: true, value: "queued" };
    },
    async loadRun(workspaceId, runId) {
      calls.push("loadRun");
      seen.loadRun.push({ workspaceId, runId });
      return (
        options.loadRun ?? {
          ok: true,
          value: { leadId: LEAD, status: "running", requestedBy: USER.id },
        }
      );
    },
    async cancelResearch(runId) {
      calls.push("cancelResearch");
      seen.cancel.push(runId);
      return options.cancel ?? { ok: true, value: "cancel_requested" };
    },
  };

  const deps: ResearchActionDeps = {
    getUser: async () => {
      calls.push("getUser");
      return options.user === undefined ? USER : options.user;
    },
    getWorkspace: async () => {
      calls.push("getWorkspace");
      return options.workspace === undefined ? { id: WS, role: "member" } : options.workspace;
    },
    getSetup: () => {
      calls.push("getSetup");
      return options.setup ?? READY;
    },
    gateway,
    revalidate: (path) => revalidated.push(path),
  };
  return { deps, calls, seen, revalidated };
}

const form = (fields: Record<string, string | undefined>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
};
const requestForm = (over: Record<string, string | undefined> = {}) =>
  form({ leadId: LEAD, requestKey: KEY, ...over });
const cancelForm = (over: Record<string, string | undefined> = {}) =>
  form({ runId: RUN, leadId: LEAD, ...over });

describe("requestResearch: authentication and workspace", () => {
  it("an unauthenticated request does nothing at all", async () => {
    const h = harness({ user: null });
    assert.deepEqual(await requestResearchCore(requestForm(), h.deps), {
      status: "unauthenticated",
    });
    assert.deepEqual(h.calls, ["getUser"], "no workspace lookup, no database call");
    assert.deepEqual(h.revalidated, []);
  });

  it("a user with no workspace is refused before anything is read or queued", async () => {
    const h = harness({ workspace: null });
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /workspace/);
    assert.deepEqual(h.calls, ["getUser", "getWorkspace"]);
  });

  it("takes the workspace from the server session, never from the submitted form", async () => {
    const h = harness();
    await requestResearchCore(
      requestForm({
        workspaceId: OTHER_WS,
        workspace_id: OTHER_WS,
        workspace: OTHER_WS,
        p_workspace_id: OTHER_WS,
      }),
      h.deps,
    );
    assert.deepEqual(h.seen.loadLead, [{ workspaceId: WS, leadId: LEAD }]);
    assert.deepEqual(h.seen.request, [{ workspaceId: WS, leadId: LEAD, requestKey: KEY }]);
    assert.ok(!JSON.stringify(h.seen).includes(OTHER_WS));
  });
});

describe("requestResearch: input validation", () => {
  const invalid: [string, Record<string, string | undefined>][] = [
    ["a missing company", { leadId: undefined }],
    ["an empty company", { leadId: "" }],
    ["a company id that isn't a UUID", { leadId: "not-a-uuid" }],
    ["a SQL-looking company id", { leadId: `${LEAD}'; drop table leads;--` }],
    ["a missing request key", { requestKey: undefined }],
    ["a request key that is too short", { requestKey: "short" }],
    ["a request key that is too long", { requestKey: "k".repeat(65) }],
    ["a request key with spaces", { requestKey: "key with spaces 123" }],
    ["a request key with symbols", { requestKey: "key-<script>-123456" }],
  ];

  for (const [name, over] of invalid) {
    it(`rejects ${name}, without calling the database`, async () => {
      const h = harness();
      const r = await requestResearchCore(requestForm(over), h.deps);
      assert.equal(r.status, "error");
      assert.match(r.message ?? "", /wasn't valid/);
      assert.deepEqual(h.calls, ["getUser", "getWorkspace"]);
    });
  }

  it("accepts a normal UUID key, as the profile page generates", async () => {
    const h = harness();
    const r = await requestResearchCore(requestForm({ requestKey: crypto.randomUUID() }), h.deps);
    assert.equal(r.status, "success");
  });
});

describe("requestResearch: configuration", () => {
  it("never queues anything while research is not configured, and says what is missing", async () => {
    const setup: ResearchSetup = {
      ready: false,
      missing: [SETUP_LABELS.contactUrl, SETUP_LABELS.workerSecret],
    };
    const h = harness({ setup });
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /nothing was queued/);
    assert.match(r.message ?? "", /RESEARCH_BOT_CONTACT_URL/);
    assert.match(r.message ?? "", /RESEARCH_WORKER_SECRET/);
    assert.ok(!h.calls.includes("loadLead") && !h.calls.includes("requestResearch"));
    assert.deepEqual(h.revalidated, []);
  });
});

describe("requestResearch: the company must exist and be eligible", () => {
  it("rejects a company that isn't in the workspace (RLS returns nothing)", async () => {
    const h = harness({ loadLead: { ok: true, value: null } });
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /wasn't found in your workspace/);
    assert.ok(!h.calls.includes("requestResearch"));
  });

  it("does not guess when the company can't be loaded", async () => {
    const h = harness({ loadLead: { ok: false, code: "XX000" } });
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.equal(r.status, "error");
    assert.ok(!h.calls.includes("requestResearch"));
  });

  it("rejects a suppressed company", async () => {
    const h = harness({
      loadLead: { ok: true, value: { website: "https://acme-co.com", suppressed: true } },
    });
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.deepEqual(r, { status: "error", message: SUPPRESSED_MESSAGE });
    assert.ok(!h.calls.includes("requestResearch"));
  });

  for (const website of [null, "", "   "]) {
    it(`rejects a company with no website (${JSON.stringify(website)}) and explains why`, async () => {
      const h = harness({ loadLead: { ok: true, value: { website, suppressed: false } } });
      const r = await requestResearchCore(requestForm(), h.deps);
      assert.deepEqual(r, { status: "error", message: NEEDS_WEBSITE_MESSAGE });
      assert.ok(!h.calls.includes("requestResearch"));
    });
  }

  for (const website of [
    "javascript:alert(1)",
    "data:text/html,x",
    "mailto:someone@acme-co.com",
    "someone@acme-co.com",
    "localhost",
    "http://localhost:3000",
    "192.168.1.10",
    "http://10.0.0.1/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://user:pass@acme-co.com/",
    "ftp://acme-co.com",
    "not a website",
    "acme",
    "acme.c",
    "https://acme-co.com:8443/",
    "file:///etc/passwd",
    "x".repeat(2100),
  ]) {
    it(`rejects an invalid website value: ${website.slice(0, 40)}`, async () => {
      const h = harness({ loadLead: { ok: true, value: { website, suppressed: false } } });
      const r = await requestResearchCore(requestForm(), h.deps);
      assert.deepEqual(r, { status: "error", message: INVALID_WEBSITE_MESSAGE });
      assert.ok(!h.calls.includes("requestResearch"));
    });
  }

  for (const website of [
    "acme-co.com",
    "www.acme-co.com",
    "https://acme-co.com",
    "http://acme-co.com/about",
    "https://sub.domain.acme-co.co.uk/path?x=1",
    "  https://acme-co.com  ",
  ]) {
    it(`accepts a valid-looking website: ${website}`, async () => {
      const h = harness({ loadLead: { ok: true, value: { website, suppressed: false } } });
      const r = await requestResearchCore(requestForm(), h.deps);
      assert.equal(r.status, "success");
      assert.equal(h.seen.request.length, 1);
    });
  }

  it("validates the website without any network or DNS lookup", async () => {
    // researchEligibility is synchronous and pure: nothing to await, nothing to mock.
    const result = researchEligibility({
      website: "definitely-not-registered-xyz.example",
      suppressed: false,
    });
    assert.deepEqual(result, { eligible: true });
  });
});

describe("requestResearch: every database outcome", () => {
  const cases: [string | null, "success" | "info" | "error", RegExp, boolean][] = [
    ["queued", "success", /Research queued/, true],
    ["duplicate_request", "info", /already received/, true],
    ["already_active", "info", /already queued or running/, true],
    ["not_found", "error", /suppressed/, false],
    ["limit_reached", "error", /limit was reached/, false],
    ["something_new", "error", /couldn't be started/, false],
    [null, "error", /couldn't be started/, false],
  ];

  for (const [outcome, status, message, revalidates] of cases) {
    it(`${outcome ?? "no outcome"} -> ${status}`, async () => {
      const h = harness({ request: { ok: true, value: outcome } });
      const r = await requestResearchCore(requestForm(), h.deps);
      assert.equal(r.status, status);
      assert.match(r.message ?? "", message);
      assert.deepEqual(h.revalidated, revalidates ? ["/research", `/research/${LEAD}`] : []);
    });
  }

  it("maps database errors by code, never exposing details, and does not revalidate", async () => {
    const expected: [string | null, RegExp][] = [
      ["42501", /permission/],
      ["22023", /wasn't valid/],
      ["XX000", /couldn't be started/],
      ["23505", /couldn't be started/],
      [null, /couldn't be started/],
    ];
    for (const [code, message] of expected) {
      const h = harness({ request: { ok: false, code } });
      const r = await requestResearchCore(requestForm(), h.deps);
      assert.equal(r.status, "error");
      assert.match(r.message ?? "", message, String(code));
      assert.deepEqual(h.revalidated, []);
    }
  });

  it("forwards the idempotency key exactly, for exactly one company", async () => {
    const h = harness();
    await requestResearchCore(requestForm({ requestKey: "my-key_0123456789" }), h.deps);
    assert.deepEqual(h.seen.request, [
      { workspaceId: WS, leadId: LEAD, requestKey: "my-key_0123456789" },
    ]);
  });

  it("the same key twice reaches the database twice, so the database can dedupe it", async () => {
    const h = harness({ request: { ok: true, value: "duplicate_request" } });
    await requestResearchCore(requestForm(), h.deps);
    const second = await requestResearchCore(requestForm(), h.deps);
    assert.equal(second.status, "info");
    assert.equal(h.seen.request.length, 2);
    assert.equal(h.seen.request[0].requestKey, h.seen.request[1].requestKey);
  });

  it("runs its checks in order: user, workspace, input, configuration, company, then the function", async () => {
    const h = harness();
    await requestResearchCore(requestForm(), h.deps);
    assert.deepEqual(h.calls, [
      "getUser",
      "getWorkspace",
      "getSetup",
      "loadLead",
      "requestResearch",
    ]);
  });

  it("returns only a small status object, never raw database data", async () => {
    const h = harness();
    const r = await requestResearchCore(requestForm(), h.deps);
    assert.deepEqual(Object.keys(r).sort(), ["message", "status"]);
  });
});

describe("cancelResearch", () => {
  it("an unauthenticated request does nothing", async () => {
    const h = harness({ user: null });
    assert.deepEqual(await cancelResearchCore(cancelForm(), h.deps), { status: "unauthenticated" });
    assert.deepEqual(h.calls, ["getUser"]);
  });

  it("a user with no workspace is refused", async () => {
    const h = harness({ workspace: null });
    assert.equal((await cancelResearchCore(cancelForm(), h.deps)).status, "error");
    assert.deepEqual(h.calls, ["getUser", "getWorkspace"]);
  });

  for (const [name, over] of [
    ["a missing run", { runId: undefined }],
    ["a run id that isn't a UUID", { runId: "1" }],
    ["a missing company", { leadId: undefined }],
    ["a company id that isn't a UUID", { leadId: "nope" }],
  ] as [string, Record<string, string | undefined>][]) {
    it(`rejects ${name} without touching the database`, async () => {
      const h = harness();
      const r = await cancelResearchCore(cancelForm(over), h.deps);
      assert.equal(r.status, "error");
      assert.match(r.message ?? "", /wasn't valid/);
      assert.deepEqual(h.calls, ["getUser", "getWorkspace"]);
    });
  }

  it("looks the run up inside the server-derived workspace, ignoring any workspace in the form", async () => {
    const h = harness();
    await cancelResearchCore(cancelForm({ workspaceId: OTHER_WS, workspace_id: OTHER_WS }), h.deps);
    assert.deepEqual(h.seen.loadRun, [{ workspaceId: WS, runId: RUN }]);
  });

  it("a run that isn't visible in the workspace is 'not found' and is never cancelled", async () => {
    const h = harness({ loadRun: { ok: true, value: null } });
    const r = await cancelResearchCore(cancelForm(), h.deps);
    assert.deepEqual(r, { status: "error", message: "That research run wasn't found." });
    assert.ok(!h.calls.includes("cancelResearch"));
  });

  it("does not guess when the run can't be loaded", async () => {
    const h = harness({ loadRun: { ok: false, code: null } });
    assert.equal((await cancelResearchCore(cancelForm(), h.deps)).status, "error");
    assert.ok(!h.calls.includes("cancelResearch"));
  });

  it("refuses a run that belongs to a different company than the form says", async () => {
    const h = harness();
    const r = await cancelResearchCore(cancelForm({ leadId: OTHER_LEAD }), h.deps);
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /wasn't valid/);
    assert.ok(!h.calls.includes("cancelResearch"));
  });

  it("reports an already-finished run without calling the database function", async () => {
    for (const status of ["completed", "completed_with_warnings", "failed", "cancelled"]) {
      const h = harness({
        loadRun: { ok: true, value: { leadId: LEAD, status, requestedBy: USER.id } },
      });
      const r = await cancelResearchCore(cancelForm(), h.deps);
      assert.equal(r.status, status === "cancelled" ? "success" : "info", status);
      assert.ok(!h.calls.includes("cancelResearch"), status);
    }
  });

  describe("permissions", () => {
    const run = (requestedBy: string | null) =>
      ({ ok: true, value: { leadId: LEAD, status: "queued", requestedBy } }) as const;

    it("the requester may cancel their own run", async () => {
      const h = harness({ workspace: { id: WS, role: "member" }, loadRun: run(USER.id) });
      const r = await cancelResearchCore(cancelForm(), h.deps);
      assert.equal(r.status, "success");
      assert.deepEqual(h.seen.cancel, [RUN]);
    });

    it("an ordinary member may NOT cancel someone else's run", async () => {
      const h = harness({ workspace: { id: WS, role: "member" }, loadRun: run(OTHER_USER) });
      const r = await cancelResearchCore(cancelForm(), h.deps);
      assert.equal(r.status, "error");
      assert.match(r.message ?? "", /requested this research, or a workspace owner or admin/);
      assert.ok(!h.calls.includes("cancelResearch"));
    });

    for (const role of ["owner", "admin"]) {
      it(`a workspace ${role} may cancel someone else's run`, async () => {
        const h = harness({ workspace: { id: WS, role }, loadRun: run(OTHER_USER) });
        const r = await cancelResearchCore(cancelForm(), h.deps);
        assert.equal(r.status, "success");
        assert.deepEqual(h.seen.cancel, [RUN]);
      });
    }

    it("a run whose requester account is gone can be cancelled only by an owner or admin", async () => {
      const member = harness({ workspace: { id: WS, role: "member" }, loadRun: run(null) });
      assert.equal((await cancelResearchCore(cancelForm(), member.deps)).status, "error");
      const owner = harness({ workspace: { id: WS, role: "owner" }, loadRun: run(null) });
      assert.equal((await cancelResearchCore(cancelForm(), owner.deps)).status, "success");
    });

    it("an unknown role gets no special rights", async () => {
      const h = harness({ workspace: { id: WS, role: "superuser" }, loadRun: run(OTHER_USER) });
      assert.equal((await cancelResearchCore(cancelForm(), h.deps)).status, "error");
    });
  });

  describe("every database answer", () => {
    const queuedRun = {
      ok: true,
      value: { leadId: LEAD, status: "running", requestedBy: USER.id },
    } as const;

    const answers: [string | null, "success" | "info" | "error", RegExp, boolean][] = [
      ["cancelled", "success", /Research cancelled/, true],
      ["cancel_requested", "success", /Cancellation requested/, true],
      ["completed", "info", /already finished/, true],
      ["completed_with_warnings", "info", /already finished/, true],
      ["failed", "info", /already finished/, true],
      ["running", "error", /couldn't be confirmed/, false],
      ["unexpected", "error", /couldn't be confirmed/, false],
      [null, "error", /couldn't be confirmed/, false],
    ];
    for (const [answer, status, message, revalidates] of answers) {
      it(`${answer ?? "no answer"} -> ${status}`, async () => {
        const h = harness({ loadRun: queuedRun, cancel: { ok: true, value: answer } });
        const r = await cancelResearchCore(cancelForm(), h.deps);
        assert.equal(r.status, status);
        assert.match(r.message ?? "", message);
        assert.deepEqual(h.revalidated, revalidates ? ["/research", `/research/${LEAD}`] : []);
      });
    }

    it("maps database errors by code and never revalidates", async () => {
      const expected: [string | null, RegExp][] = [
        ["42501", /requested this research, or a workspace owner or admin/],
        ["P0002", /wasn't found/],
        ["XX000", /couldn't be cancelled/],
        [null, /couldn't be cancelled/],
      ];
      for (const [code, message] of expected) {
        const h = harness({ loadRun: queuedRun, cancel: { ok: false, code } });
        const r = await cancelResearchCore(cancelForm(), h.deps);
        assert.equal(r.status, "error");
        assert.match(r.message ?? "", message, String(code));
        assert.deepEqual(h.revalidated, []);
      }
    });
  });

  it("does not require research to be configured: cancelling is always allowed", async () => {
    const h = harness({ setup: { ready: false, missing: ["x"] } });
    assert.equal((await cancelResearchCore(cancelForm(), h.deps)).status, "success");
    assert.ok(!h.calls.includes("getSetup"));
  });
});

describe("the database gateway (fake Supabase client)", () => {
  type Reply = { data?: unknown; error?: { code?: string } | null };

  function fakeClient(
    script: { rpc?: Record<string, Reply | Error>; tables?: Record<string, Reply | Error> } = {},
  ) {
    const log = {
      rpc: [] as { name: string; args: unknown }[],
      from: [] as { table: string; select: string; filters: [string, unknown][] }[],
    };
    const settle = (r: Reply | Error | undefined) =>
      r instanceof Error ? Promise.reject(r) : Promise.resolve(r ?? { data: null, error: null });
    const client = {
      rpc(name: string, args: unknown) {
        log.rpc.push({ name, args });
        return settle(script.rpc?.[name]);
      },
      from(table: string) {
        const q = { table, select: "", filters: [] as [string, unknown][] };
        log.from.push(q);
        const b = {
          select(cols: string) {
            q.select = cols;
            return b;
          },
          eq(col: string, value: unknown) {
            q.filters.push([col, value]);
            return b;
          },
          maybeSingle: () => settle(script.tables?.[table]),
        };
        return b;
      },
    } as unknown as SupabaseClient<Database>;
    return { client, log, gateway: createResearchGateway(client) };
  }

  it("requests research through request_lead_research with the exact parameters", async () => {
    const t = fakeClient({
      rpc: {
        request_lead_research: {
          data: [
            { lead_id: OTHER_LEAD, outcome: "limit_reached", run_id: null },
            { lead_id: LEAD, outcome: "queued", run_id: RUN },
          ],
          error: null,
        },
      },
    });
    const r = await t.gateway.requestResearch({ workspaceId: WS, leadId: LEAD, requestKey: KEY });
    assert.deepEqual(r, { ok: true, value: "queued" }, "the row for THIS company, not another");
    assert.deepEqual(t.log.rpc, [
      {
        name: "request_lead_research",
        args: { p_workspace_id: WS, p_lead_ids: [LEAD], p_request_key: KEY },
      },
    ]);
  });

  it("returns a null outcome when the function returns no row for the company", async () => {
    const t = fakeClient({ rpc: { request_lead_research: { data: [], error: null } } });
    assert.deepEqual(
      await t.gateway.requestResearch({ workspaceId: WS, leadId: LEAD, requestKey: KEY }),
      { ok: true, value: null },
    );
    const n = fakeClient({ rpc: { request_lead_research: { data: null, error: null } } });
    assert.deepEqual(
      await n.gateway.requestResearch({ workspaceId: WS, leadId: LEAD, requestKey: KEY }),
      { ok: true, value: null },
    );
  });

  it("cancels through cancel_research_run and nothing else", async () => {
    const t = fakeClient({
      rpc: { cancel_research_run: { data: "cancel_requested", error: null } },
    });
    assert.deepEqual(await t.gateway.cancelResearch(RUN), { ok: true, value: "cancel_requested" });
    assert.deepEqual(t.log.rpc, [{ name: "cancel_research_run", args: { p_run_id: RUN } }]);
  });

  it("reads the lead by workspace AND id, selecting only what the action needs", async () => {
    const t = fakeClient({
      tables: {
        leads: { data: { id: LEAD, website: "acme-co.com", suppressed: false }, error: null },
      },
    });
    assert.deepEqual(await t.gateway.loadLead(WS, LEAD), {
      ok: true,
      value: { website: "acme-co.com", suppressed: false },
    });
    assert.equal(t.log.from[0].table, "leads");
    assert.equal(t.log.from[0].select, LEAD_FOR_ACTION_COLUMNS);
    assert.deepEqual(t.log.from[0].filters, [
      ["workspace_id", WS],
      ["id", LEAD],
    ]);
    const none = fakeClient({ tables: { leads: { data: null, error: null } } });
    assert.deepEqual(await none.gateway.loadLead(WS, LEAD), { ok: true, value: null });
  });

  it("reads the run by workspace AND id, selecting only what cancelling needs", async () => {
    const t = fakeClient({
      tables: {
        research_runs: {
          data: { id: RUN, lead_id: LEAD, status: "queued", requested_by: USER.id },
          error: null,
        },
      },
    });
    assert.deepEqual(await t.gateway.loadRun(WS, RUN), {
      ok: true,
      value: { leadId: LEAD, status: "queued", requestedBy: USER.id },
    });
    assert.equal(t.log.from[0].table, "research_runs");
    assert.equal(t.log.from[0].select, RUN_FOR_CANCEL_COLUMNS);
    assert.deepEqual(t.log.from[0].filters, [
      ["workspace_id", WS],
      ["id", RUN],
    ]);
  });

  it("reports database errors by code only, and turns a thrown error into a failure without details", async () => {
    const leaky = { code: "42501", message: 'relation "research_runs" hunter2' };
    const e = fakeClient({
      rpc: {
        request_lead_research: { data: null, error: leaky },
        cancel_research_run: { data: null, error: { code: "P0002" } },
      },
      tables: { leads: { data: null, error: { code: "XX000" } } },
    });
    assert.deepEqual(
      await e.gateway.requestResearch({ workspaceId: WS, leadId: LEAD, requestKey: KEY }),
      { ok: false, code: "42501" },
    );
    assert.deepEqual(await e.gateway.cancelResearch(RUN), { ok: false, code: "P0002" });
    assert.deepEqual(await e.gateway.loadLead(WS, LEAD), { ok: false, code: "XX000" });

    const boom = new Error("connect ECONNREFUSED postgres://user:hunter2@db/prod");
    const t = fakeClient({
      rpc: { request_lead_research: boom, cancel_research_run: boom },
      tables: { leads: boom, research_runs: boom },
    });
    for (const result of [
      await t.gateway.requestResearch({ workspaceId: WS, leadId: LEAD, requestKey: KEY }),
      await t.gateway.cancelResearch(RUN),
      await t.gateway.loadLead(WS, LEAD),
      await t.gateway.loadRun(WS, RUN),
    ]) {
      assert.deepEqual(result, { ok: false, code: null });
      assert.doesNotMatch(JSON.stringify(result), /hunter2|postgres/);
    }
  });

  it("a full request touches only the leads table and request_lead_research", async () => {
    const t = fakeClient({
      tables: {
        leads: {
          data: { id: LEAD, website: "https://acme-co.com", suppressed: false },
          error: null,
        },
      },
      rpc: {
        request_lead_research: {
          data: [{ lead_id: LEAD, outcome: "queued", run_id: RUN }],
          error: null,
        },
      },
    });
    const deps: ResearchActionDeps = {
      getUser: async () => USER,
      getWorkspace: async () => ({ id: WS, role: "member" }),
      getSetup: () => READY,
      gateway: t.gateway,
      revalidate: () => {},
    };
    const r = await requestResearchCore(requestForm(), deps);
    assert.equal(r.status, "success");
    assert.deepEqual(
      t.log.from.map((q) => q.table),
      ["leads"],
    );
    assert.deepEqual(
      t.log.rpc.map((c) => c.name),
      ["request_lead_research"],
    );
  });

  it("a full cancel touches only research_runs and cancel_research_run", async () => {
    const t = fakeClient({
      tables: {
        research_runs: {
          data: { id: RUN, lead_id: LEAD, status: "running", requested_by: USER.id },
          error: null,
        },
      },
      rpc: { cancel_research_run: { data: "cancel_requested", error: null } },
    });
    const deps: ResearchActionDeps = {
      getUser: async () => USER,
      getWorkspace: async () => ({ id: WS, role: "member" }),
      getSetup: () => READY,
      gateway: t.gateway,
      revalidate: () => {},
    };
    assert.equal((await cancelResearchCore(cancelForm(), deps)).status, "success");
    assert.deepEqual(
      t.log.from.map((q) => q.table),
      ["research_runs"],
    );
    assert.deepEqual(
      t.log.rpc.map((c) => c.name),
      ["cancel_research_run"],
    );
  });
});

describe("research setup status", () => {
  const SECRET = "0123456789abcdef".repeat(2);
  const KEYVALUE = "service-role-key-value-that-is-long-enough-123456";
  const goodEnv = {
    RESEARCH_BOT_CONTACT_URL: "https://example.com/bot-info",
    RESEARCH_WORKER_SECRET: SECRET,
    SUPABASE_SERVICE_ROLE_KEY: KEYVALUE,
  };

  it("is ready only when all three settings are valid", () => {
    assert.deepEqual(evaluateResearchSetup(goodEnv), { ready: true });
  });

  it("is not ready on this machine today: nothing configured", () => {
    const r = evaluateResearchSetup({});
    assert.deepEqual(r, {
      ready: false,
      missing: [SETUP_LABELS.contactUrl, SETUP_LABELS.workerSecret, SETUP_LABELS.serviceKey],
    });
  });

  it("names each missing setting individually", () => {
    const without = (name: keyof typeof goodEnv) => {
      const env: Record<string, string | undefined> = { ...goodEnv };
      delete env[name];
      return evaluateResearchSetup(env);
    };
    assert.deepEqual(without("RESEARCH_BOT_CONTACT_URL"), {
      ready: false,
      missing: [SETUP_LABELS.contactUrl],
    });
    assert.deepEqual(without("RESEARCH_WORKER_SECRET"), {
      ready: false,
      missing: [SETUP_LABELS.workerSecret],
    });
    assert.deepEqual(without("SUPABASE_SERVICE_ROLE_KEY"), {
      ready: false,
      missing: [SETUP_LABELS.serviceKey],
    });
  });

  it("treats invalid values as missing, using the same rules as the worker", () => {
    for (const url of [
      "http://example.com/bot",
      "https://localhost/bot",
      "https://192.168.0.1/bot",
      "not a url",
      "https://example.com/has space",
      "https://u:p@example.com/",
      "",
    ]) {
      assert.deepEqual(
        evaluateResearchSetup({ ...goodEnv, RESEARCH_BOT_CONTACT_URL: url }),
        { ready: false, missing: [SETUP_LABELS.contactUrl] },
        url,
      );
    }
    for (const secret of [
      "short",
      "has a space in the middle of a long secret value",
      `${SECRET} x`,
      "",
    ]) {
      assert.deepEqual(
        evaluateResearchSetup({ ...goodEnv, RESEARCH_WORKER_SECRET: secret }),
        { ready: false, missing: [SETUP_LABELS.workerSecret] },
        secret,
      );
    }
    assert.deepEqual(evaluateResearchSetup({ ...goodEnv, SUPABASE_SERVICE_ROLE_KEY: "short" }), {
      ready: false,
      missing: [SETUP_LABELS.serviceKey],
    });
  });

  it("never contains a value: only fixed labels", () => {
    const env = {
      RESEARCH_BOT_CONTACT_URL: "http://insecure.example.com/secret-path-123",
      RESEARCH_WORKER_SECRET: "a b",
      SUPABASE_SERVICE_ROLE_KEY: "tiny",
    };
    const r = evaluateResearchSetup(env);
    const text = JSON.stringify(r);
    for (const value of Object.values(env)) assert.ok(!text.includes(value), value);
    assert.equal(r.ready, false);
    for (const label of (r as { missing: string[] }).missing) {
      assert.ok((Object.values(SETUP_LABELS) as string[]).includes(label));
    }
    const ok = JSON.stringify(evaluateResearchSetup(goodEnv));
    for (const value of Object.values(goodEnv)) assert.ok(!ok.includes(value));
  });
});

describe("research eligibility", () => {
  it("suppression wins over everything else", () => {
    assert.deepEqual(researchEligibility({ website: "https://acme-co.com", suppressed: true }), {
      eligible: false,
      reason: "suppressed",
      message: SUPPRESSED_MESSAGE,
    });
    assert.equal(researchEligibility({ website: null, suppressed: true }).eligible, false);
  });

  it("separates 'no website' from 'invalid website'", () => {
    const none = researchEligibility({ website: undefined, suppressed: false });
    assert.equal(none.eligible === false && none.reason, "no_website");
    const bad = researchEligibility({ website: "localhost", suppressed: false });
    assert.equal(bad.eligible === false && bad.reason, "invalid_website");
    assert.match(NEEDS_WEBSITE_MESSAGE, /valid website address/);
    assert.match(INVALID_WEBSITE_MESSAGE, /not an email address, IP address or internal host/);
  });
});

describe("initial state", () => {
  it("is idle, with no message", () => {
    assert.deepEqual(IDLE_STATE, { status: "idle" });
  });
});
