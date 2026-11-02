import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { MAX_DATA_ROWS, makeHeaders, parseSpreadsheet } from "../../src/features/imports/parse.ts";

const enc = (s: string) => new TextEncoder().encode(s);

function workbook(sheets: Record<string, unknown[][]>, bookType: XLSX.BookType = "xlsx") {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
}

describe("CSV parsing", () => {
  it("reads headers and rows with spreadsheet row numbers, skipping blank lines", () => {
    const r = parseSpreadsheet(
      enc("Company,Website,ZIP\nAcme,acme.com,01234\n\n,,\nBeta,beta.io,77001\n"),
      "csv",
    );
    assert.ok(r.ok);
    const [s] = r.sheets;
    assert.deepEqual(s.headers, ["Company", "Website", "ZIP"]);
    assert.equal(s.headerRowNumber, 1);
    assert.deepEqual(
      s.rows.map((x) => x.rowNumber),
      [2, 5],
    );
    assert.equal(s.rows[0].cells[2], "01234", "leading zeros are kept as text");
    assert.equal(s.error, null);
  });

  it("handles quoted fields, embedded commas/newlines and a UTF-8 BOM", () => {
    const r = parseSpreadsheet(
      enc('﻿Company,Notes\n"Acme, Inc.","line 1\nline 2"\n"Q ""Air"" Co",x\n'),
      "csv",
    );
    assert.ok(r.ok);
    const [s] = r.sheets;
    assert.equal(s.headers[0], "Company");
    assert.deepEqual(s.rows[0].cells, ["Acme, Inc.", "line 1\nline 2"]);
    assert.equal(s.rows[1].cells[0], 'Q "Air" Co');
  });

  it("decodes Windows-1252 CSVs (Excel on Windows)", () => {
    const bytes = new Uint8Array([...enc("Company\n"), 0x43, 0x61, 0x66, 0xe9, 0x0a]); // "Café"
    const r = parseSpreadsheet(bytes, "csv");
    assert.ok(r.ok);
    assert.equal(r.sheets[0].rows[0].cells[0], "Café");
  });

  it("does not evaluate formula-looking text", () => {
    const r = parseSpreadsheet(enc('Company,Phone\n=1+1,=HYPERLINK("x")\n'), "csv");
    assert.ok(r.ok);
    assert.equal(r.sheets[0].rows[0].cells[0], "=1+1");
  });

  it("names blank and repeated headers uniquely", () => {
    assert.deepEqual(makeHeaders(["Email", "", "email", "Email"]), [
      "Email",
      "Column B",
      "email (2)",
      "Email (3)",
    ]);
  });

  it("reports empty files and header-only files", () => {
    assert.deepEqual(parseSpreadsheet(new Uint8Array(), "csv"), {
      ok: false,
      error: "The file is empty.",
    });
    const r = parseSpreadsheet(enc("Company,Website\n"), "csv");
    assert.ok(r.ok);
    assert.match(r.sheets[0].error ?? "", /no data rows/);
  });
});

describe("Excel parsing", () => {
  it("lists every worksheet and reads the chosen one (.xlsx)", () => {
    const bytes = workbook({
      Dallas: [
        ["Company", "Phone"],
        ["Acme", "214-555-0100"],
        ["Beta", "214-555-0101"],
      ],
      Notes: [["just text"]],
      Empty: [],
    });
    const r = parseSpreadsheet(bytes, "xlsx");
    assert.ok(r.ok);
    assert.deepEqual(
      r.sheets.map((s) => s.name),
      ["Dallas", "Notes", "Empty"],
    );
    assert.equal(r.sheets[0].rows.length, 2);
    assert.match(r.sheets[1].error ?? "", /no data rows/);
    assert.match(r.sheets[2].error ?? "", /empty/);
  });

  it("finds a header that doesn't start on row 1 and keeps real row numbers", () => {
    const bytes = workbook({ S: [[], [], ["Company", "City"], ["Acme", "Austin"]] });
    const r = parseSpreadsheet(bytes, "xlsx");
    assert.ok(r.ok);
    assert.equal(r.sheets[0].headerRowNumber, 3);
    assert.equal(r.sheets[0].rows[0].rowNumber, 4);
  });

  it("returns the cached value of formulas, never the formula", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Company", "Total"],
      ["Acme", 3],
    ]);
    ws["B2"] = { t: "n", v: 3, f: "1+2", w: "3" };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const r = parseSpreadsheet(
      new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
      "xlsx",
    );
    assert.ok(r.ok);
    assert.equal(r.sheets[0].rows[0].cells[1], "3");
  });

  it("reads legacy .xls (BIFF8) workbooks", () => {
    const r = parseSpreadsheet(workbook({ Leads: [["Company"], ["Acme"]] }, "biff8"), "xls");
    assert.ok(r.ok);
    assert.equal(r.sheets[0].rows[0].cells[0], "Acme");
  });

  it("rejects damaged and fake spreadsheets with a readable message", () => {
    const fake = parseSpreadsheet(enc("<html>not a workbook</html>"), "xlsx");
    assert.equal(fake.ok, false);
    const truncated = workbook({ S: [["Company"], ["Acme"]] }).slice(0, 200);
    const broken = parseSpreadsheet(truncated, "xlsx");
    assert.equal(broken.ok, false);
    if (!broken.ok) assert.match(broken.error, /couldn't be read/);
    assert.equal(parseSpreadsheet(enc("plain text"), "xls").ok, false);
  });

  it("refuses a sheet that was cut off by blank rows instead of importing part of it", () => {
    const aoa: unknown[][] = [["Company"]];
    for (let i = 0; i < MAX_DATA_ROWS + 1500; i++) aoa.push([""]);
    aoa.push(["Late Co"]);
    const r = parseSpreadsheet(workbook({ Gappy: aoa }), "xlsx");
    assert.ok(r.ok);
    assert.match(r.sheets[0].error ?? "", /more than/);
  });

  it("refuses worksheets over the row limit", () => {
    const aoa: unknown[][] = [["Company"]];
    for (let i = 0; i <= MAX_DATA_ROWS; i++) aoa.push([`Co ${i}`]);
    const r = parseSpreadsheet(workbook({ Big: aoa }), "xlsx");
    assert.ok(r.ok);
    assert.match(
      r.sheets[0].error ?? "",
      new RegExp(`more than ${MAX_DATA_ROWS.toLocaleString("en-US")}`),
    );
  });
});
