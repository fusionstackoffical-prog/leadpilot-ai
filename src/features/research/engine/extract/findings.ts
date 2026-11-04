import { verifyQuote } from "./evidence.ts";
import { withinBoundary } from "./pages.ts";
import {
  EXCLUDED_RELATIONS,
  GENERIC_BUSINESS_TYPES,
  NON_BUSINESS_TYPES,
  PRIMARY_PARENT_TYPES,
  PRIMARY_RELATIONS,
} from "./schema.ts";
import { clip, clipCodePoints, normalizeText, supports } from "./text.ts";
import type {
  ExtractedFinding,
  ExtractionWarning,
  FindingCategory,
  FindingProposal,
  JsonLdEntity,
  ParsedPage,
} from "./types.ts";
import { ALL_CATEGORIES } from "./types.ts";

/** Per-category caps; the total (170) stays well under the 300 findings a run may save. */
export const CATEGORY_CAPS: Record<FindingCategory, number> = {
  company_name: 3,
  website: 1,
  business_description: 4,
  industry: 5,
  service: 40,
  product: 40,
  contact_email: 10,
  contact_phone: 10,
  contact_page: 2,
  contact_address: 5,
  location: 10,
  service_area: 25,
  social_profile: 15,
};

export const MAX_VALUE_CHARS = 4_000;
export const MAX_QUOTE_CHARS = 1_000;

/**
 * Collects findings. A finding is kept only when
 *  1. its quote (and any extra evidence quotes) is found in its page's evidence text, and
 *  2. every part of its value is stated in those quotes (case and punctuation ignored),
 * so a confirmed fact never claims more than its evidence shows. Anything else is dropped with
 * a warning: nothing unverifiable is ever kept. Duplicates (same category and key) are merged,
 * a fact replaces a candidate, and per-category caps are enforced.
 */
export class FindingCollector {
  readonly #findings = new Map<string, ExtractedFinding>();
  readonly #warnings: ExtractionWarning[];
  readonly #capped = new Set<FindingCategory>();

  constructor(warnings: ExtractionWarning[]) {
    this.#warnings = warnings;
  }

  add(page: ParsedPage, proposal: FindingProposal): boolean {
    const { supportParts, ...finding } = proposal;
    const value = clip(normalizeText(finding.value), MAX_VALUE_CHARS);
    const quote = clipCodePoints(normalizeText(finding.quote), MAX_QUOTE_CHARS);
    const evidence = (finding.evidence ?? []).map((q) =>
      clipCodePoints(normalizeText(q), MAX_QUOTE_CHARS),
    );
    if (!value) return false;

    if (![quote, ...evidence].every((q) => verifyQuote(page, q))) {
      this.#warnings.push({
        code: "quote_rejected",
        message: `Evidence for ${finding.category} was not found in the page text and was discarded`,
        url: page.url,
      });
      return false;
    }
    const parts = supportParts ?? [value];
    if (parts.length === 0 || !parts.every((part) => supports([quote, ...evidence], part))) {
      this.#warnings.push({
        code: "evidence_insufficient",
        message: `Evidence for ${finding.category} did not support the whole value, so it was not kept`,
        url: page.url,
      });
      return false;
    }

    const id = `${finding.category}|${finding.key}`;
    const existing = this.#findings.get(id);
    if (existing && (existing.kind === "fact" || finding.kind === "candidate")) return false;
    if (!existing && this.count(finding.category) >= CATEGORY_CAPS[finding.category]) {
      if (!this.#capped.has(finding.category)) {
        this.#capped.add(finding.category);
        this.#warnings.push({
          code: "limit_reached",
          message: `Only the first ${CATEGORY_CAPS[finding.category]} ${finding.category.replace(/_/g, " ")} items were kept`,
        });
      }
      return false;
    }
    this.#findings.set(id, {
      ...finding,
      value,
      quote,
      ...(evidence.length > 0 ? { evidence } : {}),
      sourceUrl: page.url,
    });
    return true;
  }

  count(category: FindingCategory) {
    let n = 0;
    for (const f of this.#findings.values()) if (f.category === category) n++;
    return n;
  }

  list(): ExtractedFinding[] {
    const order = new Map(ALL_CATEGORIES.map((c, i) => [c, i]));
    return [...this.#findings.values()].sort(
      (a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0),
    );
  }
}

/** Properties that only a business/organization entity would carry. */
const BUSINESS_SIGNAL =
  /^(address|telephone|email|logo|openingHours|openingHoursSpecification|sameAs|priceRange|geo|contactPoint|founder|foundingDate|areaServed|hasMap|url|servesCuisine|medicalSpecialty|numberOfEmployees|legalName)(\b|\[|\.|$)/;

/**
 * A business-like entity: named, of a type that is not a page, product, offer, person, place,
 * etc., and carrying at least one business property (so a named amenity is never a company).
 */
export function isBusinessEntity(entity: JsonLdEntity) {
  if (!entity.props.name || !entity.types.some((t) => !NON_BUSINESS_TYPES.has(t))) return false;
  return (
    entity.types.some((t) => GENERIC_BUSINESS_TYPES.has(t) && t !== "Place" && t !== "Thing") ||
    Object.keys(entity.props).some((path) => BUSINESS_SIGNAL.test(path))
  );
}

/** An entity reached through a relationship that points away from the business. */
export function viaExcludedRelation(entity: JsonLdEntity) {
  return entity.relations.some((r) => EXCLUDED_RELATIONS.has(r));
}

function entityUrl(entity: JsonLdEntity) {
  for (const key of ["url", "@id"]) {
    const value = entity.props[key];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // relative or blank-node id: says nothing about the domain
    }
  }
  return null;
}

/**
 * The entities that describe the researched business on this page:
 * - business-like, and
 * - a root JSON-LD object, or named by a page/service through publisher / about / mainEntity /
 *   provider, and
 * - not reached through manufacturer, seller, author, employee or similar relationships, and
 * - not declaring a URL on another domain (a partner or supplier described on the page).
 * People are never business entities, so staff contact details are never attributed to it.
 */
export function primaryBusinessEntities(page: ParsedPage) {
  const site = new URL(page.url);
  return page.jsonLd.filter((entity) => {
    if (!isBusinessEntity(entity) || viaExcludedRelation(entity)) return false;
    const named =
      entity.topLevel ||
      (entity.relations.length === 1 &&
        PRIMARY_RELATIONS.has(entity.relations[0]) &&
        entity.parentTypes.some((t) => PRIMARY_PARENT_TYPES.has(t)));
    if (!named) return false;
    const url = entityUrl(entity);
    return !url || withinBoundary(url, site) || withinBoundary(site, url);
  });
}

/** Business types too generic to name an industry are excluded. */
export function industryTypes(entity: JsonLdEntity) {
  return entity.types.filter((t) => !NON_BUSINESS_TYPES.has(t) && !GENERIC_BUSINESS_TYPES.has(t));
}

/** "RealEstateAgent" -> "Real Estate Agent", "HVACBusiness" -> "HVAC Business". */
export function humanizeType(type: string) {
  return type
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/** "@type: A, B" — the evidence line for an entity's types. */
export function typeLine(entity: JsonLdEntity) {
  return `@type: ${entity.types.join(", ")}`;
}

/** Props of an entity whose path matches, e.g. /(^|\.)telephone$/ . */
export function propsMatching(entity: JsonLdEntity, pattern: RegExp) {
  return Object.entries(entity.props).filter(([path]) => pattern.test(path));
}
