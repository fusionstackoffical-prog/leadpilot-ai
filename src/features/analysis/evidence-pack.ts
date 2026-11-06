import { createHash } from "node:crypto";
import type { Json } from "../../types/database.ts";
import { engineCategoryOf, type FindingRow } from "../research/presenter.ts";
import { isOnlyPlaceholders, redactContactData } from "./contact-data.ts";
import { PACK_LIMITS } from "./limits.ts";
import { sanitizeText, truncateCodePoints } from "./text.ts";
import { PACK_VERSION } from "./versions.ts";

/**
 * The evidence pack: the ONLY information the model receives about a company.
 *
 * Built from the findings of ONE completed research run. Rules (enforced here, and again by
 * migration 010's guard when results are saved):
 *  - only facts and candidates; AI assessments are never fed back into an analysis;
 *  - never e-mail, phone or person findings (the database refuses to let an opportunity cite them);
 *  - never address findings (contact_address): for a small business the "business address" can be
 *    the owner's home. Migration 010 would allow citing them; this pack is stricter on purpose, and
 *    because the model only ever sees pack items, an address finding cannot be cited at all.
 *    (Location and service-area findings, which describe where the company works, are kept.)
 *  - never imported lead fields: the research findings are the only input;
 *  - e-mail addresses, web addresses and phone-like numbers inside any remaining text are redacted;
 *  - the model sees short references (E1, E2, ...) and never a finding id: the mapping stays here.
 *
 * Everything is deterministic: the same findings always produce the same pack and hash.
 */

/** What the pack reads from a stored finding. A research_findings row satisfies this. */
export type ResearchFindingInput = Pick<
  FindingRow,
  "id" | "category" | "kind" | "field_key" | "value_text" | "value_json" | "evidence_quote"
> & {
  /** If present on every finding, all of them must be the same run. */
  run_id?: string;
};

export type EvidenceStatus = "fact" | "candidate";

/** Topics are what the model is told each item is about. They are NOT database categories. */
export const EVIDENCE_TOPICS = [
  "business_description",
  "industry",
  "service",
  "product",
  "certification",
  "location",
  "service_area",
  "social_profile",
] as const;
export type EvidenceTopic = (typeof EVIDENCE_TOPICS)[number];

export type EvidenceItem = {
  /** E1, E2, ... in the pack's deterministic order. */
  ref: string;
  status: EvidenceStatus;
  topic: EvidenceTopic;
  /** Cleaned, redacted, truncated. */
  value: string;
  /** The verified source quote when it adds something beyond the value, else null. */
  quote: string | null;
};

export type PackStats = {
  /** Findings given to the builder. */
  considered: number;
  /** Items in the pack. */
  included: number;
  /** Findings left out, by reason: a category name, "kind:assessment", "unknown_category", ... */
  excluded: Readonly<Record<string, number>>;
  /** Items dropped because nothing readable was left after redaction. */
  droppedEmpty: number;
  /** Items dropped because the same fact was already in the pack. */
  deduplicated: number;
  /** Items dropped by the per-topic, item-count or total-size caps. */
  droppedByCap: number;
  /** Values or quotes that were shortened. */
  truncated: number;
  /** How much contact data was removed from the included text. */
  redactions: { emails: number; urls: number; phones: number };
};

export type EvidencePack = {
  items: readonly EvidenceItem[];
  /** PRIVATE: reference -> finding id. Never given to the model. */
  refToFindingId: Readonly<Record<string, string>>;
  /** SHA-256 (hex) of the canonical pack. The same evidence always has the same hash. */
  inputHash: string;
  stats: PackStats;
};

export type PackResult =
  | { ok: true; pack: EvidencePack }
  | {
      ok: false;
      /** no_usable_findings: nothing left to analyze. research_not_usable: findings of several runs. */
      code: "no_usable_findings" | "research_not_usable";
      stats: PackStats;
    };

/** Categories that are never analyzed (migration 010 refuses to let an opportunity cite them). */
const NEVER_ANALYZED_DB_CATEGORIES: ReadonlySet<string> = new Set([
  "contact_email",
  "contact_phone",
  "person",
]);

/**
 * Stricter than the database, by decision: a street address may be a private home, so address
 * findings are left out, whatever their kind. Checked on the stored category BEFORE any mapping.
 */
const EXCLUDED_BY_POLICY_DB_CATEGORIES: ReadonlySet<string> = new Set(["contact_address"]);

/**
 * Engine categories that carry no business insight and are only addresses or names: left out so
 * no URL, name or address travels to the model. (company_name, website, contact_page, and the
 * contact and address categories again, as a second line of defence.)
 */
const NOT_NEEDED_ENGINE_CATEGORIES: ReadonlySet<string> = new Set([
  "company_name",
  "website",
  "contact_page",
  "contact_email",
  "contact_phone",
  "contact_address",
]);

const TOPIC_OF_ENGINE_CATEGORY: Readonly<Record<string, EvidenceTopic>> = {
  business_description: "business_description",
  industry: "industry",
  service: "service",
  product: "product",
  location: "location",
  service_area: "service_area",
  social_profile: "social_profile",
};

function asObject(value: Json | null | undefined): Record<string, Json | undefined> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** A social profile's address is a URL, so only the platform's name is used. */
function socialPlatform(valueJson: Json | null): string | null {
  const details = asObject(asObject(valueJson)?.details ?? null);
  const platform = details?.platform;
  return typeof platform === "string" && /^[a-z0-9]{2,30}$/i.test(platform)
    ? platform.toLowerCase()
    : null;
}

function emptyStats(considered: number): {
  stats: PackStats;
  excluded: Record<string, number>;
} {
  const excluded: Record<string, number> = {};
  return {
    excluded,
    stats: {
      considered,
      included: 0,
      excluded,
      droppedEmpty: 0,
      deduplicated: 0,
      droppedByCap: 0,
      truncated: 0,
      redactions: { emails: 0, urls: 0, phones: 0 },
    },
  };
}

const ucmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Candidate = {
  id: string;
  status: EvidenceStatus;
  topic: EvidenceTopic;
  value: string;
  quote: string | null;
  /** Contact data removed from this item's text. */
  red: { emails: number; urls: number; phones: number };
  /** How many of its fields were shortened (0-2). */
  shortened: number;
};

/** Canonical form that is hashed: layout version plus every item's visible fields, no finding ids. */
function canonicalPack(items: readonly EvidenceItem[]): string {
  return JSON.stringify({
    pack: PACK_VERSION,
    items: items.map((i) => [i.ref, i.status, i.topic, i.value, i.quote]),
  });
}

export function hashPackItems(items: readonly EvidenceItem[]): string {
  return createHash("sha256").update(canonicalPack(items), "utf8").digest("hex");
}

export function buildEvidencePack(findings: readonly ResearchFindingInput[]): PackResult {
  const { stats, excluded } = emptyStats(findings.length);
  const bump = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };

  // One research run only. (Findings without run_id are trusted to be from one run.)
  const runs = new Set(findings.map((f) => f.run_id).filter((r): r is string => Boolean(r)));
  if (runs.size > 1) return { ok: false, code: "research_not_usable", stats };

  const candidates: Candidate[] = [];
  for (const f of findings) {
    if (f.kind !== "fact" && f.kind !== "candidate") {
      bump(`kind:${f.kind === "assessment" ? "assessment" : "other"}`);
      continue;
    }
    if (NEVER_ANALYZED_DB_CATEGORIES.has(f.category)) {
      bump(f.category);
      continue;
    }
    if (EXCLUDED_BY_POLICY_DB_CATEGORIES.has(f.category)) {
      bump(f.category);
      continue;
    }

    const engine = engineCategoryOf(f);
    let topic: EvidenceTopic | null;
    if (engine) {
      if (NOT_NEEDED_ENGINE_CATEGORIES.has(engine)) {
        bump(engine);
        continue;
      }
      topic = TOPIC_OF_ENGINE_CATEGORY[engine] ?? null;
    } else {
      topic = f.category === "certification" ? "certification" : null;
    }
    if (!topic) {
      bump("unknown_category");
      continue;
    }

    // Text: clean, then remove contact data, then shorten.
    let valueRaw: string;
    let quoteRaw: string | null = f.evidence_quote ?? null;
    if (topic === "social_profile") {
      const platform = socialPlatform(f.value_json);
      if (!platform) {
        bump("social_profile_unreadable");
        continue;
      }
      valueRaw = platform;
      quoteRaw = null; // the quote is the profile's address
    } else {
      valueRaw = f.value_text;
    }

    const red = { emails: 0, urls: 0, phones: 0 };
    let shortened = 0;
    const clean = (raw: string, max: number): string | null => {
      const r = redactContactData(sanitizeText(raw));
      red.emails += r.emails;
      red.urls += r.urls;
      red.phones += r.phones;
      if (!r.text || isOnlyPlaceholders(r.text)) return null;
      const cut = truncateCodePoints(r.text, max);
      if (cut.truncated) shortened++;
      return cut.text;
    };

    const value = clean(valueRaw, PACK_LIMITS.maxValueChars);
    if (value === null) {
      stats.droppedEmpty++;
      continue;
    }
    let quote = quoteRaw === null ? null : clean(quoteRaw, PACK_LIMITS.maxQuoteChars);
    if (quote !== null && quote.toLowerCase() === value.toLowerCase()) quote = null;

    candidates.push({ id: f.id, status: f.kind, topic, value, quote, red, shortened });
  }

  // Deterministic order: facts before candidates, then topic, then text, then id.
  const topicRank = new Map<EvidenceTopic, number>(EVIDENCE_TOPICS.map((t, i) => [t, i]));
  candidates.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === "fact" ? -1 : 1) ||
      (topicRank.get(a.topic) ?? 0) - (topicRank.get(b.topic) ?? 0) ||
      ucmp(a.value, b.value) ||
      ucmp(a.quote ?? "", b.quote ?? "") ||
      ucmp(a.id, b.id),
  );

  // De-duplicate, then apply the caps in that order.
  const seen = new Set<string>();
  const perTopic = new Map<EvidenceTopic, number>();
  const kept: Candidate[] = [];
  let chars = 0;
  for (const c of candidates) {
    const key = `${c.status}|${c.topic}|${c.value.toLowerCase()}`;
    if (seen.has(key)) {
      stats.deduplicated++;
      continue;
    }
    const size = c.value.length + (c.quote?.length ?? 0) + 40;
    if (
      kept.length >= PACK_LIMITS.maxItems ||
      (perTopic.get(c.topic) ?? 0) >= PACK_LIMITS.maxPerTopic ||
      chars + size > PACK_LIMITS.maxPackChars
    ) {
      stats.droppedByCap++;
      continue;
    }
    seen.add(key);
    perTopic.set(c.topic, (perTopic.get(c.topic) ?? 0) + 1);
    chars += size;
    kept.push(c);
    // Counted only for items that reach the pack.
    stats.redactions.emails += c.red.emails;
    stats.redactions.urls += c.red.urls;
    stats.redactions.phones += c.red.phones;
    stats.truncated += c.shortened;
  }

  stats.included = kept.length;
  if (kept.length === 0) return { ok: false, code: "no_usable_findings", stats };

  const items: EvidenceItem[] = [];
  const refToFindingId: Record<string, string> = {};
  kept.forEach((c, i) => {
    const ref = `E${i + 1}`;
    items.push({ ref, status: c.status, topic: c.topic, value: c.value, quote: c.quote });
    refToFindingId[ref] = c.id;
  });

  return {
    ok: true,
    pack: {
      items: Object.freeze(items),
      refToFindingId: Object.freeze(refToFindingId),
      inputHash: hashPackItems(items),
      stats,
    },
  };
}
