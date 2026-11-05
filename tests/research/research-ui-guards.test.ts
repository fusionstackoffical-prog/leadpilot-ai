// Guards on how the research dashboard is built. They read the real source files and fail if an
// invariant is weakened later: who may write, which database functions are called, which columns
// are read, what the browser can reach, and how untrusted website content is rendered.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as columns from "../../src/features/research/columns.ts";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
}

/** The dashboard's research code: the feature (minus the engine and worker) and its two pages. */
const FEATURE = walk("src/features/research").filter(
  (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/engine/") && !f.includes("/worker/"),
);
const PAGES = [
  "src/app/(dashboard)/research/page.tsx",
  "src/app/(dashboard)/research/[leadId]/page.tsx",
];
const DASHBOARD = [...FEATURE, ...PAGES];
const COMPONENTS = FEATURE.filter((f) => f.includes("/components/"));

const specifiers = (source: string) =>
  [...source.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

/** Source without comments, so a guard can't be tripped (or fooled) by prose. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The expressions of every `href={...}`, with braces inside template literals balanced. */
function hrefExpressions(source: string): string[] {
  const out: string[] = [];
  for (const start of source.matchAll(/href=\{/g)) {
    let depth = 1;
    let i = (start.index ?? 0) + start[0].length;
    const begin = i;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    out.push(source.slice(begin, i - 1).trim());
  }
  return out;
}

describe("every research UI write goes through the two approved database functions", () => {
  it("calls exactly request_lead_research and cancel_research_run, and only from actions-core", () => {
    const calls = new Map<string, string[]>();
    for (const file of DASHBOARD) {
      for (const m of code(read(file)).matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) {
        calls.set(m[1], [...(calls.get(m[1]) ?? []), file]);
      }
    }
    assert.deepEqual([...calls.keys()].sort(), ["cancel_research_run", "request_lead_research"]);
    for (const [name, files] of calls) {
      assert.deepEqual(
        [...new Set(files)],
        ["src/features/research/actions-core.ts"],
        `${name} may only be called from actions-core.ts`,
      );
    }
  });

  it("never writes to any table directly", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(
        code(read(file)),
        /\.(insert|update|upsert|delete)\(/,
        `${file} must not write to the database directly`,
      );
    }
  });

  it("never calls the worker's own database functions", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(code(read(file)), /worker_[a-z_]+/, file);
    }
  });

  it("does not touch Storage or create signed URLs: stored page text is never exposed", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(
        code(read(file)),
        /createSignedUrl|\.storage\b|research-sources|getPublicUrl/,
        file,
      );
    }
  });
});

describe("the service-role client is never used for user-triggered research", () => {
  it("no dashboard file imports or builds an admin client", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(read(file), /lib\/supabase\/admin|createAdminClient/, file);
    }
  });

  it("only the configuration check names the service key, and only to test that it is set", () => {
    const naming = DASHBOARD.filter((f) =>
      /SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(code(read(f))),
    );
    assert.deepEqual(naming, ["src/features/research/setup-core.ts"]);
    const core = code(read("src/features/research/setup-core.ts"));
    assert.doesNotMatch(core, /createClient|createAdminClient|from\(|rpc\(/);
  });

  it("environment variables are read in one place only (setup.ts)", () => {
    const readers = DASHBOARD.filter((f) => /process\.env/.test(code(read(f))));
    assert.deepEqual(readers, ["src/features/research/setup.ts"]);
  });
});

describe("actions.ts", () => {
  const source = read("src/features/research/actions.ts");

  it("is a thin 'use server' module that exports only the two async actions", () => {
    assert.match(source, /^"use server";/);
    const exported = [...source.matchAll(/^export\s+(.+?)\s*[({=]/gm)].map((m) => m[1]);
    assert.deepEqual(exported, ["async function requestResearch", "async function cancelResearch"]);
    assert.ok(source.split("\n").length < 60);
    assert.doesNotMatch(
      code(source),
      /\.from\(|\.rpc\(|\.select\(/,
      "all data access lives in actions-core.ts",
    );
  });

  it("builds its gateway from the signed-in user's request-scoped client", () => {
    assert.match(source, /from "@\/lib\/supabase\/server"/);
    assert.match(source, /createResearchGateway\(await createClient\(\)\)/);
    assert.match(source, /getUser: getSessionUser/);
    assert.match(source, /getWorkspace: getActiveWorkspace/);
  });

  it("sends an unauthenticated caller to the login page", () => {
    assert.equal(source.match(/redirect\("\/login"\)/g)?.length, 2);
  });
});

describe("what the queries read", () => {
  const forbidden = [
    "text_storage_path",
    "text_sha256",
    "text_bytes",
    "text_chars",
    "text_purged_at",
    "value_hash",
    "locked_by",
    "locked_until",
    "idempotency_key",
    "supporting_finding_ids",
    "ai_provider",
    "ai_model",
    "prompt_version",
    "ai_input_tokens",
    "ai_output_tokens",
    "cost_usd",
    "previous_run_id",
    "workspace_id",
    "content_type",
  ];
  const lists = {
    SUMMARY_COLUMNS: columns.SUMMARY_COLUMNS,
    RUN_COLUMNS: columns.RUN_COLUMNS,
    FINDING_COLUMNS: columns.FINDING_COLUMNS,
    SOURCE_COLUMNS: columns.SOURCE_COLUMNS,
    LEAD_FOR_ACTION_COLUMNS: columns.LEAD_FOR_ACTION_COLUMNS,
    RUN_FOR_CANCEL_COLUMNS: columns.RUN_FOR_CANCEL_COLUMNS,
  };

  it("excludes private source text, storage paths, hashes, lease and idempotency fields, usage and cost", () => {
    for (const [name, list] of Object.entries(lists)) {
      const names = list.split(",").map((c) => c.trim());
      for (const column of forbidden)
        assert.ok(!names.includes(column), `${name} must not select ${column}`);
      assert.equal(new Set(names).size, names.length, `${name} has a duplicate column`);
      assert.ok(!names.includes("*"));
    }
  });

  it("selects the safe source metadata the page shows, and the 1,000-character quote column", () => {
    assert.deepEqual(columns.SOURCE_COLUMNS.split(", "), [
      "id",
      "url",
      "final_url",
      "title",
      "retrieved_at",
      "http_status",
      "source_type",
    ]);
    assert.ok(columns.FINDING_COLUMNS.split(", ").includes("evidence_quote"));
  });

  it("every select in the new queries uses one of those constants, never '*' or a literal", () => {
    const allowed = new Set(Object.keys(lists));
    for (const file of [
      "src/features/research/results-queries.ts",
      "src/features/research/actions-core.ts",
    ]) {
      const selects = [...code(read(file)).matchAll(/\.select\(([^)]*)\)/g)].map((m) =>
        m[1].trim(),
      );
      assert.ok(selects.length > 0, file);
      for (const arg of selects)
        assert.ok(allowed.has(arg), `${file}: select(${arg}) is not an allow-listed constant`);
    }
  });

  it("every query in the new code filters by workspace", () => {
    for (const file of [
      "src/features/research/results-queries.ts",
      "src/features/research/actions-core.ts",
    ]) {
      const chunks = code(read(file))
        .split(/\.from\(/)
        .slice(1);
      assert.ok(chunks.length > 0, file);
      for (const chunk of chunks) {
        const query = chunk.split(/\n\s*\n/)[0].slice(0, 700);
        assert.match(
          query,
          /\.eq\(\s*["']workspace_id["']/,
          `${file}: a query has no workspace filter:\n${query.slice(0, 120)}`,
        );
      }
    }
  });

  it("another member's id never leaves the server: requested_by stays out of every shipped type", () => {
    const queries = read("src/features/research/results-queries.ts");
    const runView = queries.match(/export type RunView = \{[\s\S]*?\n\};/)?.[0] ?? "";
    assert.ok(runView.length > 100);
    assert.doesNotMatch(runView, /requested_by|requestedBy:/);
    assert.match(runView, /requestedByYou: boolean/);
    for (const file of DASHBOARD) {
      const mentions = /\brequested_by\b|\brequestedBy\b/.test(code(read(file)));
      const server = [
        "src/features/research/columns.ts",
        "src/features/research/results-queries.ts",
        "src/features/research/actions-core.ts",
      ].includes(file);
      assert.equal(mentions, server, `${file}: requested_by belongs on the server side only`);
    }
  });

  it("the overview is read with the signed-in user's client", () => {
    const queries = read("src/features/research/results-queries.ts");
    assert.match(queries, /^import "server-only";/);
    assert.match(queries, /from "@\/lib\/supabase\/server"/);
  });
});

describe("what the browser can reach", () => {
  const clients = COMPONENTS.filter((f) => /^\s*"use client";/.test(read(f)));

  it("only the controls and the poller are client components", () => {
    assert.deepEqual(clients.sort(), [
      "src/features/research/components/research-controls.tsx",
      "src/features/research/components/run-status-poller.tsx",
    ]);
  });

  it("client components import no database client, no Node module and no server logic", () => {
    const allowed = new Set([
      "lucide-react",
      "next/navigation",
      "react",
      "@/components/ui/button",
      "@/components/ui/form",
      "../actions",
      "../status",
      "../actions-core",
    ]);
    for (const file of clients) {
      const source = read(file);
      for (const spec of specifiers(source)) {
        assert.ok(allowed.has(spec), `${file} imports "${spec}"`);
      }
      // actions-core pulls in the engine's URL checks (node:net): a TYPE import only.
      const core = source.match(/^\s*import\s+(type\s+)?[^;]*?from\s+["']\.\.\/actions-core["']/m);
      if (core) assert.ok(core[1], `${file} may only import types from actions-core`);
      assert.doesNotMatch(source, /supabase|server-only|process\.env|node:|engine\//, file);
    }
  });

  it("browser code never imports the browser database client anywhere in the research feature", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(read(file), /lib\/supabase\/client/, file);
    }
  });

  it("the modules a client imports are free of Node and server-only code", () => {
    const status = read("src/features/research/status.ts");
    assert.deepEqual(specifiers(status), ["@/components/ui/badge"]);
    assert.match(status, /import type \{ BadgeTone \}/);
    assert.doesNotMatch(status, /server-only|node:|process\./);
  });

  it("server-only modules say so", () => {
    for (const file of ["results-queries.ts", "setup.ts"]) {
      assert.match(read(`src/features/research/${file}`), /^import "server-only";/, file);
    }
    for (const file of [
      "presenter.ts",
      "status.ts",
      "columns.ts",
      "setup-core.ts",
      "eligibility.ts",
      "actions-core.ts",
    ]) {
      assert.doesNotMatch(
        code(read(`src/features/research/${file}`)),
        /server-only|from "next\/|from "react"/,
        file,
      );
    }
  });
});

describe("website content is rendered as plain text", () => {
  it("no raw HTML is ever injected", () => {
    for (const file of DASHBOARD) {
      assert.doesNotMatch(
        code(read(file)),
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/,
        file,
      );
    }
  });

  it("no component builds a mailto:, javascript:, data: or tel: link", () => {
    for (const file of COMPONENTS) {
      assert.doesNotMatch(
        code(read(file)),
        /["'`](mailto|javascript|data|tel|vbscript|file):/i,
        file,
      );
    }
  });

  it("every external link opens safely and uses an address the presenter approved", () => {
    const rel = 'rel: "noopener noreferrer nofollow"';
    const results = read("src/features/research/components/research-results.tsx");
    assert.match(
      results,
      /const EXTERNAL = \{ target: "_blank", rel: "noopener noreferrer nofollow" \} as const;/,
    );
    assert.ok(results.includes(rel));

    const safeHrefs = new Set([
      // approved by the presenter's linkOf (explicit http(s) scheme + safeExternalUrl), or null
      "item.href",
      "source.href",
      "s.href",
      "w.href",
      // the imported website, run through safeExternalUrl by the profile
      "site",
      // fixed internal paths
      "`/research/${lead.id}`",
      "`/research/${leadId}?run=${run.id}`",
      "`/imports/${p.importId}`",
      "`/research/${company.id}`",
      "href(page - 1)",
      "href(page + 1)",
    ]);
    let checked = 0;
    for (const file of COMPONENTS) {
      for (const expression of hrefExpressions(code(read(file)))) {
        assert.ok(safeHrefs.has(expression), `${file}: unreviewed link href={${expression}}`);
        checked++;
      }
    }
    assert.ok(checked >= 10, "the parser found the page's links");
  });

  it("the href parser handles braces inside template literals", () => {
    assert.deepEqual(
      hrefExpressions("<a href={`/research/${lead.id}`} x /><a href={item.href} />"),
      ["`/research/${lead.id}`", "item.href"],
    );
  });

  it('every target="_blank" link also carries the full rel', () => {
    for (const file of COMPONENTS) {
      const source = code(read(file)); // comments may quote the rel text; they are not links
      const spread = (source.match(/\{\.\.\.EXTERNAL\}/g) ?? []).length;
      const blank = (source.match(/target="_blank"/g) ?? []).length + spread;
      const rel = (source.match(/rel="noopener noreferrer nofollow"/g) ?? []).length + spread;
      assert.equal(blank, rel, file);
    }
  });

  it("website-derived text is only ever put in the page as a React text child", () => {
    const results = read("src/features/research/components/research-results.tsx");
    for (const field of [
      "item.value",
      "item.quote",
      "source.urlText",
      "source.label",
      "line",
      "d.value",
      "w.title",
      "w.detail",
    ]) {
      assert.match(results, new RegExp(`\\{[^}]*${field.replace(".", "\\.")}[^}]*\\}`), field);
    }
    // Presenter output is never passed to anything that interprets markup.
    assert.doesNotMatch(results, /__html|createElement|parse\(/);
  });
});

describe("the poller", () => {
  const source = read("src/features/research/components/run-status-poller.tsx");

  it("refreshes through the router, at the approved interval, and never fetches", () => {
    assert.match(source, /router\.refresh\(\)/);
    assert.match(source, /POLL_INTERVAL_MS/);
    assert.doesNotMatch(code(source), /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|setTimeout/);
  });

  it("does nothing unless a run is active and the tab is visible", () => {
    assert.match(source, /if \(!active\) return;/);
    assert.match(source, /shouldPoll\(active, document\.visibilityState\)/);
    assert.match(source, /addEventListener\("visibilitychange"/);
  });

  it("clears its timer and listener on unmount", () => {
    assert.match(source, /clearInterval\(timer\)/);
    assert.match(source, /removeEventListener\("visibilitychange"/);
    assert.match(source, /return \(\) => \{\s*stop\(\);\s*document\.removeEventListener/);
  });

  it("starts at most one timer", () => {
    assert.match(source, /if \(timer === null\) timer = setInterval/);
    assert.equal(source.match(/setInterval\(/g)?.length, 1);
  });

  it("is used only where a run can change: the profile (any run) and the list (any listed run)", () => {
    const users = COMPONENTS.filter((f) => /<RunStatusPoller/.test(read(f))).sort();
    assert.deepEqual(users, [
      "src/features/research/components/company-profile.tsx",
      "src/features/research/components/research-list.tsx",
    ]);
    assert.match(
      read("src/features/research/components/company-profile.tsx"),
      /<RunStatusPoller active=\{state\.active\} \/>/,
    );
    assert.match(
      read("src/features/research/components/research-list.tsx"),
      /<RunStatusPoller active=\{anyActive\} \/>/,
    );
  });
});

describe("the pages", () => {
  const profile = read("src/app/(dashboard)/research/[leadId]/page.tsx");
  const list = read("src/app/(dashboard)/research/page.tsx");

  it("both require a signed-in user with a workspace", () => {
    assert.match(profile, /requireWorkspaceContext\(\)/);
    assert.match(list, /requireWorkspaceContext\(\)/);
  });

  it("the profile validates the company id and the ?run= value as UUIDs before using them", () => {
    assert.match(profile, /if \(!UUID\.test\(leadId\)\) notFound\(\)/);
    assert.match(profile, /UUID\.test\(query\.run\)/);
    assert.match(profile, /if \(!profile\) notFound\(\)/);
  });

  it("the workspace and the user come from the server session, never from the URL", () => {
    assert.match(profile, /workspaceId: workspace\.id/);
    assert.match(profile, /userId: user\.id/);
    assert.doesNotMatch(profile, /query\.(workspace|workspaceId|user)/);
  });

  it("generates the idempotency key on the server, once per render", () => {
    assert.match(profile, /requestKey: crypto\.randomUUID\(\)/);
  });
});

describe("existing behaviour is preserved", () => {
  it("the list keeps its search form, pagination and links to profiles", () => {
    const list = read("src/features/research/components/research-list.tsx");
    for (const marker of [
      'role="search"',
      'name="q"',
      'aria-label="Pagination"',
      "href={`/research/${company.id}`}",
      'data-testid="research-table"',
      "RESEARCH_PAGE_SIZE",
    ]) {
      assert.ok(list.includes(marker), marker);
    }
  });

  it("the profile keeps its import provenance table and every module placeholder", () => {
    const profile = read("src/features/research/components/company-profile.tsx");
    for (const marker of [
      'data-testid="provenance-table"',
      'data-testid="company-name"',
      'title="Proposal history"',
      'title="Outreach and communication history"',
      'title="Meeting history"',
      'title="Meeting preparation"',
    ]) {
      assert.ok(profile.includes(marker), marker);
    }
  });

  it("the hard-coded 'Not researched' and 'Never' placeholders are gone from the list", () => {
    const list = read("src/features/research/components/research-list.tsx");
    assert.doesNotMatch(list, /<Badge tone="neutral">Not researched<\/Badge>/);
    assert.doesNotMatch(list, /isn't running yet/);
  });
});
