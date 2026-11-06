/**
 * Validation problems with a model's answer. An issue never contains model text: only a fixed
 * code, a path made of known field names and indexes, and (for references) an "E<number>" token.
 * That is what makes it safe to show to the model again in a repair request and to log.
 */

export const ISSUE_CODES = [
  "invalid_json",
  "output_too_large",
  "schema_violation",
  "blank_text",
  "duplicate_category",
  "duplicate_reference",
  "missing_reference",
  "unknown_reference",
  "strong_needs_fact",
  "too_many_strong",
  "contact_data_in_text",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export type Issue = {
  code: IssueCode;
  /** e.g. "opportunities[0].evidence_refs[1]"; known field names and indexes only. */
  path: string;
  /** A safe token: a reference such as "E7", or a schema error kind such as "too_big". */
  detail?: string;
};

export function isIssueCode(value: unknown): value is IssueCode {
  return typeof value === "string" && (ISSUE_CODES as readonly string[]).includes(value);
}

/** What the model is told to do about each kind of problem (fixed text). */
export const ISSUE_ADVICE: Readonly<Record<IssueCode, string>> = {
  invalid_json: "Reply with one valid JSON object and nothing else.",
  output_too_large: "Keep the answer short and within the limits.",
  schema_violation:
    "Follow the answer format exactly: only the listed keys, the listed categories and fit levels, and the stated limits.",
  blank_text: "Text fields must not be empty.",
  duplicate_category: "Use each category at most once.",
  duplicate_reference: "Cite each reference at most once per opportunity.",
  missing_reference:
    "Cite at least one reference for every opportunity except one with fit_level insufficient_evidence.",
  unknown_reference: "Cite only references that appear in the evidence.",
  strong_needs_fact:
    "A strong fit must cite at least one item whose status is fact; use moderate or weak otherwise.",
  too_many_strong: "Use strong for at most three categories.",
  contact_data_in_text:
    "Do not write URLs, web addresses, e-mail addresses or phone numbers anywhere in the answer.",
};

/**
 * The worker error code for a rejected answer: a reference to evidence that does not exist is
 * evidence_check_failed ("cited evidence that does not exist"); every other problem is invalid_output.
 */
export function classifyIssues(
  issues: readonly Issue[],
): "evidence_check_failed" | "invalid_output" {
  return issues.some((i) => i.code === "unknown_reference")
    ? "evidence_check_failed"
    : "invalid_output";
}
