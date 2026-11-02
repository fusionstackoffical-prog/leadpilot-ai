import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicateReasons, csvCell } from "../../src/features/imports/duplicates.ts";
import {
  duplicateMappings,
  missingRequired,
  suggestMapping,
} from "../../src/features/imports/fields.ts";
import {
  validateImportFile,
  MAX_IMPORT_FILE_BYTES,
} from "../../src/features/imports/file-rules.ts";
import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeUsState,
} from "../../src/features/imports/normalize.ts";
import {
  MAX_ROW_JSON_BYTES,
  validateMapped,
  validateRow,
  validateSheet,
} from "../../src/features/imports/validate.ts";

describe("column mapping", () => {
  it("suggests fields from common header names", () => {
    const m = suggestMapping([
      "Business Name",
      "Web Site",
      "E-mail",
      "Phone #",
      "City",
      "ST",
      "Zip Code",
      "Industry",
      "Notes",
      "Random",
    ]);
    assert.deepEqual(m, {
      0: "company_name",
      1: "website",
      2: "business_email",
      3: "phone",
      4: "city",
      5: "state",
      6: "postal_code",
      7: "services",
      8: "notes",
    });
  });

  it("uses each field once and reports missing/duplicate mappings", () => {
    assert.deepEqual(suggestMapping(["Email", "Email Address"]), { 0: "business_email" });
    assert.deepEqual(missingRequired({ 0: "website" }), ["company_name"]);
    assert.deepEqual(duplicateMappings({ 0: "phone", 1: "phone", 2: "city" }), ["phone"]);
  });
});

describe("validation", () => {
  const headers = ["Company", "Website", "Email", "Phone", "State"];
  const mapping = {
    0: "company_name",
    1: "website",
    2: "business_email",
    3: "phone",
    4: "state",
  } as const;
  const row = (rowNumber: number, ...cells: string[]) => ({ rowNumber, cells });

  it("accepts a good row and preserves the original values", () => {
    const r = validateRow(
      headers,
      row(2, " Acme  Heating ", "https://acme.com", "Info@Acme.com", "(214) 555-0100", "Texas"),
      mapping,
    );
    assert.equal(r.status, "valid");
    assert.deepEqual(r.issues, []);
    assert.equal(r.raw.Company, " Acme  Heating ", "raw cell text is untouched");
    assert.equal(r.mapped.company_name, "Acme Heating");
  });

  it("explains each error with the field", () => {
    const r = validateRow(headers, row(7, "", "not a site", "bad@", "555", "Texas"), mapping);
    assert.equal(r.status, "invalid");
    assert.deepEqual(
      r.issues.filter((i) => i.severity === "error").map((i) => i.code),
      ["missing_company_name", "invalid_email", "invalid_website", "invalid_phone"],
    );
    assert.equal(r.rowNumber, 7);
  });

  it("treats warnings as non-blocking", () => {
    const issues = validateMapped({
      company_name: "Acme",
      state: "Narnia",
      postal_code: "12",
      source_url: "::",
    });
    assert.ok(issues.every((i) => i.severity === "warning"));
    assert.deepEqual(
      issues.map((i) => i.code),
      ["missing_contact", "unknown_state", "invalid_zip", "invalid_source_url"],
    );
    // Non-US addresses aren't checked against US states/ZIPs.
    assert.deepEqual(
      validateMapped({
        company_name: "Acme",
        phone: "+44 20 7946 0958",
        country: "UK",
        state: "Kent",
        postal_code: "CT1",
      }),
      [],
    );
  });

  it("keeps oversized rows under the database limit and rejects them", () => {
    const r = validateRow(["Company", "Notes"], row(3, "Acme", "x".repeat(40_000)), {
      0: "company_name",
      1: "notes",
    });
    assert.equal(r.status, "invalid");
    assert.equal(r.issues.at(-1)?.code, "row_too_large");
    assert.ok(new TextEncoder().encode(JSON.stringify(r.raw)).length < MAX_ROW_JSON_BYTES);
  });

  it("summarizes a sheet", () => {
    const sheet = {
      index: 0,
      name: "S",
      headerRowNumber: 1,
      headers,
      error: null,
      rows: [row(2, "A", "a.com"), row(3, "", "b.com"), row(4, "C")],
    };
    const { summary } = validateSheet(sheet, mapping);
    assert.deepEqual(summary, {
      total: 3,
      valid: 2,
      invalid: 1,
      withWarnings: 1,
      byCode: { missing_company_name: 1, missing_contact: 1 },
    });
  });
});

describe("normalization (mirror of the database functions)", () => {
  it("normalizes like migration 005", () => {
    assert.equal(normalizeDomain("https://User@WWW.Acme.com:443/contact?x=1#top"), "acme.com");
    assert.equal(normalizeDomain("HTTP://shop.Acme.com."), "shop.acme.com");
    assert.equal(normalizeDomain("localhost"), null);
    assert.equal(normalizeEmail("mailto:Info@Acme.com"), "info@acme.com");
    assert.equal(normalizeEmail("a@b"), null);
    assert.equal(normalizePhone("1-214-555-0100 ext. 12"), "+12145550100");
    assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
    assert.equal(normalizePhone("014-555-0100"), null);
    assert.equal(normalizeUsState(" New  York "), "NY");
    assert.equal(normalizeUsState("Tx."), "TX");
    assert.equal(normalizeUsState("Ontario"), "ONTARIO");
  });
});

describe("duplicate explanations (same four rules as the database)", () => {
  const blank = {
    normalized_domain: null,
    normalized_email: null,
    normalized_phone: null,
    normalized_company_name: null,
    normalized_city: null,
    normalized_state: null,
  };
  it("names every matching key", () => {
    assert.deepEqual(
      duplicateReasons(
        { ...blank, normalized_domain: "a.com", normalized_phone: "+12145550100" },
        { ...blank, normalized_domain: "a.com", normalized_phone: "+12145550100" },
      ),
      ["Same website (a.com)", "Same phone (+12145550100)"],
    );
  });
  it("never matches on company name alone, and needs city AND state", () => {
    const co = { ...blank, normalized_company_name: "cool air" };
    assert.deepEqual(duplicateReasons(co, co), []);
    assert.deepEqual(
      duplicateReasons({ ...co, normalized_city: "austin" }, { ...co, normalized_city: "austin" }),
      [],
    );
    const full = { ...co, normalized_city: "austin", normalized_state: "TX" };
    assert.equal(duplicateReasons(full, full).length, 1);
    assert.deepEqual(duplicateReasons(full, { ...full, normalized_state: "OK" }), []);
  });
});

describe("file rules and CSV export safety", () => {
  it("enforces the 25 MiB limit and extensions", () => {
    assert.equal(
      validateImportFile({ name: "a.xlsx", size: MAX_IMPORT_FILE_BYTES + 1, type: "" }).ok,
      false,
    );
    assert.equal(
      validateImportFile({ name: "a.pdf", size: 10, type: "application/pdf" }).ok,
      false,
    );
    assert.equal(validateImportFile({ name: "a.csv", size: 10, type: "" }).ok, true);
  });
  it("neutralizes formula injection in exported cells", () => {
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell(12), "12");
  });
});
