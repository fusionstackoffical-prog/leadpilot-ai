/**
 * Types for industry-neutral website extraction (Phase 3B).
 *
 * Findings are either:
 * - "fact": the value is stated on the company's own website, its evidence quotes have been
 *   verified against the stored page text, and every part of the value appears in them;
 * - "candidate": the text is on the website, but reading it as this kind of information is a
 *   heuristic (e.g. a heading on a services page that is probably a service). Needs review.
 * AI assessments are a later phase and are never produced here.
 */

export type PageType = "home" | "about" | "services" | "products" | "contact" | "locations";

/** Where on the page a piece of text sits; navigation and banners are never used as facts. */
export type Region = "main" | "header" | "footer" | "nav" | "aside";

/**
 * "site": the website speaking for itself. "content": quoted or third-party material inside it
 * (testimonials, reviews, comments, lists of blog/news articles) — never a source of the
 * company's own contact details or official profiles.
 */
export type TextContext = "site" | "content";

export type TextBlock = {
  text: string;
  /** Nearest block-level tag (p, li, h2, address, td, ...). */
  tag: string;
  region: Region;
  context: TextContext;
  /** 1-6 for headings. */
  level?: number;
};

export type PageLink = {
  /** Absolute URL (http, https, mailto or tel). */
  href: string;
  text: string;
  region: Region;
  context: TextContext;
};

/** A schema.org entity found in JSON-LD, flattened to "path: value" pairs. */
export type JsonLdEntity = {
  types: string[];
  /** e.g. { "name": "Acme", "address.streetAddress": "1 Main St", "sameAs[0]": "https://..." } */
  props: Record<string, string>;
  /** A root object of a JSON-LD script (or a member of its @graph). */
  topLevel: boolean;
  /** Property names leading from the root to this entity, e.g. ["offers", "seller"]. */
  relations: string[];
  /** Types of the nearest typed ancestor ([] for top-level entities). */
  parentTypes: string[];
};

export type EvidenceDocument = {
  /** Normalized text that is stored (gzip) in private Storage and that every quote must match. */
  text: string;
  sha256: string;
  chars: number;
  truncated: boolean;
};

export type ParsedPage = {
  requestedUrl: string;
  /** Final URL after redirects. */
  url: string;
  pageType: PageType;
  status: number;
  contentType: string;
  retrievedAt: string;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  ogSiteName: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogType: string | null;
  blocks: TextBlock[];
  links: PageLink[];
  jsonLd: JsonLdEntity[];
  /** The page relies on JavaScript to show its content (little server-rendered text). */
  needsJavaScript: boolean;
  /** Nesting depth or element-count limits were hit; content beyond them was ignored. */
  parseLimited: boolean;
  evidence: EvidenceDocument;
};

export type FindingCategory =
  | "company_name"
  | "website"
  | "business_description"
  | "industry"
  | "service"
  | "product"
  | "contact_email"
  | "contact_phone"
  | "contact_page"
  | "contact_address"
  | "location"
  | "service_area"
  | "social_profile";

export const ALL_CATEGORIES: FindingCategory[] = [
  "company_name",
  "website",
  "business_description",
  "industry",
  "service",
  "product",
  "contact_email",
  "contact_phone",
  "contact_page",
  "contact_address",
  "location",
  "service_area",
  "social_profile",
];

export type ExtractionMethod =
  | "json-ld"
  | "meta-description"
  | "og-site-name"
  | "page-title"
  | "page-url"
  | "page-text"
  | "address-element"
  | "mailto-link"
  | "tel-link"
  | "labelled-text"
  | "site-link"
  | "section-heading"
  | "section-list-item";

export type ExtractedFinding = {
  category: FindingCategory;
  kind: "fact" | "candidate";
  /** Stable identity within a run, used for de-duplication and run-to-run comparison. */
  key: string;
  value: string;
  /** Optional structured detail (platform, address parts, description ...). */
  details?: Record<string, string>;
  sourceUrl: string;
  /** Exact text from the page's evidence document (verified). */
  quote: string;
  /**
   * Further verified quotes from the same page, when one quote cannot cover the whole value
   * (e.g. each line of a JSON-LD address). Stored with the finding.
   */
  evidence?: string[];
  method: ExtractionMethod;
};

/** What an extractor proposes; the collector verifies it and decides what is kept. */
export type FindingProposal = Omit<ExtractedFinding, "sourceUrl"> & {
  /**
   * The parts of the value that must each be stated in the quotes (default: the whole value).
   * Used when the value is derived, e.g. a humanized type or a canonical profile URL.
   */
  supportParts?: string[];
};

export type ExtractionWarning = {
  code:
    | "page_failed"
    | "page_skipped_robots"
    | "page_skipped_offsite"
    | "page_needs_javascript"
    | "page_parse_limited"
    | "page_parse_failed"
    | "crawl_deadline"
    | "parked_domain"
    | "name_mismatch"
    | "evidence_truncated"
    | "quote_rejected"
    | "evidence_insufficient"
    | "limit_reached";
  message: string;
  url?: string;
};

export type NameMatch = "match" | "partial" | "mismatch" | "unknown";

export type ExtractionResult = {
  website: string | null;
  findings: ExtractedFinding[];
  /** Categories with no fact and no candidate: unavailable, never guessed. */
  missing: FindingCategory[];
  warnings: ExtractionWarning[];
  /** Does the website's own name match the company name supplied in the import? */
  nameMatch: NameMatch;
};
