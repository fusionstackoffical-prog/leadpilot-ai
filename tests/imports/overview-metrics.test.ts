// Overview counting rules for imports and leads (src/features/overview/metrics.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSearch } from "../../src/features/leads/search.ts";
import {
  acceptedRowCount,
  isMissingRelation,
  summarizeImports,
  type FinishedImport,
} from "../../src/features/overview/metrics.ts";

const imp = (over: Partial<FinishedImport>): FinishedImport => ({
  id: "i1",
  file_name: "leads.csv",
  file_type: "csv",
  status: "completed_with_errors",
  worksheet_count: 1,
  rows_read: 95,
  invalid_rows: 5,
  duplicate_rows: 1,
  failed_rows: 0,
  completed_at: "2026-11-01T13:35:10Z",
  created_at: "2026-11-01T13:30:00Z",
  ...over,
});
const quality = { missingCompanyName: 4, missingWebsite: 45, missingEmail: 80, missingPhone: 1 };

describe("Overview import metrics", () => {
  it("counts the real import: 95 rows read, 89 accepted, invalid and duplicates excluded", () => {
    const s = summarizeImports([imp({})], quality, null);
    assert.equal(s.totalExcelRows, 95);
    assert.equal(acceptedRowCount(imp({})), 89);
    assert.equal(s.inventory.rowsActive, 0, "no lead database: nothing claimed as active leads");
    assert.equal(s.inventory.duplicateRows, 1);
    assert.equal(s.inventory.rowsNeedingReview, 5);
    assert.equal(
      s.inventory.uniqueCompanies,
      0,
      "no lead database -> no company identities claimed",
    );
    assert.equal(s.inventory.lastImportAt, "2026-11-01T13:35:10Z");
    assert.deepEqual(s.recentImports[0], {
      id: "i1",
      fileName: "leads.csv",
      fileType: "csv",
      worksheets: 1,
      rows: 95,
      uniqueCompanies: 89,
      duplicates: 1,
      importedAt: "2026-11-01T13:35:10Z",
      status: "Completed with errors",
    });
  });

  it("uses the lead database when present; verified/qualified only from leads", () => {
    const leads = {
      total_leads: 89,
      unique_companies: 87,
      new_leads: 0,
      verified_contacts: 0,
      qualified_leads: 0,
    };
    const s = summarizeImports([imp({})], quality, leads);
    assert.equal(s.inventory.rowsActive, 89);
    assert.equal(s.inventory.uniqueCompanies, 87);
    assert.equal(s.inventory.verifiedEmails, 0);
  });

  it("re-importing a file adds its rows to Total Records (rows ever imported) but not to leads", () => {
    const leads = {
      total_leads: 89,
      unique_companies: 89,
      new_leads: 0,
      verified_contacts: 0,
      qualified_leads: 0,
    };
    const s = summarizeImports(
      [imp({ id: "a" }), imp({ id: "b", completed_at: "2026-11-02T10:00:00Z" })],
      quality,
      leads,
    );
    assert.equal(s.totalExcelRows, 190);
    assert.equal(s.inventory.filesImported, 2);
    assert.equal(s.inventory.rowsActive, 89);
    assert.equal(s.recentImports[0].id, "b", "newest first");
  });

  it("is empty for a workspace with no finished imports", () => {
    const s = summarizeImports(
      [],
      { missingCompanyName: 0, missingWebsite: 0, missingEmail: 0, missingPhone: 0 },
      null,
    );
    assert.equal(s.totalExcelRows, 0);
    assert.equal(s.inventory.lastImportAt, null);
    assert.deepEqual(s.recentImports, []);
  });

  it("recognizes 'not migrated yet' errors only", () => {
    assert.equal(isMissingRelation({ code: "PGRST202" }), true);
    assert.equal(isMissingRelation({ code: "PGRST205" }), true);
    assert.equal(isMissingRelation({ code: "42501" }), false);
    assert.equal(isMissingRelation(null), false);
  });
});

describe("lead search", () => {
  it("strips PostgREST filter syntax and wildcards", () => {
    assert.equal(sanitizeSearch("acme),id.eq.1"), "acme id eq 1");
    assert.equal(sanitizeSearch("  50% off_* "), "50 off");
    assert.equal(sanitizeSearch("x".repeat(300)).length, 100);
  });
});
