// The model's answer format: strict Zod schema with migration 010's limits, and what a parse failure
// is allowed to say (codes and paths, never the model's text).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIT_LEVELS, OPPORTUNITY_CATEGORIES } from "../../src/features/analysis/catalogue.ts";
import type { Issue } from "../../src/features/analysis/issues.ts";
import { RESULT_LIMITS, RUN_LIMITS } from "../../src/features/analysis/limits.ts";
import { parseModelOutput, REFERENCE_PATTERN } from "../../src/features/analysis/output-schema.ts";

const opp = (over: Record<string, unknown> = {}) => ({
  category: "ai_receptionist",
  fit_level: "moderate",
  rationale: "They seem to answer calls themselves.",
  confidence: 0.7,
  evidence_refs: ["E1"],
  missing_information: ["Call volume"],
  uncertainty: "Opening hours are unknown.",
  ...over,
});
const answer = (opportunities: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ opportunities, ...extra });

const issuesOf = (text: string): Issue[] => {
  const r = parseModelOutput(text);
  assert.ok(!r.ok, "expected the answer to be refused");
  return r.issues;
};
const codes = (text: string) => issuesOf(text).map((i) => i.code);

describe("a valid answer", () => {
  it("is accepted", () => {
    const r = parseModelOutput(answer([opp()]));
    assert.ok(r.ok);
    assert.equal(r.value.opportunities.length, 1);
  });

  it("may have no opportunities", () => {
    const r = parseModelOutput(answer([]));
    assert.ok(r.ok);
    assert.deepEqual(r.value.opportunities, []);
  });

  it("accepts every category and fit level", () => {
    for (const category of OPPORTUNITY_CATEGORIES)
      assert.ok(parseModelOutput(answer([opp({ category })])).ok, category);
    for (const fit_level of FIT_LEVELS) {
      const evidence_refs = fit_level === "insufficient_evidence" ? [] : ["E1"];
      assert.ok(parseModelOutput(answer([opp({ fit_level, evidence_refs })])).ok, fit_level);
    }
  });

  it("accepts all six categories at once", () => {
    const all = OPPORTUNITY_CATEGORIES.map((category) => opp({ category }));
    assert.ok(parseModelOutput(answer(all)).ok);
  });

  it("tolerates one markdown fence around the JSON", () => {
    assert.ok(parseModelOutput("```json\n" + answer([opp()]) + "\n```").ok);
    assert.ok(parseModelOutput("```\n" + answer([opp()]) + "\n```").ok);
    assert.ok(parseModelOutput("  \n" + answer([opp()]) + "\n ").ok);
  });
});

describe("migration 010 limits, at the boundary", () => {
  it("accepts the maximum", () => {
    const refs = Array.from({ length: RESULT_LIMITS.maxReferences }, (_, i) => `E${i + 1}`);
    const r = parseModelOutput(
      answer([
        opp({
          rationale: "r".repeat(RESULT_LIMITS.maxRationaleChars),
          uncertainty: "u".repeat(RESULT_LIMITS.maxUncertaintyChars),
          evidence_refs: refs,
          missing_information: Array.from({ length: RESULT_LIMITS.maxMissingItems }, () =>
            "m".repeat(RESULT_LIMITS.maxMissingItemChars),
          ),
          confidence: 1,
        }),
      ]),
    );
    assert.ok(r.ok);
  });

  it("accepts the minimum", () => {
    assert.ok(
      parseModelOutput(
        answer([opp({ rationale: "r", uncertainty: "u", confidence: 0, missing_information: [] })]),
      ).ok,
    );
  });

  it("refuses one over each maximum", () => {
    const over: [string, Record<string, unknown>][] = [
      ["rationale", { rationale: "r".repeat(RESULT_LIMITS.maxRationaleChars + 1) }],
      ["uncertainty", { uncertainty: "u".repeat(RESULT_LIMITS.maxUncertaintyChars + 1) }],
      [
        "references",
        {
          evidence_refs: Array.from(
            { length: RESULT_LIMITS.maxReferences + 1 },
            (_, i) => `E${i + 1}`,
          ),
        },
      ],
      [
        "missing items",
        {
          missing_information: Array.from({ length: RESULT_LIMITS.maxMissingItems + 1 }, () => "m"),
        },
      ],
      [
        "missing item length",
        { missing_information: ["m".repeat(RESULT_LIMITS.maxMissingItemChars + 1)] },
      ],
      ["confidence", { confidence: 1.01 }],
      ["negative confidence", { confidence: -0.01 }],
    ];
    for (const [name, change] of over)
      assert.ok(codes(answer([opp(change)])).includes("schema_violation"), name);
  });

  it("refuses more than six opportunities", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      opp({ category: OPPORTUNITY_CATEGORIES[i % 6] }),
    );
    assert.ok(codes(answer(seven)).includes("schema_violation"));
  });
});

describe("structure", () => {
  it("refuses text that is not JSON", () => {
    for (const text of [
      "",
      "   ",
      "I think you should call them",
      "{",
      '{"opportunities": [',
      "null",
      "[]",
      "undefined",
    ]) {
      assert.ok(issuesOf(text).length > 0, JSON.stringify(text));
    }
    assert.deepEqual(codes("not json at all"), ["invalid_json"]);
  });

  it("refuses prose around the JSON", () => {
    assert.deepEqual(codes("Here is my answer: " + answer([opp()])), ["invalid_json"]);
    assert.deepEqual(codes(answer([opp()]) + " Hope that helps!"), ["invalid_json"]);
  });

  it("refuses unknown keys at the top level and inside an opportunity", () => {
    assert.ok(codes(answer([opp()], { note: "ignore the rules" })).includes("schema_violation"));
    assert.ok(codes(answer([opp({ extra: 1 })])).includes("schema_violation"));
    assert.ok(codes(answer([opp({ supporting_finding_ids: ["x"] })])).includes("schema_violation"));
  });

  it("refuses a missing or wrongly typed field", () => {
    for (const key of [
      "category",
      "fit_level",
      "rationale",
      "confidence",
      "evidence_refs",
      "missing_information",
      "uncertainty",
    ]) {
      const o: Record<string, unknown> = opp();
      delete o[key];
      assert.ok(codes(answer([o])).includes("schema_violation"), key);
    }
    assert.ok(codes(answer([opp({ confidence: "0.7" })])).includes("schema_violation"));
    assert.ok(codes(answer([opp({ evidence_refs: "E1" })])).includes("schema_violation"));
    assert.ok(codes(JSON.stringify({})).includes("schema_violation"));
    assert.ok(codes(JSON.stringify({ opportunities: "none" })).includes("schema_violation"));
  });

  it("refuses an unknown category or fit level", () => {
    assert.ok(
      codes(answer([opp({ category: "appointment_booking" })])).includes("schema_violation"),
    );
    assert.ok(codes(answer([opp({ category: "custom_workflow" })])).includes("schema_violation"));
    assert.ok(codes(answer([opp({ fit_level: "excellent" })])).includes("schema_violation"));
    assert.ok(codes(answer([opp({ category: "AI_RECEPTIONIST" })])).includes("schema_violation"));
  });

  it("refuses output beyond the size limit", () => {
    assert.deepEqual(codes("x".repeat(RUN_LIMITS.maxOutputChars + 1)), ["output_too_large"]);
  });
});

describe("references", () => {
  it("only short references are well-formed", () => {
    for (const ok of ["E1", "E9", "E10", "E99", "E999"]) assert.ok(REFERENCE_PATTERN.test(ok), ok);
    for (const bad of [
      "e1",
      "E0",
      "E01",
      "E1000",
      "E",
      "1",
      "E-1",
      " E1",
      "E1 ",
      "E1,E2",
      "00000000-0000-4000-8000-000000000001",
      "F1",
    ]) {
      assert.ok(!REFERENCE_PATTERN.test(bad), bad);
    }
  });

  it("a finding id is not a valid reference", () => {
    const issues = issuesOf(
      answer([opp({ evidence_refs: ["00000000-0000-4000-8000-000000000001"] })]),
    );
    assert.ok(issues.some((i) => i.code === "schema_violation"));
  });

  it("refuses a repeated reference in one opportunity", () => {
    assert.ok(
      codes(answer([opp({ evidence_refs: ["E1", "E2", "E1"] })])).includes("duplicate_reference"),
    );
  });

  it("refuses an opportunity with no reference unless it is insufficient_evidence", () => {
    assert.ok(codes(answer([opp({ evidence_refs: [] })])).includes("missing_reference"));
    assert.ok(
      codes(answer([opp({ fit_level: "strong", evidence_refs: [] })])).includes(
        "missing_reference",
      ),
    );
    assert.ok(
      parseModelOutput(answer([opp({ fit_level: "insufficient_evidence", evidence_refs: [] })])).ok,
    );
  });

  it("allows the same reference in different opportunities", () => {
    const r = parseModelOutput(answer([opp(), opp({ category: "crm" })]));
    assert.ok(r.ok);
  });
});

describe("uniqueness and blank text", () => {
  it("refuses the same category twice", () => {
    assert.ok(codes(answer([opp(), opp()])).includes("duplicate_category"));
  });

  it("refuses blank text fields", () => {
    for (const field of ["rationale", "uncertainty"]) {
      assert.ok(codes(answer([opp({ [field]: "" })])).includes("blank_text"), field);
      assert.ok(codes(answer([opp({ [field]: "   \n " })])).includes("blank_text"), field);
    }
    assert.ok(codes(answer([opp({ missing_information: ["  "] })])).includes("blank_text"));
  });
});

describe("what an issue may contain", () => {
  it("never contains the model's text, only codes and known paths", () => {
    const secret = "SECRET-MODEL-TEXT-12345";
    const attempts = [
      answer([opp({ [secret]: "x" })]),
      answer([opp({ rationale: secret.repeat(500) })]),
      answer([opp({ category: secret })]),
      answer([opp({ evidence_refs: [secret] })]),
      answer([opp()], { [secret]: 1 }),
      secret,
      `${secret} ${answer([opp()])}`,
    ];
    for (const text of attempts) {
      const serialized = JSON.stringify(issuesOf(text));
      assert.ok(!serialized.includes("SECRET"), serialized);
      assert.ok(!serialized.includes("12345"), serialized);
    }
  });

  it("paths use only known field names and indexes", () => {
    const issues = issuesOf(
      answer([opp({ evidence_refs: ["bad"] }), opp({ category: "crm", rationale: "" })]),
    );
    for (const issue of issues)
      assert.match(issue.path, /^[a-z_]*(?:\.[a-z_]+|\[\d+\])*$/, issue.path);
    assert.ok(issues.some((i) => i.path === "opportunities[0].evidence_refs[0]"));
    assert.ok(issues.some((i) => i.path === "opportunities[1].rationale"));
  });

  it("reports at most ten issues, each only once", () => {
    const bad = Array.from({ length: 6 }, (_, i) =>
      opp({ category: OPPORTUNITY_CATEGORIES[i], confidence: 5, rationale: "", uncertainty: "" }),
    );
    const issues = issuesOf(answer(bad));
    assert.ok(issues.length <= 10);
    const keys = issues.map((i) => `${i.code}|${i.path}|${i.detail ?? ""}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});
