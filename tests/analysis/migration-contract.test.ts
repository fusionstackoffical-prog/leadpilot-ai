// The analysis core must agree with migration 010 (read from disk, never modified): categories,
// fit levels, limits, formats, error codes and the exact shape of worker_complete_analysis_run's input.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyzeResearch } from "../../src/features/analysis/analyze.ts";
import {
  FIT_LEVELS,
  OPPORTUNITY_CATALOGUE,
  OPPORTUNITY_CATEGORIES,
} from "../../src/features/analysis/catalogue.ts";
import { buildEvidencePack } from "../../src/features/analysis/evidence-pack.ts";
import { MAX_STRONG_FITS, PACK_LIMITS, RESULT_LIMITS } from "../../src/features/analysis/limits.ts";
import {
  createMockProvider,
  MOCK_MODEL,
  MOCK_PROVIDER_ID,
} from "../../src/features/analysis/mock-provider.ts";
import { PROVIDER_ERROR_CODES, WORKER_ERROR_CODES } from "../../src/features/analysis/provider.ts";
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  VERSION_PATTERN,
} from "../../src/features/analysis/versions.ts";
import { industryFixtures, makeBuilder } from "./fixtures.ts";
import {
  migrationCategories,
  migrationFitLevels,
  migrationNumber,
  migrationPattern,
  migrationResultKeys,
  migrationSql,
  migrationStoredErrorCodes,
  migrationWorkerErrorCodes,
} from "./migration.ts";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("categories and fit levels", () => {
  it("the catalogue is exactly the migration's check constraint", () => {
    assert.deepEqual(sorted(OPPORTUNITY_CATEGORIES), sorted(migrationCategories()));
    assert.equal(OPPORTUNITY_CATEGORIES.length, 6);
  });

  it("is exactly the six approved categories", () => {
    assert.deepEqual(
      sorted(OPPORTUNITY_CATEGORIES),
      sorted([
        "ai_receptionist",
        "ai_voice_agent",
        "support_chatbot",
        "business_process_automation",
        "custom_automation",
        "crm",
      ]),
    );
  });

  it("every category has a one-line definition", () => {
    for (const id of OPPORTUNITY_CATEGORIES) {
      const entry = OPPORTUNITY_CATALOGUE[id];
      assert.ok(entry.label.length > 0 && entry.definition.length > 20, id);
      assert.ok(!entry.definition.includes("\n"), id);
    }
    assert.deepEqual(sorted(Object.keys(OPPORTUNITY_CATALOGUE)), sorted(OPPORTUNITY_CATEGORIES));
  });

  it("the removed categories are gone everywhere in the analysis code", () => {
    for (const old of ["appointment_booking", "automated_follow_up", "custom_workflow"]) {
      assert.ok(!(OPPORTUNITY_CATEGORIES as readonly string[]).includes(old), old);
      assert.ok(!migrationCategories().includes(old), old);
      assert.ok(!migrationSql.includes(old), `migration still mentions ${old}`);
    }
  });

  it("the fit levels are exactly the migration's", () => {
    assert.deepEqual([...FIT_LEVELS], migrationFitLevels());
  });
});

describe("limits", () => {
  it("result limits equal the migration's", () => {
    assert.equal(
      RESULT_LIMITS.maxRationaleChars,
      migrationNumber(/char_length\(rationale\) between 1 and (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxUncertaintyChars,
      migrationNumber(/char_length\(uncertainty\) between 1 and (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxReferences,
      migrationNumber(/cardinality\(supporting_finding_ids\) <= (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxMissingItems,
      migrationNumber(/cardinality\(missing_information\) <= (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxMissingItemChars,
      migrationNumber(/char_length\(pg_catalog\.btrim\(m\.item\)\) not between 1 and (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxOpportunities,
      migrationNumber(/jsonb_array_length\(p_result -> 'opportunities'\) > (\d+)/),
    );
    assert.equal(
      RESULT_LIMITS.maxOpportunities,
      migrationNumber(/rank smallint not null check \(rank between 1 and (\d+)\)/),
    );
    assert.equal(
      RESULT_LIMITS.maxWarningCodes,
      migrationNumber(/cardinality\(warning_codes\) <= (\d+)/),
    );
  });

  it("there is one opportunity per category, so six is also the category count", () => {
    assert.equal(RESULT_LIMITS.maxOpportunities, OPPORTUNITY_CATEGORIES.length);
  });

  it("the strong-fit cap is a code-side calibration guard, not a database rule", () => {
    assert.equal(MAX_STRONG_FITS, 3);
    assert.ok(!/strong[^;]{0,80}>\s*3/.test(migrationSql));
  });

  it("the pack stays well inside what the prompt limit allows", () => {
    assert.ok(PACK_LIMITS.maxPackChars < 60_000);
    assert.ok(PACK_LIMITS.maxItems <= 999); // references E1..E999
  });
});

describe("formats", () => {
  it("version labels match the migration's format rule", () => {
    assert.equal(VERSION_PATTERN.source, migrationPattern("prompt_version"));
    assert.equal(VERSION_PATTERN.source, migrationPattern("schema_version"));
    assert.match(PROMPT_VERSION, VERSION_PATTERN);
    assert.match(SCHEMA_VERSION, VERSION_PATTERN);
  });

  it("the mock's provider id and model are valid in the database", () => {
    assert.match(MOCK_PROVIDER_ID, new RegExp(migrationPattern("provider")));
    assert.match("gemini", new RegExp(migrationPattern("provider")));
    assert.match(MOCK_MODEL, new RegExp(migrationPattern("model")));
  });

  it("the input hash format is the migration's", () => {
    assert.equal(migrationPattern("input_hash"), "^[0-9a-f]{64}$");
  });

  it("confidence has two decimals, like numeric(3,2)", () => {
    assert.match(migrationSql, /confidence numeric\(3, 2\)/);
  });
});

describe("error codes", () => {
  it("the worker-reportable codes are exactly what worker_fail_analysis_run accepts", () => {
    assert.deepEqual(sorted(WORKER_ERROR_CODES), sorted(migrationWorkerErrorCodes()));
  });

  it("every one of them can be stored by the table", () => {
    const stored = new Set(migrationStoredErrorCodes());
    for (const code of WORKER_ERROR_CODES) assert.ok(stored.has(code), code);
  });

  it("the database-only codes are not worker-reportable", () => {
    const stored = migrationStoredErrorCodes();
    const dbOnly = stored.filter((c) => !(WORKER_ERROR_CODES as readonly string[]).includes(c));
    assert.deepEqual(sorted(dbOnly), ["cancelled", "lease_expired"]);
  });

  it("provider adapters can only throw worker-reportable codes", () => {
    for (const code of PROVIDER_ERROR_CODES)
      assert.ok((WORKER_ERROR_CODES as readonly string[]).includes(code), code);
  });

  it("every code the analysis can fail with has a fixed message in the migration", () => {
    for (const code of WORKER_ERROR_CODES) assert.ok(migrationSql.includes(`when '${code}'`), code);
  });
});

describe("the p_result shape", () => {
  it("the migration reads exactly the keys the core produces", async () => {
    const keys = migrationResultKeys();
    const r = await analyzeResearch({
      findings: industryFixtures()[0].findings,
      provider: createMockProvider(),
    });
    assert.ok(r.ok);
    assert.deepEqual(sorted(Object.keys(r.result)), keys.top);
    assert.deepEqual(sorted(Object.keys(r.result.ai)), keys.ai);
    assert.deepEqual(sorted(Object.keys(r.result.usage)), keys.usage);
    for (const opportunity of r.result.opportunities) {
      assert.deepEqual(sorted(Object.keys(opportunity)), keys.opportunity);
    }
  });

  it("every result of the six industries satisfies the migration's checks", async () => {
    const warningPattern = new RegExp(
      /'(\^\[a-z\]\[a-z0-9_\]\{0,59\}\$)'/.exec(migrationSql)?.[1] ?? "$^",
    );
    for (const fixture of industryFixtures()) {
      const r = await analyzeResearch({
        findings: fixture.findings,
        provider: createMockProvider(),
      });
      assert.ok(r.ok, fixture.name);
      assert.equal(r.result.ai.provider, MOCK_PROVIDER_ID);
      assert.match(r.result.input_hash, new RegExp(migrationPattern("input_hash")));
      assert.ok(
        Number.isInteger(r.result.input_finding_count) && r.result.input_finding_count >= 0,
      );
      for (const code of r.result.warning_codes) assert.match(code, warningPattern);
      const ids = new Set(fixture.findings.map((f) => f.id));
      for (const o of r.result.opportunities) {
        assert.ok(o.supporting_finding_ids.every((id) => ids.has(id)));
        if (o.fit_level === "strong") {
          assert.ok(
            o.supporting_finding_ids.some(
              (id) => fixture.findings.find((f) => f.id === id)?.kind === "fact",
            ),
          );
        }
      }
    }
  });

  it("the guard's excluded categories are the ones the pack excludes", () => {
    const m = /f\.category not in \(([^)]*)\)/.exec(migrationSql);
    assert.ok(m, "guard exclusion list not found in the migration");
    const excluded = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    assert.deepEqual(sorted(excluded), ["contact_email", "contact_phone", "person"]);

    const f = makeBuilder(150);
    for (const category of excluded) {
      const r = buildEvidencePack([
        f.fact(category, "some value"),
        f.candidate(category, "another"),
      ]);
      assert.ok(!r.ok && r.code === "no_usable_findings", category);
    }
  });

  it("the pack is STRICTER than the database: addresses are allowed by the migration but never analyzed", () => {
    const m = /f\.category not in \(([^)]*)\)/.exec(migrationSql);
    assert.ok(m);
    const dbExcluded = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    // The database does NOT refuse an opportunity that cites an address finding ...
    assert.ok(!dbExcluded.includes("contact_address"));
    // ... so the refusal lives in the pack: an address finding is never put in front of the model.
    const f = makeBuilder(151);
    const r = buildEvidencePack([
      f.fact("contact_address", "12 Main Street"),
      f.candidate("contact_address", "Flat 4"),
    ]);
    assert.ok(!r.ok && r.code === "no_usable_findings");
  });

  it("the excluded category names exist in migration 009's research_findings check", () => {
    const sql009 = readFileSync(
      new URL("../../supabase/migrations/20261103000009_company_research.sql", import.meta.url),
      "utf8",
    );
    const start = sql009.indexOf("create table public.research_findings");
    const list = /category text not null check \(category in \(([^)]*)\)/.exec(sql009.slice(start));
    assert.ok(list);
    const categories = [...list[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    for (const name of [
      "contact_email",
      "contact_phone",
      "person",
      "certification",
      "social_profile",
      "company_detail",
    ]) {
      assert.ok(categories.includes(name), name);
    }
  });
});
