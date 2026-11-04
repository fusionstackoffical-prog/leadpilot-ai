import {
  FindingCollector,
  humanizeType,
  industryTypes,
  MAX_QUOTE_CHARS,
  primaryBusinessEntities,
  propsMatching,
  typeLine,
  viaExcludedRelation,
} from "./findings.ts";
import { classifyPage, sameSite } from "./pages.ts";
import { PRODUCT_TYPES, SERVICE_TYPES } from "./schema.ts";
import { clip, clipCodePoints, slug, tokens } from "./text.ts";
import type { NameMatch, PageType, ParsedPage, TextBlock } from "./types.ts";

// ---------------------------------------------------------------------------
// Company: website, name, description, industry
// ---------------------------------------------------------------------------

const GENERIC_TITLE_PART =
  /^(home|homepage|home page|welcome|official site|official website|index|main|coming soon|under construction|maintenance|page not found|not found|404|untitled|default page|website)$/i;
const BOILERPLATE_DESCRIPTION = /just another wordpress site|^(home|welcome)$/i;

/** Industry facets that schema.org states explicitly. */
const FACETS: [RegExp, string][] = [
  [/^servesCuisine(\[\d+\])?$/, "Cuisine"],
  [/^medicalSpecialty(\[\d+\])?(\.name)?$/, "Specialty"],
];

/** A description value short enough to sit entirely inside its (1,000-character) quote. */
function describable(label: string, text: string) {
  return clipCodePoints(text, MAX_QUOTE_CHARS - label.length - 2);
}

export function extractCompany(pages: ParsedPage[], c: FindingCollector) {
  const home = pages[0];
  c.add(home, {
    category: "website",
    kind: "fact",
    key: "website",
    value: home.url,
    quote: `URL: ${home.url}`,
    method: "page-url",
  });

  for (const page of pages) {
    for (const entity of primaryBusinessEntities(page)) {
      const name = entity.props.name;
      c.add(page, {
        category: "company_name",
        kind: "fact",
        key: `name:${slug(name)}`,
        value: name,
        quote: `name: ${name}`,
        method: "json-ld",
      });
      const description = entity.props.description;
      if (description && description.length >= 30) {
        c.add(page, {
          category: "business_description",
          kind: "fact",
          key: `description:${slug(description.slice(0, 80))}`,
          value: describable("description", description),
          quote: `description: ${description}`,
          method: "json-ld",
        });
      }
      for (const type of industryTypes(entity)) {
        c.add(page, {
          category: "industry",
          kind: "fact",
          key: `industry:${slug(type)}`,
          value: humanizeType(type),
          supportParts: [type],
          details: { schemaType: type },
          quote: typeLine(entity),
          method: "json-ld",
        });
      }
      for (const [pattern, label] of FACETS) {
        for (const [path, value] of propsMatching(entity, pattern)) {
          c.add(page, {
            category: "industry",
            kind: "fact",
            key: `industry:${slug(label)}:${slug(value)}`,
            value: `${label}: ${value}`,
            supportParts: [value],
            details: { facet: label.toLowerCase() },
            quote: `${path}: ${value}`,
            method: "json-ld",
          });
        }
      }
    }

    if (page.ogSiteName) {
      c.add(page, {
        category: "company_name",
        kind: "fact",
        key: `name:${slug(page.ogSiteName)}`,
        value: page.ogSiteName,
        quote: `OG SITE NAME: ${page.ogSiteName}`,
        method: "og-site-name",
      });
    }

    if (page.pageType === "home" || page.pageType === "about") {
      for (const [label, text] of [
        ["META DESCRIPTION", page.metaDescription],
        ["OG DESCRIPTION", page.ogDescription],
      ] as const) {
        if (!text || text.length < 30 || BOILERPLATE_DESCRIPTION.test(text)) continue;
        c.add(page, {
          category: "business_description",
          kind: "fact",
          key: `description:${slug(text.slice(0, 80))}`,
          value: describable(label, text),
          quote: `${label}: ${text}`,
          method: "meta-description",
        });
      }
    }

    if (page.pageType === "about") {
      const paragraph = page.blocks.find(
        (b) =>
          b.region === "main" &&
          b.context === "site" &&
          b.tag === "p" &&
          b.text.length >= 80 &&
          b.text.length <= 1_500,
      );
      if (paragraph) {
        c.add(page, {
          category: "business_description",
          kind: "candidate",
          key: `description:${slug(paragraph.text.slice(0, 80))}`,
          value: clipCodePoints(paragraph.text, MAX_QUOTE_CHARS),
          quote: paragraph.text,
          method: "page-text",
        });
      }
    }
  }

  // Only when the site states no name: a guess from the home page title ("Acme | Plumbing in
  // Austin"). Titles order brand and tagline either way, so the shortest segment is offered,
  // as a candidate for review.
  if (home.title && c.count("company_name") === 0) {
    const parts = home.title
      .split(/\s+[|–—:-]\s+|\s+::\s+/)
      .map((p) => p.trim())
      .filter((p) => p && !GENERIC_TITLE_PART.test(p));
    const name = [...parts].sort(
      (a, b) =>
        a.split(/\s+/).length - b.split(/\s+/).length || parts.indexOf(a) - parts.indexOf(b),
    )[0];
    if (name && name.length <= 120) {
      c.add(home, {
        category: "company_name",
        kind: "candidate",
        key: `name:${slug(name)}`,
        value: name,
        quote: name,
        method: "page-title",
      });
    }
  }
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "inc",
  "llc",
  "ltd",
  "limited",
  "co",
  "company",
  "corp",
  "corporation",
  "plc",
  "gmbh",
  "pvt",
  "pty",
]);

/**
 * Words that describe a kind of business rather than identify one. A name made only of these
 * ("Dental", "Home Services") cannot confirm that a website belongs to a company.
 */
const WEAK_NAME_WORDS = new Set([
  "home",
  "services",
  "service",
  "solutions",
  "group",
  "clinic",
  "clinics",
  "dental",
  "dentist",
  "dentistry",
  "medical",
  "health",
  "healthcare",
  "care",
  "restaurant",
  "cafe",
  "bar",
  "grill",
  "kitchen",
  "hotel",
  "inn",
  "resort",
  "realty",
  "real",
  "estate",
  "properties",
  "property",
  "homes",
  "agency",
  "digital",
  "marketing",
  "media",
  "studio",
  "shop",
  "store",
  "online",
  "center",
  "centre",
  "plumbing",
  "hvac",
  "heating",
  "air",
  "cooling",
  "law",
  "legal",
  "firm",
  "consulting",
  "partners",
  "associates",
  "international",
  "global",
  "official",
  "website",
  "site",
  "tea",
  "coffee",
]);

/**
 * Compares the imported company name with the names the website gives itself.
 * - match: the site name contains every word of the imported name, or the site name is a part
 *   of the imported name that includes at least one distinctive (non-generic) word;
 * - partial: they share a distinctive word;
 * - mismatch: they share no distinctive word (a shared generic word such as "Dental" is not
 *   enough); unknown: either name is missing.
 */
export function compareNames(imported: string | null | undefined, siteNames: string[]): NameMatch {
  const want = new Set(tokens(imported ?? "").filter((t) => !STOP_WORDS.has(t)));
  if (want.size === 0 || siteNames.length === 0) return "unknown";
  let best: NameMatch = "mismatch";
  for (const name of siteNames) {
    const have = new Set(tokens(name).filter((t) => !STOP_WORDS.has(t)));
    if (have.size === 0) continue;
    const shared = [...want].filter((t) => have.has(t));
    const distinctive = shared.filter((t) => !WEAK_NAME_WORDS.has(t));
    if (shared.length === want.size) return "match";
    if (shared.length === have.size && distinctive.length > 0) return "match";
    if (distinctive.length > 0) best = "partial";
  }
  return best;
}

// ---------------------------------------------------------------------------
// Offerings: services and products
// ---------------------------------------------------------------------------

const SERVICE_SECTION =
  /\b(services|our services|what we do|what we offer|solutions|treatments|specialt(?:y|ies)|practice areas|expertise|capabilities|procedures|amenities)\b/i;
const PRODUCT_SECTION =
  /\b(products|our products|shop|collections?|catalog(?:ue)?|our range|menus?|our menu|rooms|suites|accommodations?|listings|properties)\b/i;
/** Explicit service-area phrases only ("coverage" or "serving" alone are too ambiguous). */
const AREA_SECTION =
  /\b(areas? (?:we )?serve[ds]?|service areas?|areas served|where we work|areas covered|coverage areas?|locations we serve|our service area)\b/i;
const GENERIC_HEADING =
  /^(home|about( us)?|contact( us)?|get in touch|get started|our (team|story|clients|work|mission|values|process|partners|history)|meet (the|our) team|team|why choose us|why us|testimonials?|reviews?|faqs?|frequently asked questions|blog|news|latest news|careers|jobs|gallery|portfolio|case studies|client stories|partners|awards|certifications|pricing|prices|book (now|online|an appointment)|learn more|read more|view all|see all|shop now|follow us|newsletter|subscribe|privacy policy|terms.*|copyright.*|welcome.*|hours|opening hours|location|address|how it works|process|what (our )?(clients|customers|patients|guests) say)$/i;
/** Headings phrased as questions or pitches ("Why ...", "How ...") are not offering names. */
const QUESTION_HEADING = /^(why|how|what|who|when|where|which|are|is|do|does|can)\b/i;

/** Text that is only a section title ("Our Services", "Menu"), not an offering's name. */
const SECTION_TITLE_ONLY =
  /^(?:(?:our|all|view|see|browse|explore|featured)\s+)?(?:services|products|solutions|treatments|specialties|specialities|procedures|amenities|collections?|catalog(?:ue)?|range|menus?|rooms|suites|accommodations?|listings|properties|shop|store|capabilities|expertise|practice areas|what we do|what we offer)$/i;

function isOfferingText(text: string) {
  if (text.length < 2 || text.length > 80) return false;
  if (text.split(/\s+/).length > 10) return false;
  if (/[?!:]$/.test(text) || /@|https?:|www\./i.test(text)) return false;
  if (!/\p{L}/u.test(text)) return false;
  return (
    !GENERIC_HEADING.test(text) && !QUESTION_HEADING.test(text) && !SECTION_TITLE_ONLY.test(text)
  );
}

type SectionKind = "service" | "product" | "service_area";

/**
 * Walks the page's own main content (not navigation, banners or third-party content): headings
 * and list items inside an "Our services"-like section.
 */
function sectionItems(blocks: TextBlock[], pageType: PageType) {
  const items: {
    kind: SectionKind;
    block: TextBlock;
    via: "section-heading" | "section-list-item";
  }[] = [];
  let section: { kind: SectionKind; level: number } | null = null;
  let sawSection = false;
  for (const block of blocks) {
    if (block.region !== "main" || block.context !== "site") continue;
    if (block.level) {
      if (section && block.level <= section.level) section = null;
      // A heading nested inside an open section is one of its items ("Emergency Services"
      // under "Our Services"), even if it contains a section word itself.
      if (section && block.level > section.level) {
        items.push({ kind: section.kind, block, via: "section-heading" });
        continue;
      }
      const kind: SectionKind | null = AREA_SECTION.test(block.text)
        ? "service_area"
        : SERVICE_SECTION.test(block.text)
          ? "service"
          : PRODUCT_SECTION.test(block.text)
            ? "product"
            : null;
      if (kind && block.text.split(/\s+/).length <= 6 && !QUESTION_HEADING.test(block.text)) {
        section = { kind, level: block.level };
        sawSection = true;
      }
    } else if (section && block.tag === "li") {
      items.push({ kind: section.kind, block, via: "section-list-item" });
    }
  }
  // A services or products page without an explicit section: its sub-headings are the offerings.
  if (!sawSection && (pageType === "services" || pageType === "products")) {
    const kind: SectionKind = pageType === "services" ? "service" : "product";
    for (const block of blocks) {
      if (
        block.region === "main" &&
        block.context === "site" &&
        (block.level === 2 || block.level === 3)
      ) {
        items.push({ kind, block, via: "section-heading" });
      }
    }
  }
  return items;
}

export function extractOfferings(pages: ParsedPage[], c: FindingCollector) {
  for (const page of pages) {
    for (const entity of page.jsonLd) {
      if (viaExcludedRelation(entity)) continue;
      const name = entity.props.name;
      const isService = entity.types.some((t) => SERVICE_TYPES.has(t));
      const isProduct = entity.types.some((t) => PRODUCT_TYPES.has(t));
      if (name && (isService || isProduct)) {
        const category = isProduct ? "product" : "service";
        const details: Record<string, string> = { schemaType: entity.types.join(", ") };
        if (entity.props.description) details.description = entity.props.description;
        if (entity.props.category) details.category = entity.props.category;
        c.add(page, {
          category,
          kind: "fact",
          key: `${category}:${slug(name)}`,
          value: name,
          details,
          quote: `name: ${name}`,
          method: "json-ld",
        });
      }
      // Offers whose item has no typed entity of its own: "itemOffered.name: ...". The item's
      // kind is only known if its @type says so; otherwise it is a candidate on a services or
      // products page, and ignored elsewhere.
      if (entity.types.includes("Offer") && entity.props["itemOffered.name"]) {
        const itemName = entity.props["itemOffered.name"];
        const itemTypes = (entity.props["itemOffered.@type"] ?? "").split(", ");
        const typed = itemTypes.some((t) => PRODUCT_TYPES.has(t))
          ? "product"
          : itemTypes.some((t) => SERVICE_TYPES.has(t))
            ? "service"
            : null;
        const category =
          typed ??
          (page.pageType === "products"
            ? "product"
            : page.pageType === "services"
              ? "service"
              : null);
        if (category) {
          c.add(page, {
            category,
            kind: typed ? "fact" : "candidate",
            key: `${category}:${slug(itemName)}`,
            value: itemName,
            quote: `itemOffered.name: ${itemName}`,
            method: "json-ld",
          });
        }
      }
    }

    for (const { kind, block, via } of sectionItems(page.blocks, page.pageType)) {
      if (kind === "service_area" || !isOfferingText(block.text)) continue;
      c.add(page, {
        category: kind,
        kind: "candidate",
        key: `${kind}:${slug(block.text)}`,
        value: block.text,
        quote: block.text,
        method: via,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Contact: emails, phones, contact page
// ---------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]{1,64}@(?:[A-Z0-9-]{1,63}\.)+[A-Z]{2,24}/gi;
const PLACEHOLDER_EMAIL_DOMAIN =
  /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|yourcompany\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com)$/i;
const LABELLED_PHONE =
  /\b(?:phone|tel|telephone|call(?: us)?(?: now| today)?|mobile|cell|whatsapp|office|hotline|reservations?|bookings?|contact number|ph)\b\.?\s*(?:number|no\.?)?\s*[:.\-–]?\s*(\+?\(?\d[\d\s().\-–/]{5,22}\d)/gi;
const INTERNATIONAL_PHONE = /(?<![\d+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;

export function validEmail(address: string) {
  const a = address.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/.test(a)) return null;
  const domain = a.slice(a.indexOf("@") + 1);
  if (PLACEHOLDER_EMAIL_DOMAIN.test(domain)) return null;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(a) || /@\dx\./.test(a)) return null;
  return a;
}

/** Digits with an optional leading +, when it has a plausible phone length (7-15 digits). */
export function phoneDigits(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (value.trim().startsWith("+") ? "+" : "") + digits;
}

/**
 * Dates and year ranges written like numbers ("2024-2025", "12/05/2024", "2024-11-04"), which
 * would otherwise pass as 7-15 digit phone numbers.
 */
export function isDateLike(value: string) {
  const v = value.trim();
  return (
    /^(19|20)\d{2}\s*[-–/.]\s*((19|20)\d{2}|\d{2})$/.test(v) ||
    /^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(\d{4}|\d{2})$/.test(v) ||
    /^(19|20)\d{2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}$/.test(v)
  );
}

/**
 * De-duplication key for a phone number: its last 9 digits, so "+1 (512) 555-0142",
 * "(512) 555-0142" and "tel:+15125550142" on one website are the same number.
 */
export function phoneKey(digits: string) {
  return `phone:${digits.replace(/\D/g, "").slice(-9)}`;
}

// The business's own email/telephone, or its contactPoint's; never a nested employee, founder,
// manufacturer or other entity flattened into its properties.
const OWN_EMAIL = /^(?:contactPoint(?:\[\d+\])?\.)?email(?:\[\d+\])?$/;
const OWN_PHONE = /^(?:contactPoint(?:\[\d+\])?\.)?telephone(?:\[\d+\])?$/;

export function extractContact(pages: ParsedPage[], c: FindingCollector) {
  const home = new URL(pages[0].url);
  for (const page of pages) {
    for (const link of page.links) {
      // Contact links inside testimonials, reviews or post lists belong to someone else.
      const kind = link.context === "site" ? "fact" : "candidate";
      if (link.href.startsWith("mailto:")) {
        const target = link.href.split("?")[0];
        let decoded = target.slice(7);
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          // keep the raw form
        }
        for (const part of decoded.split(",")) {
          const email = validEmail(part);
          if (email)
            c.add(page, {
              category: "contact_email",
              kind,
              key: `email:${email}`,
              value: email,
              quote: target,
              method: "mailto-link",
            });
        }
      } else if (link.href.startsWith("tel:")) {
        let raw = link.href.slice(4);
        try {
          raw = decodeURIComponent(raw);
        } catch {
          // keep the raw form
        }
        const digits = phoneDigits(raw);
        if (!digits) continue;
        c.add(page, {
          category: "contact_phone",
          kind,
          key: phoneKey(digits),
          value: raw.trim(),
          supportParts: [digits],
          quote: link.href,
          method: "tel-link",
        });
      } else if (link.context === "site") {
        try {
          const url = new URL(link.href);
          if (sameSite(url, home) && classifyPage(url, link.text) === "contact") {
            c.add(page, {
              category: "contact_page",
              kind: "fact",
              key: `contact_page:${slug(url.pathname)}`,
              value: link.href,
              quote: link.href,
              method: "site-link",
            });
          }
        } catch {
          // not a URL
        }
      }
    }

    if (page.pageType === "contact") {
      c.add(page, {
        category: "contact_page",
        kind: "fact",
        key: `contact_page:${slug(new URL(page.url).pathname)}`,
        value: page.url,
        quote: `URL: ${page.url}`,
        method: "page-url",
      });
    }

    for (const block of page.blocks) {
      if (block.region === "nav") continue;
      const kind = block.context === "site" ? "fact" : "candidate";
      for (const match of block.text.matchAll(EMAIL)) {
        const email = validEmail(match[0]);
        if (email)
          c.add(page, {
            category: "contact_email",
            kind,
            key: `email:${email}`,
            value: email,
            quote: match[0],
            method: "page-text",
          });
      }
      for (const match of block.text.matchAll(LABELLED_PHONE)) {
        const number = match[1].trim();
        const digits = phoneDigits(number);
        if (digits && !isDateLike(number))
          c.add(page, {
            category: "contact_phone",
            kind,
            key: phoneKey(digits),
            value: number,
            quote: match[0],
            method: "labelled-text",
          });
      }
      for (const match of block.text.matchAll(INTERNATIONAL_PHONE)) {
        const number = match[0].trim();
        const digits = phoneDigits(number);
        if (digits && !isDateLike(number))
          c.add(page, {
            category: "contact_phone",
            kind: "candidate",
            key: phoneKey(digits),
            value: number,
            quote: match[0],
            method: "page-text",
          });
      }
    }

    // Structured contact details: only the business's own (never a person's, a manufacturer's
    // or a seller's).
    for (const entity of primaryBusinessEntities(page)) {
      for (const [path, value] of propsMatching(entity, OWN_EMAIL)) {
        const email = validEmail(value.replace(/^mailto:/i, ""));
        if (email)
          c.add(page, {
            category: "contact_email",
            kind: "fact",
            key: `email:${email}`,
            value: email,
            quote: `${path}: ${value}`,
            method: "json-ld",
          });
      }
      for (const [path, value] of propsMatching(entity, OWN_PHONE)) {
        const digits = phoneDigits(value);
        if (digits)
          c.add(page, {
            category: "contact_phone",
            kind: "fact",
            key: phoneKey(digits),
            value,
            quote: `${path}: ${value}`,
            method: "json-ld",
          });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Location: address, city/country, service areas
// ---------------------------------------------------------------------------

const ADDRESS_PARTS = [
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
] as const;
type AddressPart = (typeof ADDRESS_PARTS)[number];

/**
 * De-duplication key for an address: its first line (street), so the same address given in
 * JSON-LD and in an <address> element is one finding.
 */
function addressKey(address: string) {
  return `address:${slug(address.split(",")[0])}`;
}

/** Address prefixes present in an entity's props: "address.", "address[0].", or "". */
function addressPrefixes(entity: { props: Record<string, string>; types: string[] }) {
  if (entity.types.includes("PostalAddress")) return [""];
  const prefixes = new Set<string>();
  for (const path of Object.keys(entity.props)) {
    const m =
      /^(address(?:\[\d+\])?)\.(streetAddress|addressLocality|addressRegion|postalCode|addressCountry)/.exec(
        path,
      );
    if (m) prefixes.add(`${m[1]}.`);
  }
  return [...prefixes];
}

export function extractLocation(pages: ParsedPage[], c: FindingCollector) {
  for (const page of pages) {
    const business = primaryBusinessEntities(page);
    // Stand-alone PostalAddress objects count only at the top level of the page's JSON-LD.
    const postal = page.jsonLd.filter((e) => e.topLevel && e.types.includes("PostalAddress"));

    for (const entity of [...business, ...postal]) {
      for (const prefix of addressPrefixes(entity)) {
        const parts: { name: AddressPart; path: string; value: string }[] = [];
        for (const name of ADDRESS_PARTS) {
          const path =
            name === "addressCountry" && entity.props[`${prefix}addressCountry.name`]
              ? `${prefix}addressCountry.name`
              : `${prefix}${name}`;
          const value = entity.props[path];
          if (value) parts.push({ name, path, value });
        }
        if (parts.length === 0) continue;

        // Every component is quoted (one evidence line each) and must be supported, so the
        // combined address never claims a part the page does not state.
        const lines = parts.map((p) => `${p.path}: ${p.value}`);
        const anchor = parts.findIndex((p) => p.name === "streetAddress");
        const value = parts.map((p) => p.value).join(", ");
        c.add(page, {
          category: "contact_address",
          kind: "fact",
          key: addressKey(value),
          value,
          supportParts: parts.map((p) => p.value),
          details: Object.fromEntries(parts.map((p) => [p.name, p.value])),
          quote: lines[anchor >= 0 ? anchor : 0],
          evidence: lines.filter((_, i) => i !== (anchor >= 0 ? anchor : 0)),
          method: "json-ld",
        });

        const place = parts.filter((p) =>
          ["addressLocality", "addressRegion", "addressCountry"].includes(p.name),
        );
        if (place.length > 0) {
          const placeLines = place.map((p) => `${p.path}: ${p.value}`);
          const placeValue = place.map((p) => p.value).join(", ");
          c.add(page, {
            category: "location",
            kind: "fact",
            key: `location:${slug(placeValue)}`,
            value: placeValue,
            supportParts: place.map((p) => p.value),
            details: Object.fromEntries(place.map((p) => [p.name, p.value])),
            quote: placeLines[0],
            evidence: placeLines.slice(1),
            method: "json-ld",
          });
        }
      }
    }

    for (const entity of business) {
      if (entity.props.address) {
        const value = entity.props.address;
        c.add(page, {
          category: "contact_address",
          kind: "fact",
          key: addressKey(value),
          value,
          quote: `address: ${value}`,
          method: "json-ld",
        });
      }
      for (const [path, value] of propsMatching(
        entity,
        /^(areaServed|serviceArea)(\[\d+\])?(\.name)?$/,
      )) {
        c.add(page, {
          category: "service_area",
          kind: "fact",
          key: `area:${slug(value)}`,
          value,
          quote: `${path}: ${value}`,
          method: "json-ld",
        });
      }
    }

    for (const block of page.blocks) {
      // An <address> inside a testimonial, review or post list is someone else's.
      if (block.tag === "address" && block.context === "site" && block.text.length >= 8) {
        const value = clip(block.text, 300);
        c.add(page, {
          category: "contact_address",
          kind: "fact",
          key: addressKey(value),
          value,
          quote: block.text,
          method: "address-element",
        });
      }
    }

    for (const { kind, block } of sectionItems(page.blocks, page.pageType)) {
      if (kind !== "service_area") continue;
      const text = block.text;
      if (
        text.length < 2 ||
        text.length > 60 ||
        text.split(/\s+/).length > 6 ||
        GENERIC_HEADING.test(text) ||
        QUESTION_HEADING.test(text)
      )
        continue;
      c.add(page, {
        category: "service_area",
        kind: "candidate",
        key: `area:${slug(text)}`,
        value: text,
        quote: text,
        method: "section-list-item",
      });
    }

    if (page.pageType === "locations") {
      for (const block of page.blocks) {
        if (
          block.region === "main" &&
          block.context === "site" &&
          (block.level === 2 || block.level === 3) &&
          block.text.length <= 80 &&
          !GENERIC_HEADING.test(block.text) &&
          !QUESTION_HEADING.test(block.text) &&
          !AREA_SECTION.test(block.text)
        ) {
          c.add(page, {
            category: "location",
            kind: "candidate",
            key: `location:${slug(block.text)}`,
            value: block.text,
            quote: block.text,
            method: "section-heading",
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Social profiles linked from the company's own website (never fetched)
// ---------------------------------------------------------------------------

type PlatformRule = {
  platform: string;
  hosts: RegExp;
  /** The whole path of a profile (not a post, video or share page); group 1 = identifier. */
  profile: RegExp;
  reserved?: Set<string>;
};

const reserved = (...words: string[]) => new Set(words);

const PLATFORMS: PlatformRule[] = [
  {
    platform: "facebook",
    hosts: /(^|\.)(facebook\.com|fb\.com)$/,
    profile: /^\/(pages\/[^/]{1,100}\/\d{5,20}|[A-Za-z0-9.-]{2,80})\/?$/,
    reserved: reserved(
      "watch",
      "events",
      "groups",
      "marketplace",
      "gaming",
      "help",
      "policies",
      "privacy",
      "ads",
      "business",
      "reel",
      "reels",
      "stories",
      "photos",
      "videos",
      "posts",
      "search",
      "people",
      "pages",
      "sharer",
      "share",
      "plugins",
      "dialog",
      "hashtag",
      "login",
      "home",
      "profile.php",
      "photo.php",
      "permalink.php",
      "story.php",
      "sharer.php",
      "share.php",
      "login.php",
      "home.php",
    ),
  },
  {
    platform: "instagram",
    hosts: /(^|\.)instagram\.com$/,
    profile: /^\/([A-Za-z0-9._]{1,30})\/?$/,
    reserved: reserved(
      "p",
      "reel",
      "reels",
      "tv",
      "stories",
      "explore",
      "accounts",
      "direct",
      "about",
      "developer",
      "legal",
      "web",
    ),
  },
  {
    platform: "linkedin",
    hosts: /(^|\.)linkedin\.com$/,
    profile: /^\/((?:company|school|showcase)\/[^/]{1,100})\/?$/,
  },
  {
    platform: "x",
    hosts: /(^|\.)(x\.com|twitter\.com)$/,
    profile: /^\/([A-Za-z0-9_]{1,15})\/?$/,
    reserved: reserved(
      "intent",
      "share",
      "home",
      "search",
      "hashtag",
      "i",
      "explore",
      "settings",
      "login",
      "signup",
      "tos",
      "privacy",
      "notifications",
      "messages",
    ),
  },
  {
    platform: "youtube",
    hosts: /(^|\.)youtube\.com$/,
    profile:
      /^\/(@[A-Za-z0-9._-]{3,30}|channel\/UC[A-Za-z0-9_-]{20,24}|c\/[^/]{1,100}|user\/[^/]{1,100})\/?$/,
  },
  {
    platform: "tiktok",
    hosts: /(^|\.)tiktok\.com$/,
    profile: /^\/(@[A-Za-z0-9._]{2,24})\/?$/,
  },
  {
    platform: "pinterest",
    hosts: /(^|\.)pinterest\.[a-z.]+$/,
    profile: /^\/([A-Za-z0-9_]{3,30})\/?$/,
    reserved: reserved(
      "pin",
      "search",
      "ideas",
      "today",
      "explore",
      "business",
      "login",
      "settings",
      "about",
    ),
  },
  {
    platform: "threads",
    hosts: /(^|\.)threads\.net$/,
    profile: /^\/(@[A-Za-z0-9._]{1,30})\/?$/,
  },
  { platform: "yelp", hosts: /(^|\.)yelp\.[a-z.]+$/, profile: /^\/(biz\/[^/]{1,150})\/?$/ },
  {
    platform: "tripadvisor",
    hosts: /(^|\.)tripadvisor\.[a-z.]+$/,
    profile: /^\/((?:Restaurant|Hotel|Attraction|VacationRental)_Review-[^/]{1,200}\.html)$/,
  },
  { platform: "whatsapp", hosts: /^wa\.me$/, profile: /^\/(\d{7,15})\/?$/ },
  {
    platform: "telegram",
    hosts: /^t\.me$/,
    profile: /^\/([A-Za-z0-9_]{5,32})\/?$/,
    reserved: reserved("joinchat", "share", "addstickers", "proxy", "login"),
  },
];

/** Redirect wrappers and link shorteners hide the real target; never a profile. */
const WRAPPER_HOSTS = /^(l|lm)\.facebook\.com$|^t\.co$|^youtu\.be$/;

/**
 * An official profile URL on a known platform, or null. Only profile pages qualify (a page,
 * account, channel or business listing): individual posts, videos, reels, tweets, share links
 * and personal LinkedIn profiles do not.
 */
export function socialProfile(href: string) {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (WRAPPER_HOSTS.test(host)) return null;
  const rule = PLATFORMS.find((p) => p.hosts.test(host));
  if (!rule) return null;
  const match = rule.profile.exec(url.pathname);
  if (!match) return null;
  const id = match[1];
  if (rule.reserved?.has(id.toLowerCase())) return null;
  const canonicalHost = host.replace(/^(www|m|mobile)\./, "");
  const canonical = `https://${canonicalHost}${url.pathname.replace(/\/+$/, "")}`;
  return { platform: rule.platform, canonical, host: canonicalHost, id };
}

/** Regions where a site puts its own profile links (header, footer, navigation, sidebar). */
const SITE_CHROME = new Set(["header", "footer", "nav", "aside"]);
const PROFILE_PAGES = new Set<PageType>(["home", "about", "contact"]);

export function extractSocial(pages: ParsedPage[], c: FindingCollector) {
  for (const page of pages) {
    const candidates = [
      // The site's own links: in its header/footer/navigation, or on its home, about or contact
      // page — never inside testimonials, reviews or post lists.
      ...page.links
        .filter(
          (l) =>
            l.context === "site" && (SITE_CHROME.has(l.region) || PROFILE_PAGES.has(page.pageType)),
        )
        .map((l) => ({ href: l.href, quote: l.href, method: "site-link" as const })),
      // sameAs of the business itself (never of a person, manufacturer or seller).
      ...primaryBusinessEntities(page).flatMap((e) =>
        propsMatching(e, /^sameAs(\[\d+\])?$/).map(([path, value]) => ({
          href: value,
          quote: `${path}: ${value}`,
          method: "json-ld" as const,
        })),
      ),
    ];
    for (const { href, quote, method } of candidates) {
      const profile = socialProfile(href);
      if (!profile) continue;
      c.add(page, {
        category: "social_profile",
        kind: "fact",
        key: `social:${profile.platform}:${slug(profile.canonical.replace(/^https:\/\//, ""))}`,
        value: profile.canonical,
        supportParts: [profile.host, profile.id],
        details: { platform: profile.platform },
        quote,
        method,
      });
    }
  }
}
