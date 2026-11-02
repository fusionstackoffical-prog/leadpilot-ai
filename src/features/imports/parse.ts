/**
 * Spreadsheet parsing for imports. Pure (no DOM), so it runs in a Web Worker,
 * on the main thread as a fallback, and under Node tests.
 *
 * Safety: formulas are never evaluated (only the cached value Excel saved is
 * read), macros are ignored, and HTML is not produced. Values are returned as
 * the text the user sees in Excel; CSV is read verbatim (ZIP "01234" stays text).
 */
import * as XLSX from "xlsx";
import type { ImportFileType } from "./file-rules.ts";

/**
 * Per-sheet data-row ceiling for one import. Duplicate checking runs in one
 * database call that must finish within Supabase's 8 s statement timeout for
 * signed-in users. With migrations 001-006 that call slows sharply on freshly
 * staged rows (measured live: 2,000 rows 2.5 s, 5,000 rows timed out), so the
 * limit is 2,000. Migration 007 makes it linear (25,000 rows in ~0.6 s locally);
 * raise this to 25_000 once 007 is applied and verified.
 */
export const MAX_DATA_ROWS = 2_000;
export const MAX_COLUMNS = 200;
const PREVIEW_ROWS = 10;

export type ParsedRow = { rowNumber: number; cells: string[] };

export type ParsedSheet = {
  index: number;
  name: string;
  /** Spreadsheet row number of the header (1-based, as shown in Excel). */
  headerRowNumber: number | null;
  headers: string[];
  rows: ParsedRow[];
  /** Why the sheet can't be imported (it's still listed). */
  error: string | null;
};

export type ParseResult = { ok: true; sheets: ParsedSheet[] } | { ok: false; error: string };

const UNREADABLE =
  "This file couldn't be read. It may be damaged, password-protected, or not really a spreadsheet.";

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    // Not valid UTF-8: Excel on Windows commonly saves CSV as Windows-1252.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Unique, non-empty header names. Blank headers become "Column C"; repeats get " (2)". */
export function makeHeaders(raw: readonly string[], firstColumn = 0): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, i) => {
    let name = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) name = `Column ${XLSX.utils.encode_col(firstColumn + i)}`;
    if (name.length > 200) name = name.slice(0, 200);
    const count = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), count);
    return count > 1 ? `${name} (${count})` : name;
  });
}

const isBlank = (cells: readonly string[]) => cells.every((c) => String(c ?? "").trim() === "");

function readSheet(ws: XLSX.WorkSheet | undefined, index: number, name: string): ParsedSheet {
  const empty: ParsedSheet = {
    index,
    name,
    headerRowNumber: null,
    headers: [],
    rows: [],
    error: null,
  };
  if (!ws || !ws["!ref"]) return { ...empty, error: "This worksheet is empty." };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const width = range.e.c - range.s.c + 1;
  if (width > MAX_COLUMNS) {
    return { ...empty, error: `This worksheet has ${width} columns; the limit is ${MAX_COLUMNS}.` };
  }

  const grid = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false, // formatted text, exactly as displayed
    rawNumbers: false,
    defval: "",
    blankrows: true,
  });

  const headerOffset = grid.findIndex((row) => !isBlank(row));
  if (headerOffset === -1) return { ...empty, error: "This worksheet is empty." };

  const toCells = (row: readonly unknown[]) =>
    Array.from({ length: width }, (_, c) => (row[c] == null ? "" : String(row[c])));

  const headers = makeHeaders(toCells(grid[headerOffset]), range.s.c);
  const tooMany = `This worksheet has more than ${MAX_DATA_ROWS.toLocaleString("en-US")} data rows. Split it into smaller files.`;
  const rows: ParsedRow[] = [];
  for (let i = headerOffset + 1; i < grid.length; i++) {
    const cells = toCells(grid[i]);
    if (isBlank(cells)) continue;
    rows.push({ rowNumber: range.s.r + i + 1, cells });
    if (rows.length > MAX_DATA_ROWS) {
      return { ...empty, headerRowNumber: range.s.r + headerOffset + 1, headers, error: tooMany };
    }
  }
  // Reading stopped early (sheetRows): never import a silently cut-off sheet.
  if (ws["!fullref"] && ws["!fullref"] !== ws["!ref"]) {
    return { ...empty, headerRowNumber: range.s.r + headerOffset + 1, headers, error: tooMany };
  }

  return {
    index,
    name,
    headerRowNumber: range.s.r + headerOffset + 1,
    headers,
    rows,
    error: rows.length === 0 ? "This worksheet has a header row but no data rows." : null,
  };
}

export function parseSpreadsheet(
  data: ArrayBuffer | Uint8Array,
  fileType: ImportFileType,
): ParseResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };

  let wb: XLSX.WorkBook;
  try {
    const common = {
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      sheetRows: MAX_DATA_ROWS + 1000, // stop reading far past the limit; the check above reports it
      dense: true,
    } as const;
    if (fileType === "csv") {
      wb = XLSX.read(decodeCsv(bytes), { ...common, type: "string", raw: true });
    } else {
      // Reject non-spreadsheets before SheetJS tries to read them as text/HTML.
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // .xlsx (PK zip)
      const isCfb =
        bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; // .xls (OLE)
      if (fileType === "xlsx" && !isZip) {
        return {
          ok: false,
          error: isCfb
            ? "This looks like an older .xls file or a password-protected workbook. Save it as .xlsx and try again."
            : UNREADABLE,
        };
      }
      if (fileType === "xls" && !isCfb && !isZip) return { ok: false, error: UNREADABLE };
      wb = XLSX.read(bytes, { ...common, type: "array" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      return {
        ok: false,
        error:
          "This workbook is password-protected. Remove the password in Excel and upload it again.",
      };
    }
    return { ok: false, error: UNREADABLE };
  }

  if (!wb.SheetNames?.length) return { ok: false, error: "No worksheets were found in this file." };
  const sheets = wb.SheetNames.map((name, index) => readSheet(wb.Sheets[name], index, name));
  return { ok: true, sheets };
}

export function previewRows(sheet: ParsedSheet, count = PREVIEW_ROWS) {
  return sheet.rows.slice(0, count);
}
