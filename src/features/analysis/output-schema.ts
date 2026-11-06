import { z } from "zod";
import { FIT_LEVELS, OPPORTUNITY_CATEGORIES } from "./catalogue.ts";
import { isIssueCode, type Issue } from "./issues.ts";
import { RESULT_LIMITS, RUN_LIMITS } from "./limits.ts";

/**
 * The JSON the model must produce, as a strict Zod schema: unknown keys are errors, every string
 * and list has the limit migration 010 enforces, so a violation is caught here and not by the
 * database after the model has been paid for.
 *
 * The model cites evidence as `evidence_refs` (short references such as "E3"). The core maps them to
 * finding ids; the model never sees an id.
 */

/** A short evidence reference: E1 ... E999. */
export const REFERENCE_PATTERN = /^E[1-9][0-9]{0,2}$/;

const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((text) => text.trim().length > 0, { message: "blank_text" });

const opportunitySchema = z
  .strictObject({
    category: z.enum(OPPORTUNITY_CATEGORIES),
    fit_level: z.enum(FIT_LEVELS),
    rationale: nonBlank(RESULT_LIMITS.maxRationaleChars),
    confidence: z.number().min(0).max(1),
    evidence_refs: z.array(z.string().regex(REFERENCE_PATTERN)).max(RESULT_LIMITS.maxReferences),
    missing_information: z
      .array(nonBlank(RESULT_LIMITS.maxMissingItemChars))
      .max(RESULT_LIMITS.maxMissingItems),
    uncertainty: nonBlank(RESULT_LIMITS.maxUncertaintyChars),
  })
  .superRefine((opportunity, ctx) => {
    const refs = opportunity.evidence_refs;
    if (new Set(refs).size !== refs.length) {
      ctx.addIssue({ code: "custom", message: "duplicate_reference", path: ["evidence_refs"] });
    }
    if (opportunity.fit_level !== "insufficient_evidence" && refs.length === 0) {
      ctx.addIssue({ code: "custom", message: "missing_reference", path: ["evidence_refs"] });
    }
  });

export const analysisOutputSchema = z
  .strictObject({
    opportunities: z.array(opportunitySchema).max(RESULT_LIMITS.maxOpportunities),
  })
  .superRefine((output, ctx) => {
    const seen = new Set<string>();
    output.opportunities.forEach((opportunity, index) => {
      if (seen.has(opportunity.category)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate_category",
          path: ["opportunities", index, "category"],
        });
      }
      seen.add(opportunity.category);
    });
  });

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type OpportunityOutput = AnalysisOutput["opportunities"][number];

export type ParseResult = { ok: true; value: AnalysisOutput } | { ok: false; issues: Issue[] };

/** Path made only of known field names and numeric indexes (anything else becomes "?"). */
function safePath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => {
      if (typeof segment === "number") return `[${segment}]`;
      return typeof segment === "string" && /^[a-z_]{1,30}$/.test(segment) ? `.${segment}` : ".?";
    })
    .join("")
    .replace(/^\./, "");
}

const MAX_ISSUES = 10;

/** Models often wrap JSON in a markdown fence; that one wrapper is tolerated, nothing else is. */
function stripCodeFence(text: string): string {
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  return match ? match[1].trim() : text;
}

/** Parses and schema-validates the model's raw text. Never throws, never returns model text. */
export function parseModelOutput(raw: string): ParseResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, issues: [{ code: "invalid_json", path: "" }] };
  }
  if (raw.length > RUN_LIMITS.maxOutputChars) {
    return { ok: false, issues: [{ code: "output_too_large", path: "" }] };
  }

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw.trim()));
  } catch {
    return { ok: false, issues: [{ code: "invalid_json", path: "" }] };
  }

  const parsed = analysisOutputSchema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };

  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const zodIssue of parsed.error.issues) {
    const custom = zodIssue.code === "custom" && isIssueCode(zodIssue.message);
    const issue: Issue = custom
      ? { code: zodIssue.message as Issue["code"], path: safePath(zodIssue.path) }
      : { code: "schema_violation", path: safePath(zodIssue.path), detail: zodIssue.code };
    const key = `${issue.code}|${issue.path}|${issue.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_ISSUES) break;
  }
  return { ok: false, issues: issues.length ? issues : [{ code: "schema_violation", path: "" }] };
}
