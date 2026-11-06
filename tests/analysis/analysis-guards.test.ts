// Source guards for src/features/analysis: this step has no network, no database, no environment, no
// secrets and no framework code. A regression here is a security regression, so it fails loudly.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const DIR = new URL("../../src/features/analysis/", import.meta.url);
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(new URL(name, DIR), "utf8") }));

/** Source with comments removed, so a guard checks code and not documentation. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");

const forbid = (label: string, pattern: RegExp) =>
  it(`no file ${label}`, () => {
    const hits = files.filter((f) => pattern.test(code(f.text))).map((f) => f.name);
    assert.deepEqual(hits, []);
  });

describe("the folder", () => {
  it("contains the expected modules", () => {
    for (const name of [
      "analyze",
      "catalogue",
      "contact-data",
      "evidence-pack",
      "issues",
      "limits",
      "mock-provider",
      "output-schema",
      "prompt",
      "provider",
      "text",
      "validate",
      "versions",
    ]) {
      assert.ok(
        files.some((f) => f.name === `${name}.ts`),
        name,
      );
    }
  });
});

describe("no network", () => {
  forbid("calls fetch", /\bfetch\s*\(/);
  forbid(
    "uses XMLHttpRequest, WebSocket or EventSource",
    /\b(XMLHttpRequest|WebSocket|EventSource)\b/,
  );
  forbid(
    "imports an http, net, dns or tls module",
    /from\s+["']node:(https?|net|dns|tls|http2|dgram|child_process|worker_threads)["']/,
  );
  forbid(
    "imports an HTTP client",
    /from\s+["'](undici|axios|node-fetch|got|ky|superagent|openai|@google\/genai|@google\/generative-ai|@anthropic-ai\/sdk)["']/,
  );
});

describe("no database, framework or server-only code", () => {
  forbid("imports Supabase", /from\s+["']@supabase\//);
  forbid("imports server-only", /["']server-only["']/);
  forbid("imports next or react", /from\s+["'](next|react)[/"']/);
  forbid('has "use server" or "use client"', /["']use (server|client)["']/);
  forbid("touches a database client", /\b(createClient|createAdminClient|\.rpc\(|\.from\(")/);
});

describe("no environment, no secrets, no provider keys", () => {
  forbid("reads process.env", /process\.env|import\.meta\.env/);
  forbid("mentions an API key variable", /GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY/);
  forbid("contains a key-like literal", /\b(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})\b/);
  forbid(
    "names a provider endpoint",
    /generativelanguage|googleapis\.com|api\.openai\.com|api\.anthropic\.com/,
  );
});

describe("deterministic by construction", () => {
  forbid("uses Math.random", /Math\.random/);
  forbid("reads the clock for results", /Date\.now|new Date\(|performance\.now/);
  forbid("writes to the file system", /from\s+["']node:fs["']/);
});

describe("imports stay inside the folder and the approved few", () => {
  const allowedExternal = new Set(["zod", "node:crypto"]);
  const allowedOutside = new Set(["../research/presenter.ts", "../../types/database.ts"]);

  for (const f of files) {
    it(`${f.name}: every import is approved`, () => {
      const specs = [...code(f.text).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        const ok = spec.startsWith("./") || allowedExternal.has(spec) || allowedOutside.has(spec);
        assert.ok(ok, `${f.name} imports ${spec}`);
      }
    });
  }
});

describe("the mock provider specifically", () => {
  const mock = files.find((f) => f.name === "mock-provider.ts");

  it("exists and is the only provider implementation", () => {
    assert.ok(mock);
    // Any file that creates a provider: only the mock does. There is no Gemini adapter yet.
    const factories = files.filter((f) =>
      /export (async )?function create\w*Provider\b/.test(code(f.text)),
    );
    assert.deepEqual(
      factories.map((f) => f.name),
      ["mock-provider.ts"],
    );
    assert.ok(!files.some((f) => /gemini/i.test(f.name)));
  });

  it("is declared as provider 'mock' with model 'mock-1' and zero cost", () => {
    assert.match(mock?.text ?? "", /MOCK_PROVIDER_ID = "mock"/);
    assert.match(mock?.text ?? "", /MOCK_MODEL = "mock-1"/);
    assert.match(mock?.text ?? "", /usage: \{ inputTokens: 0, outputTokens: 0, costUsd: 0 \}/);
  });
});
