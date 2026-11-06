// Semantic validation of an answer against the evidence pack it was given.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPPORTUNITY_CATEGORIES } from "../../src/features/analysis/catalogue.ts";
import { buildEvidencePack, type EvidencePack } from "../../src/features/analysis/evidence-pack.ts";
import { MAX_STRONG_FITS } from "../../src/features/analysis/limits.ts";
import { parseModelOutput } from "../../src/features/analysis/output-schema.ts";
import { roundConfidence, validateOutput } from "../../src/features/analysis/validate.ts";
import { makeBuilder, smallPack } from "./fixtures.ts";

function pack(findings = smallPack().findings): EvidencePack {
  const r = buildEvidencePack(findings);
  assert.ok(r.ok);
  return r.pack;
}

const opp = (over: Record<string, unknown> = {}) => ({
  category: "ai_receptionist",
  fit_level: "moderate",
  rationale: "They seem to answer calls themselves.",
  confidence: 0.7,
  evidence_refs: ["E3"],
  missing_information: ["Call volume"],
  uncertainty: "Opening hours are unknown.",
  ...over,
});

function check(opps: unknown[], p: EvidencePack = pack()) {
  const parsed = parseModelOutput(JSON.stringify({ opportunities: opps }));
  assert.ok(parsed.ok, "the test answer must be schema-valid");
  return validateOutput(parsed.value, p);
}
const issueCodes = (opps: unknown[], p?: EvidencePack) => {
  const r = check(opps, p);
  assert.ok(!r.ok, "expected a refusal");
  return r.issues.map((i) => i.code);
};

// Reference layout of smallPack(): E1 description, E2 "Annual maintenance", E3 "Emergency repairs",
// E4 location (all facts), E5 "Commercial contracts" (a candidate).
describe("pack layout used here", () => {
  it("E1-E4 are facts and E5 is the only candidate", () => {
    assert.deepEqual(
      pack().items.map((i) => i.status),
      ["fact", "fact", "fact", "fact", "candidate"],
    );
  });
});

describe("references must exist in this pack", () => {
  it("accepts references that exist", () => {
    assert.ok(check([opp({ evidence_refs: ["E1", "E2", "E5"] })]).ok);
  });

  it("refuses an invented reference", () => {
    const r = check([opp({ evidence_refs: ["E999"] })]);
    assert.ok(!r.ok);
    assert.deepEqual(
      r.issues.map((i) => [i.code, i.path, i.detail]),
      [["unknown_reference", "opportunities[0].evidence_refs[0]", "E999"]],
    );
  });

  it("refuses a reference just past the end of the pack", () => {
    assert.deepEqual(issueCodes([opp({ evidence_refs: ["E6"] })]), ["unknown_reference"]);
  });

  it("refuses a reference that belongs to ANOTHER run's pack", () => {
    const other = makeBuilder(80);
    const bigger = pack([
      ...smallPack().findings,
      ...Array.from({ length: 6 }, (_, i) =>
        other.fact("service", `Extra service ${i}`, { runId: "run-9" }),
      ),
    ]);
    assert.ok(bigger.items.length >= 10);
    // The answer was written for the bigger pack, and is checked against the smaller one.
    assert.deepEqual(issueCodes([opp({ evidence_refs: ["E9"] })], pack()), ["unknown_reference"]);
    assert.ok(check([opp({ evidence_refs: ["E9"] })], bigger).ok);
  });

  it("reports every unknown reference, with its position", () => {
    const r = check([opp({ evidence_refs: ["E1", "E77", "E88"] })]);
    assert.ok(!r.ok);
    assert.deepEqual(
      r.issues.map((i) => i.detail),
      ["E77", "E88"],
    );
    assert.deepEqual(
      r.issues.map((i) => i.path),
      ["opportunities[0].evidence_refs[1]", "opportunities[0].evidence_refs[2]"],
    );
  });

  it("an opportunity with no reference is only valid as insufficient_evidence", () => {
    assert.ok(check([opp({ fit_level: "insufficient_evidence", evidence_refs: [] })]).ok);
  });

  it("missing and duplicate references are refused by the schema before validation", () => {
    assert.ok(
      !parseModelOutput(JSON.stringify({ opportunities: [opp({ evidence_refs: [] })] })).ok,
    );
    assert.ok(
      !parseModelOutput(JSON.stringify({ opportunities: [opp({ evidence_refs: ["E1", "E1"] })] }))
        .ok,
    );
  });
});

describe("strong needs a confirmed fact", () => {
  it("refuses strong resting only on a candidate", () => {
    assert.deepEqual(issueCodes([opp({ fit_level: "strong", evidence_refs: ["E5"] })]), [
      "strong_needs_fact",
    ]);
  });

  it("accepts strong with a fact", () => {
    assert.ok(check([opp({ fit_level: "strong", evidence_refs: ["E3"] })]).ok);
  });

  it("accepts strong with a fact and a candidate", () => {
    assert.ok(check([opp({ fit_level: "strong", evidence_refs: ["E5", "E3"] })]).ok);
  });

  it("accepts moderate and weak on candidates alone", () => {
    assert.ok(check([opp({ fit_level: "moderate", evidence_refs: ["E5"] })]).ok);
    assert.ok(check([opp({ fit_level: "weak", evidence_refs: ["E5"] })]).ok);
  });

  it("does not report strong_needs_fact on top of an unknown reference", () => {
    assert.deepEqual(issueCodes([opp({ fit_level: "strong", evidence_refs: ["E99"] })]), [
      "unknown_reference",
    ]);
  });

  it("allows at most three strong fits", () => {
    const strong = (n: number) =>
      OPPORTUNITY_CATEGORIES.slice(0, n).map((category) =>
        opp({ category, fit_level: "strong", evidence_refs: ["E3"] }),
      );
    assert.ok(check(strong(MAX_STRONG_FITS)).ok);
    assert.deepEqual(issueCodes(strong(MAX_STRONG_FITS + 1)), ["too_many_strong"]);
    assert.deepEqual(issueCodes(strong(6)), ["too_many_strong"]);
  });
});

describe("based_on_unconfirmed is computed from the cited findings", () => {
  const flag = (refs: string[]) => {
    const r = check([opp({ evidence_refs: refs })]);
    assert.ok(r.ok);
    return r.opportunities[0].basedOnUnconfirmed;
  };

  it("false when only facts are cited", () => assert.equal(flag(["E1", "E2", "E3"]), false));
  it("true when a candidate is cited", () => assert.equal(flag(["E5"]), true));
  it("true when a candidate is cited among facts", () => assert.equal(flag(["E3", "E5"]), true));
  it("false when nothing is cited", () => {
    const r = check([opp({ fit_level: "insufficient_evidence", evidence_refs: [] })]);
    assert.ok(r.ok);
    assert.equal(r.opportunities[0].basedOnUnconfirmed, false);
  });
});

describe("contact data in free text", () => {
  const bad: [string, string][] = [
    ["a web address", "See https://example.com/book for details"],
    ["a www address", "Their site www.example.com has the menu"],
    ["a bare domain", "Bookings go through example.co.uk"],
    ["an e-mail address", "Ask owner@example.com about it"],
    ["a spelled-out e-mail address", "Ask owner [at] example [dot] com"],
    ["a phone number", "Call +1 (555) 010-9999 to check"],
    ["a plain phone number", "Call 555-123-4567"],
    ["a long digit run", "Number 5551234567"],
  ];
  for (const field of ["rationale", "uncertainty", "missing_information"]) {
    for (const [name, text] of bad) {
      it(`refuses ${name} in ${field}`, () => {
        const value = field === "missing_information" ? [text] : text;
        assert.deepEqual(issueCodes([opp({ [field]: value })]), ["contact_data_in_text"]);
      });
    }
  }

  it("reports where the contact data was", () => {
    const r = check([
      opp({
        rationale: "a@b.com",
        uncertainty: "c@d.com",
        missing_information: ["fine", "e@f.com"],
      }),
    ]);
    assert.ok(!r.ok);
    assert.deepEqual(
      r.issues.map((i) => i.path),
      [
        "opportunities[0].rationale",
        "opportunities[0].uncertainty",
        "opportunities[0].missing_information[1]",
      ],
    );
  });

  it("accepts text with years, prices and ordinary numbers", () => {
    assert.ok(
      check([
        opp({
          rationale: "Open since 1998 with 3 locations and prices from $120.",
          uncertainty: "Hours 9:00-17:30 are listed.",
        }),
      ]).ok,
    );
  });
});

describe("what a valid result contains", () => {
  it("maps references back to finding ids, in the model's order", () => {
    const { findings } = smallPack();
    const p = pack(findings);
    const r = check([opp({ evidence_refs: ["E3", "E1"] })], p);
    assert.ok(r.ok);
    assert.deepEqual(r.opportunities[0].references, ["E3", "E1"]);
    assert.deepEqual(r.opportunities[0].findingIds, [p.refToFindingId.E3, p.refToFindingId.E1]);
    for (const id of r.opportunities[0].findingIds) assert.ok(findings.some((f) => f.id === id));
  });

  it("trims text and rounds confidence to two decimals", () => {
    const r = check([
      opp({
        rationale: "  padded  ",
        uncertainty: " u ",
        missing_information: ["  m  "],
        confidence: 0.755,
      }),
    ]);
    assert.ok(r.ok);
    const [o] = r.opportunities;
    assert.deepEqual(
      [o.rationale, o.uncertainty, o.missing_information, o.confidence],
      ["padded", "u", ["m"], 0.76],
    );
    assert.equal(roundConfidence(0.1 + 0.2), 0.3);
    assert.equal(roundConfidence(1), 1);
    assert.equal(roundConfidence(0), 0);
  });

  it("ranks in code: stronger fit first, then confidence, then catalogue order", () => {
    const r = check([
      opp({ category: "crm", fit_level: "weak", confidence: 0.9 }),
      opp({ category: "support_chatbot", fit_level: "strong", confidence: 0.5 }),
      opp({ category: "ai_voice_agent", fit_level: "moderate", confidence: 0.4 }),
      opp({ category: "ai_receptionist", fit_level: "moderate", confidence: 0.8 }),
      opp({ category: "custom_automation", fit_level: "moderate", confidence: 0.8 }),
      opp({
        category: "business_process_automation",
        fit_level: "insufficient_evidence",
        evidence_refs: [],
      }),
    ]);
    assert.ok(r.ok);
    assert.deepEqual(
      r.opportunities.map((o) => o.category),
      [
        "support_chatbot",
        "ai_receptionist",
        "custom_automation",
        "ai_voice_agent",
        "crm",
        "business_process_automation",
      ],
    );
  });

  it("returns nothing for an empty answer", () => {
    const r = check([]);
    assert.ok(r.ok);
    assert.deepEqual(r.opportunities, []);
  });
});
