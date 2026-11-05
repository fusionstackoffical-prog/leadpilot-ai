import type { Json } from "../../types/database.ts";
import type { FindingCategory } from "./engine/extract/types.ts";
import { displayHost, safeExternalUrl } from "./links.ts";

/**
 * Turns stored research findings into what the profile shows. Pure TypeScript.
 *
 * Everything here is derived from the pages of a company's website and is UNTRUSTED. The output
 * therefore contains only plain strings (never markup), and a link is produced only when
 * `safeExternalUrl` accepts the address, so `javascript:`, `data:`, `mailto:` and look-alike
 * values can never become clickable.
 *
 * Mapping: the Phase 3B engine has 13 finding categories, but migration 009 stores findings in
 * 9. The engine's industry, product, company name, website and contact page have no database
 * category of their own and are stored as `company_detail`; the engine records which one in
 * `value_json.category` (and as the prefix of `field_key`). `engineCategoryOf` reverses that.
 */

export type FindingRow = {
  id: string;
  category: string;
  kind: string;
  field_key: string;
  value_text: string;
  value_json: Json | null;
  source_id: string | null;
  evidence_quote: string | null;
  quote_check: string | null;
  quote_verified_at: string | null;
  confidence: number | null;
  created_at: string;
};

export type SourceRow = {
  id: string;
  url: string;
  final_url: string | null;
  title: string | null;
  retrieved_at: string;
  http_status: number | null;
  source_type: string;
};

// ---------------------------------------------------------------------------------------------
// Plain text helpers
// ---------------------------------------------------------------------------------------------

/** Keeps tab, line feed and printable characters; drops other control characters. */
function stripControls(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    if (!control) out += ch;
  }
  return out;
}

/** Display text from untrusted input: no control characters, trimmed, cut on a character boundary. */
export function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = stripControls(value).trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

const MAX_VALUE = 600;
export const MAX_QUOTE = 1000; // migration 009's limit for evidence_quote
const MAX_EVIDENCE_LINE = 300;

function asObject(value: Json | null | undefined): Record<string, Json> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

// ---------------------------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------------------------

const DIRECT: Record<string, FindingCategory> = {
  business_description: "business_description",
  service: "service",
  service_area: "service_area",
  location: "location",
  contact_email: "contact_email",
  contact_phone: "contact_phone",
  contact_address: "contact_address",
  social_profile: "social_profile",
};

const DETAIL_CATEGORIES: ReadonlySet<string> = new Set([
  "company_name",
  "website",
  "industry",
  "product",
  "contact_page",
]);

/** Prefix of the stored `field_key` (the engine's key) for each company_detail type. */
const KEY_PREFIX: Record<string, FindingCategory> = {
  name: "company_name",
  industry: "industry",
  product: "product",
  contact_page: "contact_page",
  website: "website",
};

/** The Phase 3B category a stored finding came from, or null for categories the engine never writes. */
export function engineCategoryOf(
  row: Pick<FindingRow, "category" | "field_key" | "value_json">,
): FindingCategory | null {
  const direct = DIRECT[row.category];
  if (direct) return direct;
  if (row.category !== "company_detail") return null;

  const stated = asObject(row.value_json)?.category;
  if (typeof stated === "string" && DETAIL_CATEGORIES.has(stated)) return stated as FindingCategory;
  return KEY_PREFIX[row.field_key.split(":")[0]] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Presented findings
// ---------------------------------------------------------------------------------------------

export type PresentedSource = {
  id: string;
  /** The page title, or its host. */
  label: string;
  /** The full address as plain text (always shown, never trusted as a link). */
  urlText: string;
  /** A safe external link, or null. */
  href: string | null;
  retrievedAt: string;
  httpStatus: number | null;
};

export type PresentedFinding = {
  id: string;
  /** The engine category, or "other" for a stored category this version of the engine doesn't write. */
  category: FindingCategory | "other";
  value: string;
  kind: "fact" | "candidate";
  /** "confirmed" only for a fact that has BOTH a source and an exact supporting quote. */
  verification: "confirmed" | "unconfirmed";
  verificationLabel: string;
  verifiedAt: string | null;
  /** How it was found: "json-ld", "page-text", "link"... (plain text from the engine). */
  method: string | null;
  source: PresentedSource | null;
  quote: string | null;
  /** Extra quotes for values assembled from several parts, such as a full address. */
  extraEvidence: string[];
  details: { label: string; value: string }[];
  /** A safe link when the VALUE is itself a web address (social profile, contact page, website). */
  href: string | null;
};

/**
 * A clickable address for website-derived text, or null.
 *
 * Stricter than `safeExternalUrl` on its own, which is meant for imported values and so accepts a
 * bare domain ("acme.com") or a protocol-relative one ("//acme.com") and assumes https. Research
 * results are written by the engine with an explicit scheme, so anything else is shown as text
 * only. `safeExternalUrl` still does the real checking: http(s) only, a public-looking host, no
 * credentials, no whitespace, so `javascript:`, `data:` and `mailto:` never become links.
 */
export function linkOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || !/^https?:\/\//i.test(text)) return null;
  return safeExternalUrl(text);
}

export function presentSource(row: SourceRow): PresentedSource {
  const shown = row.final_url ?? row.url;
  const href = linkOf(shown) ?? linkOf(row.url);
  const host = href ? plain(displayHost(href) ?? "", 120) : "";
  return {
    id: row.id,
    label: plain(row.title, 160) || host || "Source",
    urlText: plain(shown, 300),
    href,
    retrievedAt: row.retrieved_at,
    httpStatus: row.http_status,
  };
}

/** Categories whose value is a web address and may be shown as a (safe) link. */
const LINKED: ReadonlySet<string> = new Set(["social_profile", "contact_page", "website"]);

const LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;

export function presentFinding(
  row: FindingRow,
  category: FindingCategory | "other",
  sources: Map<string, PresentedSource>,
): PresentedFinding {
  const json = asObject(row.value_json);
  const source = row.source_id ? (sources.get(row.source_id) ?? null) : null;
  const quote = plain(row.evidence_quote, MAX_QUOTE) || null;
  const isFact = row.kind === "fact";
  const confirmed = isFact && source !== null && quote !== null;

  const evidence = Array.isArray(json?.evidence) ? json.evidence : [];
  const detailsObject = asObject(json?.details ?? null);
  const method = typeof json?.method === "string" ? plain(json.method, 40) || null : null;
  const value = plain(row.value_text, MAX_VALUE);

  return {
    id: row.id,
    category,
    value,
    kind: isFact ? "fact" : "candidate",
    verification: confirmed ? "confirmed" : "unconfirmed",
    verificationLabel: confirmed
      ? "Confirmed"
      : isFact
        ? "Unconfirmed: the source or quote is unavailable"
        : "Unconfirmed: needs review",
    verifiedAt: confirmed ? row.quote_verified_at : null,
    method,
    source,
    quote,
    extraEvidence: evidence
      .filter((line): line is string => typeof line === "string")
      .map((line) => plain(line, MAX_EVIDENCE_LINE))
      .filter(Boolean)
      .slice(0, 6),
    details: Object.entries(detailsObject ?? {})
      .filter(([label, v]) => LABEL_PATTERN.test(label) && typeof v === "string")
      .map(([label, v]) => ({ label, value: plain(v, 160) }))
      .filter((d) => d.value)
      .slice(0, 8),
    href: LINKED.has(category) ? linkOf(row.value_text) : null,
  };
}

export type PresentedAssessment = {
  id: string;
  text: string;
  confidence: number | null;
};

/** Everything the profile shows from one research run, grouped by section. */
export type ResearchSections = {
  companyNames: PresentedFinding[];
  descriptions: PresentedFinding[];
  websites: PresentedFinding[];
  industries: PresentedFinding[];
  services: PresentedFinding[];
  products: PresentedFinding[];
  emails: PresentedFinding[];
  phones: PresentedFinding[];
  contactPages: PresentedFinding[];
  addresses: PresentedFinding[];
  locations: PresentedFinding[];
  serviceAreas: PresentedFinding[];
  socialProfiles: PresentedFinding[];
  /** Stored categories the engine does not write today (people, certifications). Still shown, never hidden. */
  other: PresentedFinding[];
  /** AI assessments, if any exist. They are never presented as facts. */
  summary: PresentedAssessment[];
  observations: PresentedAssessment[];
  challenges: PresentedAssessment[];
  opportunities: PresentedAssessment[];
};

const SECTION_OF: Record<FindingCategory, keyof ResearchSections> = {
  company_name: "companyNames",
  business_description: "descriptions",
  website: "websites",
  industry: "industries",
  service: "services",
  product: "products",
  contact_email: "emails",
  contact_phone: "phones",
  contact_page: "contactPages",
  contact_address: "addresses",
  location: "locations",
  service_area: "serviceAreas",
  social_profile: "socialProfiles",
};

const ASSESSMENT_SECTION: Record<string, keyof ResearchSections> = {
  company_summary: "summary",
  observation: "observations",
  challenge: "challenges",
  opportunity: "opportunities",
};

export function emptySections(): ResearchSections {
  return {
    companyNames: [],
    descriptions: [],
    websites: [],
    industries: [],
    services: [],
    products: [],
    emails: [],
    phones: [],
    contactPages: [],
    addresses: [],
    locations: [],
    serviceAreas: [],
    socialProfiles: [],
    other: [],
    summary: [],
    observations: [],
    challenges: [],
    opportunities: [],
  };
}

/** Confirmed items first, then unconfirmed ones; alphabetical within each. */
function byConfidence(a: PresentedFinding, b: PresentedFinding) {
  if (a.verification !== b.verification) return a.verification === "confirmed" ? -1 : 1;
  return a.value.localeCompare(b.value);
}

export function groupFindings(findings: FindingRow[], sourceRows: SourceRow[]): ResearchSections {
  const sources = new Map(sourceRows.map((s) => [s.id, presentSource(s)]));
  const sections = emptySections();

  for (const row of findings) {
    if (row.kind === "assessment") {
      const key = ASSESSMENT_SECTION[row.category];
      if (key) {
        (sections[key] as PresentedAssessment[]).push({
          id: row.id,
          text: plain(row.value_text, MAX_VALUE),
          confidence: row.confidence,
        });
      }
      continue;
    }
    if (row.kind !== "fact" && row.kind !== "candidate") continue;

    const category = engineCategoryOf(row);
    if (!category) {
      // Never drop a stored finding silently: a category this version doesn't know goes to "other".
      sections.other.push(presentFinding(row, "other", sources));
      continue;
    }
    (sections[SECTION_OF[category]] as PresentedFinding[]).push(
      presentFinding(row, category, sources),
    );
  }

  for (const key of Object.keys(sections) as (keyof ResearchSections)[]) {
    const list = sections[key];
    if (list.length > 0 && "verification" in list[0])
      (list as PresentedFinding[]).sort(byConfidence);
  }
  return sections;
}

export function countFindings(sections: ResearchSections) {
  let confirmed = 0;
  let unconfirmed = 0;
  for (const list of Object.values(sections)) {
    for (const item of list as (PresentedFinding | PresentedAssessment)[]) {
      if (!("verification" in item)) continue;
      if (item.verification === "confirmed") confirmed++;
      else unconfirmed++;
    }
  }
  return { confirmed, unconfirmed };
}

// ---------------------------------------------------------------------------------------------
// Missing information
// ---------------------------------------------------------------------------------------------

export const NOT_FOUND_TEXT = "Not found in the pages researched.";

const EXPECTED: { key: keyof ResearchSections; label: string }[] = [
  { key: "companyNames", label: "Company name" },
  { key: "descriptions", label: "Business description" },
  { key: "industries", label: "Industry" },
  { key: "services", label: "Services" },
  { key: "products", label: "Products" },
  { key: "emails", label: "Business email" },
  { key: "phones", label: "Phone number" },
  { key: "contactPages", label: "Contact page" },
  { key: "addresses", label: "Address" },
  { key: "locations", label: "Location" },
  { key: "serviceAreas", label: "Service areas" },
  { key: "socialProfiles", label: "Social profiles" },
];

export type MissingItem = { key: string; label: string; text: string };

/**
 * What the research did not find. Derived, never guessed: a group with no confirmed item and no
 * candidate is reported as not found. The worker does not store this list itself.
 */
export function missingInformation(sections: ResearchSections): MissingItem[] {
  return EXPECTED.filter(({ key }) => sections[key].length === 0).map(({ key, label }) => ({
    key,
    label,
    text: NOT_FOUND_TEXT,
  }));
}

// ---------------------------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------------------------

export type PresentedWarning = {
  code: string;
  title: string;
  detail: string;
  /** The page it concerns (host), when the warning names one. */
  page: string | null;
  href: string | null;
};

/** Wording for each warning code the engine can emit. The engine's own message text is not shown. */
const WARNING_TEXT: Record<string, { title: string; detail: string }> = {
  page_failed: {
    title: "A page couldn't be fetched",
    detail: "A page on the website returned an error or couldn't be reached.",
  },
  page_skipped_robots: {
    title: "A page was skipped",
    detail: "The website's robots.txt doesn't allow this page to be read.",
  },
  page_skipped_offsite: {
    title: "A link was not followed",
    detail: "A link led to another website, which was not contacted.",
  },
  page_needs_javascript: {
    title: "A page needs JavaScript",
    detail: "It shows little content without JavaScript, so some information may be missing.",
  },
  page_parse_limited: {
    title: "A page was only partly read",
    detail: "Its markup was unusually large or deeply nested.",
  },
  page_parse_failed: {
    title: "A page couldn't be read",
    detail: "It was skipped.",
  },
  crawl_deadline: {
    title: "The time limit was reached",
    detail: "Remaining pages were skipped.",
  },
  parked_domain: {
    title: "The website looks parked or for sale",
    detail: "It may not be the company's real website.",
  },
  name_mismatch: {
    title: "The website's name doesn't match the company",
    detail: "Check that this is the right website for the company.",
  },
  evidence_truncated: {
    title: "A very long page was only partly kept",
    detail: "Only its first part was stored.",
  },
  quote_rejected: {
    title: "Some evidence couldn't be verified",
    detail: "It was discarded rather than shown.",
  },
  evidence_insufficient: {
    title: "Some findings were dropped",
    detail: "Their evidence didn't support the whole value.",
  },
  limit_reached: {
    title: "Only the first items of a category were kept",
    detail: "The page listed more than the research stores.",
  },
};

const MAX_WARNINGS = 50;

export function presentWarnings(raw: Json | null | undefined): PresentedWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: PresentedWarning[] = [];
  for (const item of raw.slice(0, MAX_WARNINGS)) {
    const entry = asObject(item);
    if (!entry) continue;
    const rawCode = typeof entry.code === "string" ? entry.code : "";
    const code = /^[a-z_]{1,40}$/.test(rawCode) ? rawCode : "unknown";
    const text = WARNING_TEXT[code] ?? {
      title: code === "unknown" ? "The research reported a warning" : `Warning (${code})`,
      detail: "No further detail is available.",
    };
    // The page is shown only when it is a safe address; otherwise the warning names no page.
    const href = typeof entry.url === "string" ? linkOf(entry.url) : null;
    out.push({
      code,
      title: text.title,
      detail: text.detail,
      page: href ? plain(displayHost(href) ?? "", 120) || null : null,
      href,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------------------------

const METHOD_TEXT: Record<string, string> = {
  "json-ld": "the page's structured data",
  "meta-description": "the page's description tag",
  "og-site-name": "the page's site-name tag",
  "page-title": "the page title",
  "page-url": "the page address",
  "page-text": "the page text",
  "address-element": "an address block",
  "mailto-link": "an email link",
  "tel-link": "a phone link",
  "labelled-text": "a labelled line of text",
  "section-heading": "a section heading",
  "section-list-item": "a list item",
  "site-link": "a link on the page",
};

/** Plain-language name for how a value was found, or null for a method this version doesn't know. */
export function describeMethod(method: string | null | undefined): string | null {
  return method ? (METHOD_TEXT[method] ?? null) : null;
}

/**
 * What an empty list says. "Not found in the pages researched." only when research actually
 * finished; before that, or when an attempt didn't finish, the text says so instead of implying
 * that something was searched for and not found.
 */
export function emptyResultsText(ctx: { runStatus: string | null; active: boolean }): string {
  const { runStatus, active } = ctx;
  if (runStatus === "completed" || runStatus === "completed_with_warnings") return NOT_FOUND_TEXT;
  if (runStatus === "failed" || runStatus === "cancelled") {
    return "This attempt didn't finish, so there are no results from it.";
  }
  if (active || runStatus === "queued" || runStatus === "running") {
    return "Research is in progress. Results appear here when it finishes.";
  }
  return "Not researched yet. Nothing has been looked up or inferred.";
}
