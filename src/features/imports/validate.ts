/**
 * Row validation before staging. Errors make a row "invalid" (never imported);
 * warnings are recorded but the row stays valid. Duplicates are NOT decided
 * here: the database marks them (refresh_excel_import) using the normalized
 * keys it computes itself.
 */
import type { ColumnMapping, LeadFieldKey } from "./fields.ts";
import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  normalizeUsState,
  US_STATE_CODES,
} from "./normalize.ts";
import type { ParsedRow, ParsedSheet } from "./parse.ts";

export type IssueSeverity = "error" | "warning";
export type RowIssue = {
  field: LeadFieldKey | "row";
  code: string;
  message: string;
  severity: IssueSeverity;
};

export type StagedRow = {
  rowNumber: number;
  /** Original cell text keyed by header (non-empty cells only; never modified). */
  raw: Record<string, string>;
  /** Trimmed values keyed by canonical field. */
  mapped: Partial<Record<LeadFieldKey, string>>;
  status: "valid" | "invalid";
  issues: RowIssue[];
};

/** Stay safely under the 32 KB jsonb CHECKs on import_rows.raw_data/mapped_data. */
export const MAX_ROW_JSON_BYTES = 30_000;
const TRUNCATE_TO = 1_000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function buildRawData(headers: readonly string[], row: ParsedRow): Record<string, string> {
  const raw: Record<string, string> = {};
  headers.forEach((header, i) => {
    const value = row.cells[i] ?? "";
    if (value.trim() !== "") raw[header] = value;
  });
  return raw;
}

export function buildMappedData(
  row: ParsedRow,
  mapping: ColumnMapping,
): Partial<Record<LeadFieldKey, string>> {
  const mapped: Partial<Record<LeadFieldKey, string>> = {};
  for (const [index, field] of Object.entries(mapping)) {
    const value = (row.cells[Number(index)] ?? "").replace(/\s+/g, " ").trim();
    if (value) mapped[field] = value;
  }
  return mapped;
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
};

const US_COUNTRY = new Set([
  "us",
  "usa",
  "u.s.",
  "u.s.a.",
  "united states",
  "united states of america",
  "america",
]);

export function validateMapped(mapped: Partial<Record<LeadFieldKey, string>>): RowIssue[] {
  const issues: RowIssue[] = [];
  const error = (field: RowIssue["field"], code: string, message: string) =>
    issues.push({ field, code, message, severity: "error" });
  const warn = (field: RowIssue["field"], code: string, message: string) =>
    issues.push({ field, code, message, severity: "warning" });

  if (!normalizeText(mapped.company_name))
    error("company_name", "missing_company_name", "Company name is missing.");
  if (mapped.business_email && !normalizeEmail(mapped.business_email)) {
    error(
      "business_email",
      "invalid_email",
      `"${mapped.business_email}" is not a valid email address.`,
    );
  }
  if (mapped.website && !normalizeDomain(mapped.website)) {
    error("website", "invalid_website", `"${mapped.website}" is not a valid website address.`);
  }
  if (mapped.phone && !normalizePhone(mapped.phone)) {
    error(
      "phone",
      "invalid_phone",
      `"${mapped.phone}" is not a valid phone number (use a 10-digit US number or +country code).`,
    );
  }
  if (!mapped.website && !mapped.business_email && !mapped.phone) {
    warn(
      "row",
      "missing_contact",
      "No website, email or phone: the row can't be matched for duplicates or contacted.",
    );
  }
  const country = normalizeText(mapped.country);
  if (mapped.state && (!country || US_COUNTRY.has(country))) {
    const code = normalizeUsState(mapped.state);
    if (!code || !US_STATE_CODES.has(code))
      warn("state", "unknown_state", `"${mapped.state}" is not a recognized US state.`);
  }
  if (
    mapped.postal_code &&
    (!country || US_COUNTRY.has(country)) &&
    !/^\d{5}(-?\d{4})?$/.test(mapped.postal_code)
  ) {
    warn("postal_code", "invalid_zip", `"${mapped.postal_code}" is not a 5-digit US ZIP code.`);
  }
  if (mapped.source_url && !isHttpUrl(mapped.source_url)) {
    warn("source_url", "invalid_source_url", `"${mapped.source_url}" is not a valid URL.`);
  }
  return issues;
}

export function validateRow(
  headers: readonly string[],
  row: ParsedRow,
  mapping: ColumnMapping,
): StagedRow {
  let raw = buildRawData(headers, row);
  let mapped = buildMappedData(row, mapping);
  const issues = validateMapped(mapped);

  if (bytes(raw) > MAX_ROW_JSON_BYTES || bytes(mapped) > MAX_ROW_JSON_BYTES) {
    const cut = <T extends Record<string, string>>(obj: T) =>
      Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          v.length > TRUNCATE_TO ? `${v.slice(0, TRUNCATE_TO)}…` : v,
        ]),
      ) as T;
    raw = cut(raw);
    mapped = cut(mapped);
    issues.push({
      field: "row",
      code: "row_too_large",
      message:
        "This row is larger than 30 KB, so long values were shortened and the row was not imported.",
      severity: "error",
    });
  }

  return {
    rowNumber: row.rowNumber,
    raw,
    mapped,
    status: issues.some((issue) => issue.severity === "error") ? "invalid" : "valid",
    issues,
  };
}

export type ValidationSummary = {
  total: number;
  valid: number;
  invalid: number;
  withWarnings: number;
  byCode: Record<string, number>;
};

export function validateSheet(sheet: ParsedSheet, mapping: ColumnMapping) {
  const rows = sheet.rows.map((row) => validateRow(sheet.headers, row, mapping));
  const summary: ValidationSummary = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    withWarnings: 0,
    byCode: {},
  };
  for (const row of rows) {
    if (row.status === "valid") summary.valid++;
    else summary.invalid++;
    if (row.issues.some((issue) => issue.severity === "warning")) summary.withWarnings++;
    for (const issue of row.issues)
      summary.byCode[issue.code] = (summary.byCode[issue.code] ?? 0) + 1;
  }
  return { rows, summary };
}
