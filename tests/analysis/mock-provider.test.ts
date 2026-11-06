// The mock provider: deterministic, free, offline, and scriptable for tests.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildEvidencePack } from "../../src/features/analysis/evidence-pack.ts";
import {
  createMockProvider,
  MOCK_MODEL,
  MOCK_PROVIDER_ID,
  type MockBehavior,
} from "../../src/features/analysis/mock-provider.ts";
import { parseModelOutput } from "../../src/features/analysis/output-schema.ts";
import { buildAnalysisPrompt } from "../../src/features/analysis/prompt.ts";
import {
  ProviderError,
  PROVIDER_ERROR_CODES,
  type GenerateRequest,
} from "../../src/features/analysis/provider.ts";
import { validateOutput } from "../../src/features/analysis/validate.ts";
import { industryFixtures, smallPack } from "./fixtures.ts";

const pack = (findings = smallPack().findings) => {
  const r = buildEvidencePack(findings);
  assert.ok(r.ok);
  return r.pack;
};
const requestFor = (p = pack()): GenerateRequest => ({
  ...buildAnalysisPrompt(p),
  maxOutputTokens: 100,
});
const signal = () => new AbortController().signal;

// Every test in this file runs with network access made impossible, and checks it was never used.
let fetchCalls = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("the mock provider must never use the network");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "fetch was called");
});

describe("identity and cost", () => {
  it("is provider 'mock', model 'mock-1', zero tokens, zero cost", async () => {
    const mock = createMockProvider();
    assert.equal(mock.id, "mock");
    assert.equal(MOCK_PROVIDER_ID, "mock");
    const r = await mock.generate(requestFor(), signal());
    assert.equal(r.model, "mock-1");
    assert.equal(MOCK_MODEL, "mock-1");
    assert.deepEqual(r.usage, { inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });

  it("has zero usage for every behaviour that returns", async () => {
    const behaviours: MockBehavior[] = [
      { kind: "valid" },
      { kind: "malformed_json" },
      { kind: "url_in_text" },
      { kind: "raw", text: "x" },
    ];
    for (const behavior of behaviours) {
      const r = await createMockProvider({ fallback: behavior }).generate(requestFor(), signal());
      assert.deepEqual(r.usage, { inputTokens: 0, outputTokens: 0, costUsd: 0 });
    }
  });
});

describe("determinism", () => {
  it("answers the same request with the same text", async () => {
    const a = await createMockProvider().generate(requestFor(), signal());
    const b = await createMockProvider().generate(requestFor(), signal());
    assert.equal(a.text, b.text);
  });

  it("answers different evidence differently", async () => {
    const texts = new Set<string>();
    for (const fixture of industryFixtures()) {
      texts.add(
        (await createMockProvider().generate(requestFor(pack(fixture.findings)), signal())).text,
      );
    }
    assert.ok(texts.size >= 4, `only ${texts.size} distinct answers across six industries`);
  });
});

describe("scripting", () => {
  it("uses one behaviour per call, then the fallback", async () => {
    const mock = createMockProvider({
      script: [
        { kind: "raw", text: "first" },
        { kind: "raw", text: "second" },
      ],
      fallback: { kind: "raw", text: "after" },
    });
    const texts: string[] = [];
    for (let i = 0; i < 4; i++) texts.push((await mock.generate(requestFor(), signal())).text);
    assert.deepEqual(texts, ["first", "second", "after", "after"]);
  });

  it("defaults to a valid answer", async () => {
    const r = await createMockProvider().generate(requestFor(), signal());
    assert.ok(parseModelOutput(r.text).ok);
  });

  it("records every request, unchanged", async () => {
    const mock = createMockProvider();
    const request = requestFor();
    await mock.generate(request, signal());
    await mock.generate(request, signal());
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(mock.calls[0], request);
  });
});

describe("the default answer is correct for any industry", () => {
  for (const fixture of industryFixtures()) {
    it(`${fixture.name}: parses and validates against its own pack`, async () => {
      const p = pack(fixture.findings);
      const r = await createMockProvider().generate(requestFor(p), signal());
      const parsed = parseModelOutput(r.text);
      assert.ok(parsed.ok, JSON.stringify(parsed));
      const checked = validateOutput(parsed.value, p);
      assert.ok(checked.ok, JSON.stringify(checked));
      assert.ok(parsed.value.opportunities.length >= 1);
    });
  }

  it("answers 'insufficient evidence' when nothing in the evidence matches", async () => {
    const f = smallPack().f;
    const p = pack([f.fact("service", "Zzz"), f.fact("service", "Qqq")]);
    const parsed = parseModelOutput(
      (await createMockProvider().generate(requestFor(p), signal())).text,
    );
    assert.ok(parsed.ok);
    assert.deepEqual(
      parsed.value.opportunities.map((o) => [o.category, o.fit_level]),
      [["custom_automation", "insufficient_evidence"]],
    );
  });

  it("never uses strong more than three times", async () => {
    const f = smallPack().f;
    const p = pack([
      f.fact("service", "phone calls and appointments"),
      f.fact("service", "booking and reminders"),
      f.fact("service", "customer questions and support"),
      f.fact("service", "client leads and campaigns"),
      f.fact("service", "outbound reminder calls"),
      f.fact("business_description", "phone enquiries, scheduling, faq and customer follow-up"),
    ]);
    const parsed = parseModelOutput(
      (await createMockProvider().generate(requestFor(p), signal())).text,
    );
    assert.ok(parsed.ok);
    assert.ok(parsed.value.opportunities.filter((o) => o.fit_level === "strong").length <= 3);
  });

  it("uses only references that exist, and only facts for strong", async () => {
    const p = pack(industryFixtures()[0].findings);
    const parsed = parseModelOutput(
      (await createMockProvider().generate(requestFor(p), signal())).text,
    );
    assert.ok(parsed.ok);
    const status = new Map(p.items.map((i) => [i.ref, i.status]));
    for (const o of parsed.value.opportunities) {
      for (const ref of o.evidence_refs) assert.ok(status.has(ref), ref);
      if (o.fit_level === "strong")
        assert.ok(o.evidence_refs.some((r) => status.get(r) === "fact"));
    }
  });
});

describe("scripted bad behaviours", () => {
  const ask = async (behavior: MockBehavior) => {
    const r = await createMockProvider({ fallback: behavior }).generate(requestFor(), signal());
    return r.text;
  };
  const issuesOf = async (behavior: MockBehavior) => {
    const text = await ask(behavior);
    const parsed = parseModelOutput(text);
    if (!parsed.ok) return parsed.issues.map((i) => i.code);
    const checked = validateOutput(parsed.value, pack());
    return checked.ok ? [] : checked.issues.map((i) => i.code);
  };

  it("malformed_json is not JSON", async () =>
    assert.deepEqual(await issuesOf({ kind: "malformed_json" }), ["invalid_json"]));
  it("empty is not JSON", async () =>
    assert.deepEqual(await issuesOf({ kind: "empty" }), ["invalid_json"]));
  it("invented_reference cites a reference that does not exist", async () =>
    assert.deepEqual(await issuesOf({ kind: "invented_reference" }), ["unknown_reference"]));
  it("missing_references cites nothing", async () =>
    assert.deepEqual(await issuesOf({ kind: "missing_references" }), ["missing_reference"]));
  it("duplicate_references repeats a reference", async () =>
    assert.deepEqual(await issuesOf({ kind: "duplicate_references" }), ["duplicate_reference"]));
  it("strong_on_candidates is strong with only a candidate", async () =>
    assert.deepEqual(await issuesOf({ kind: "strong_on_candidates" }), ["strong_needs_fact"]));
  it("url_in_text has a web address", async () =>
    assert.deepEqual(await issuesOf({ kind: "url_in_text" }), ["contact_data_in_text"]));
  it("email_in_text has an e-mail address", async () =>
    assert.deepEqual(await issuesOf({ kind: "email_in_text" }), ["contact_data_in_text"]));
  it("phone_in_text has a phone number", async () =>
    assert.deepEqual(await issuesOf({ kind: "phone_in_text" }), ["contact_data_in_text"]));
  it("extra_keys has a key that is not allowed", async () =>
    assert.deepEqual(await issuesOf({ kind: "extra_keys" }), ["schema_violation"]));
  it("too_many_opportunities has seven", async () =>
    assert.ok((await issuesOf({ kind: "too_many_opportunities" })).includes("schema_violation")));

  it("follows_injection recommends everything strongly and prints contact data", async () => {
    const codes = await issuesOf({ kind: "follows_injection" });
    assert.ok(codes.includes("contact_data_in_text"));
    assert.ok(codes.includes("too_many_strong"));
  });

  it("raw returns exactly the text it is given", async () =>
    assert.equal(await ask({ kind: "raw", text: "  exact \n" }), "  exact \n"));

  it("errors throw a ProviderError with the chosen code", async () => {
    for (const code of PROVIDER_ERROR_CODES) {
      await assert.rejects(
        () =>
          createMockProvider({ fallback: { kind: "error", code } }).generate(
            requestFor(),
            signal(),
          ),
        (e: unknown) => e instanceof ProviderError && e.code === code,
      );
    }
  });

  it("crash throws an ordinary error", async () => {
    await assert.rejects(
      () => createMockProvider({ fallback: { kind: "crash" } }).generate(requestFor(), signal()),
      (e: unknown) => e instanceof Error && !(e instanceof ProviderError),
    );
  });

  it("hang never answers until the request is aborted", async () => {
    const controller = new AbortController();
    const pending = createMockProvider({ fallback: { kind: "hang" } }).generate(
      requestFor(),
      controller.signal,
    );
    let settled = false;
    pending.catch(() => undefined).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    controller.abort();
    await assert.rejects(pending);
  });

  it("hang rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      createMockProvider({ fallback: { kind: "hang" } }).generate(requestFor(), controller.signal),
    );
  });
});
