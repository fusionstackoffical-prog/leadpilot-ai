import {
  FIT_LEVELS,
  OPPORTUNITY_CATEGORIES,
  type FitLevel,
  type OpportunityCategory,
} from "./catalogue.ts";
import { containsContactData } from "./contact-data.ts";
import type { EvidencePack } from "./evidence-pack.ts";
import type { Issue } from "./issues.ts";
import { MAX_STRONG_FITS } from "./limits.ts";
import type { AnalysisOutput } from "./output-schema.ts";

/**
 * The semantic checks that a schema cannot make, against the evidence pack the model was given.
 * Pure. Together with the schema it is the code-side twin of migration 010's guard.
 *
 *  - every cited reference must exist in THIS pack (an invented reference, or one that belongs to
 *    another company's pack, is refused);
 *  - "strong" needs at least one confirmed FACT among its citations;
 *  - no URL, e-mail address or phone-like number anywhere in the free text;
 *  - at most MAX_STRONG_FITS strong fits (a calibration guard against "recommend everything");
 *  - which opportunities rest on unconfirmed candidates is computed here, never taken from the model.
 */

export type ValidatedOpportunity = {
  category: OpportunityCategory;
  fit_level: FitLevel;
  rationale: string;
  confidence: number;
  /** The references as cited, in the model's order. */
  references: string[];
  /** The finding ids behind those references (private to the core). */
  findingIds: string[];
  missing_information: string[];
  uncertainty: string;
  /** True when at least one cited item is an unconfirmed candidate. */
  basedOnUnconfirmed: boolean;
};

export type ValidationResult =
  { ok: true; opportunities: ValidatedOpportunity[] } | { ok: false; issues: Issue[] };

const FIT_RANK: Record<FitLevel, number> = Object.fromEntries(
  FIT_LEVELS.map((level, index) => [level, index]),
) as Record<FitLevel, number>;
const CATEGORY_RANK: Record<string, number> = Object.fromEntries(
  OPPORTUNITY_CATEGORIES.map((category, index) => [category, index]),
);

/** Two decimals: lead_opportunities.confidence is numeric(3,2). */
export function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validateOutput(output: AnalysisOutput, pack: EvidencePack): ValidationResult {
  const issues: Issue[] = [];
  const statusOf = new Map(pack.items.map((item) => [item.ref, item.status]));
  const known = (ref: string) => Object.hasOwn(pack.refToFindingId, ref);

  let strongCount = 0;
  const validated: ValidatedOpportunity[] = [];

  output.opportunities.forEach((o, index) => {
    const base = `opportunities[${index}]`;
    let referencesOk = true;

    o.evidence_refs.forEach((ref, refIndex) => {
      if (!known(ref)) {
        referencesOk = false;
        issues.push({
          code: "unknown_reference",
          path: `${base}.evidence_refs[${refIndex}]`,
          detail: ref,
        });
      }
    });

    const text: [string, string][] = [
      [`${base}.rationale`, o.rationale],
      [`${base}.uncertainty`, o.uncertainty],
      ...o.missing_information.map((item, i): [string, string] => [
        `${base}.missing_information[${i}]`,
        item,
      ]),
    ];
    for (const [path, value] of text) {
      if (containsContactData(value)) issues.push({ code: "contact_data_in_text", path });
    }

    if (o.fit_level === "strong") {
      strongCount++;
      const hasFact = o.evidence_refs.some((ref) => statusOf.get(ref) === "fact");
      if (referencesOk && !hasFact) {
        issues.push({ code: "strong_needs_fact", path: `${base}.fit_level` });
      }
    }

    if (referencesOk) {
      validated.push({
        category: o.category,
        fit_level: o.fit_level,
        rationale: o.rationale.trim(),
        confidence: roundConfidence(o.confidence),
        references: [...o.evidence_refs],
        findingIds: o.evidence_refs.map((ref) => pack.refToFindingId[ref]),
        missing_information: o.missing_information.map((item) => item.trim()),
        uncertainty: o.uncertainty.trim(),
        basedOnUnconfirmed: o.evidence_refs.some((ref) => statusOf.get(ref) === "candidate"),
      });
    }
  });

  if (strongCount > MAX_STRONG_FITS) {
    issues.push({ code: "too_many_strong", path: "opportunities" });
  }
  if (issues.length > 0) return { ok: false, issues };

  // Rank in code, not by the model's order: stronger fit first, then more confident, then catalogue order.
  validated.sort(
    (a, b) =>
      FIT_RANK[a.fit_level] - FIT_RANK[b.fit_level] ||
      b.confidence - a.confidence ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
  );
  return { ok: true, opportunities: validated };
}
