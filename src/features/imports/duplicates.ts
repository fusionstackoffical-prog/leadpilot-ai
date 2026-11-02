/**
 * Explains why the database marked a row as a duplicate. The decision itself is
 * made only by refresh_excel_import() (migration 005); this just compares the
 * normalized keys the database stored on both rows, using the same four rules.
 */
export type DuplicateKeys = {
  normalized_domain: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  normalized_company_name: string | null;
  normalized_city: string | null;
  normalized_state: string | null;
};

export function duplicateReasons(row: DuplicateKeys, original: DuplicateKeys): string[] {
  const reasons: string[] = [];
  if (row.normalized_domain && row.normalized_domain === original.normalized_domain) {
    reasons.push(`Same website (${row.normalized_domain})`);
  }
  if (row.normalized_email && row.normalized_email === original.normalized_email) {
    reasons.push(`Same email (${row.normalized_email})`);
  }
  if (row.normalized_phone && row.normalized_phone === original.normalized_phone) {
    reasons.push(`Same phone (${row.normalized_phone})`);
  }
  // Company name counts only together with city AND state; never on its own.
  if (
    row.normalized_company_name &&
    row.normalized_city &&
    row.normalized_state &&
    row.normalized_company_name === original.normalized_company_name &&
    row.normalized_city === original.normalized_city &&
    row.normalized_state === original.normalized_state
  ) {
    reasons.push(
      `Same company, city and state (${row.normalized_company_name}, ${row.normalized_city}, ${row.normalized_state})`,
    );
  }
  return reasons;
}

export const DUPLICATE_KEY_COLUMNS =
  "normalized_domain, normalized_email, normalized_phone, normalized_company_name, normalized_city, normalized_state";

/**
 * Neutralize spreadsheet formula injection in exported CSV cells (=, +, -, @,
 * tab, CR) and quote per RFC 4180.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
