import type { PageLink, PageType } from "./types.ts";

type CrawlType = Exclude<PageType, "home">;

/**
 * Industry-neutral page types, recognised from the link's path and text. The keywords describe
 * kinds of pages that most businesses have (about, what they offer, contact, where they are),
 * not any particular industry's services. Checked in order; the specific phrases come first so
 * that, e.g., "customer-service" is a contact page and "store-locator" a locations page.
 */
const PAGE_PATTERNS: [CrawlType, RegExp][] = [
  ["contact", /\b(customer-(?:service|support|care)|help-centre|help-center)\b/],
  [
    "locations",
    /\b(store-locator|store-finder|find-a-store|find-a-location|find-us|our-stores|stores)\b/,
  ],
  ["contact", /\b(contact|contact-us|contactus|get-in-touch|reach-us|visit-us)\b/],
  [
    "about",
    /\b(about|about-us|aboutus|who-we-are|our-story|our-company|company|our-practice|why-us)\b/,
  ],
  [
    "services",
    /\b(services?|what-we-do|what-we-offer|solutions|treatments?|specialt(?:y|ies)|practice-areas?|expertise|capabilities|procedures)\b/,
  ],
  [
    "products",
    /\b(products?|shop|store|collections?|catalog|catalogue|menus?|rooms?|suites|accommodations?|listings?|properties)\b/,
  ],
  ["locations", /\b(locations?|service-areas?|areas-we-serve|where-we-work|branches|offices)\b/],
];

/** Round-robin order when choosing pages. */
const TYPE_ORDER: CrawlType[] = ["contact", "about", "services", "products", "locations"];

/** Files and app pages that are never business content. */
const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|bmp|tiff?|mp[34]|mov|avi|webm|wav|zip|rar|7z|gz|tar|exe|dmg|apk|docx?|xlsx?|pptx?|csv|ics|vcf|xml|json|txt|css|js|woff2?|ttf|eot)$/i;
const SKIP_SEGMENTS =
  /^(login|log-in|signin|sign-in|signup|sign-up|register|account|my-account|cart|basket|checkout|wp-admin|wp-login\.php|admin|search|feed|rss|tag|tags|author|privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|cookie-policy|cookies|legal|sitemap|cdn-cgi)$/i;
const SKIP_QUERY = /(session|token|sid=|replytocom|add-to-cart|redirect|return_url)/i;

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** Same site: identical host, ignoring a leading "www.". Subdomains and other sites are not. */
export function sameSite(a: URL, b: URL) {
  return stripWww(a.hostname) === stripWww(b.hostname);
}

/**
 * The research boundary: the supplied domain (with or without "www.") and its subdomains.
 * "shop.acme.com" is inside the boundary of "acme.com"; "acme.co.uk" and "instagram.com" are not.
 */
export function withinBoundary(url: URL, base: URL) {
  const host = stripWww(url.hostname);
  const root = stripWww(base.hostname);
  return host === root || host.endsWith(`.${root}`);
}

/** A normalized internal URL worth fetching, or null. */
export function crawlableUrl(href: string, home: URL): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!sameSite(url, home)) return null;
  if (SKIP_EXTENSIONS.test(url.pathname)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.some((s) => SKIP_SEGMENTS.test(s))) return null;
  if (segments.length > 4) return null;
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
  if (url.search.length > 80 || SKIP_QUERY.test(url.search)) return null;
  url.hash = "";
  return url;
}

export function classifyPage(url: URL, linkText: string): CrawlType | null {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed %-escape: classify the raw path instead.
  }
  const hay = `${path.toLowerCase()} ${linkText.toLowerCase().replace(/\s+/g, "-")}`;
  for (const [type, pattern] of PAGE_PATTERNS) if (pattern.test(hay)) return type;
  return null;
}

const key = (u: URL) => `${stripWww(u.hostname)}${u.pathname.replace(/\/+$/, "")}${u.search}`;

/**
 * Chooses which internal pages to fetch after the home page: at most `maxPages - 1`, at most
 * `maxPerType` of each type, picked round-robin across types (so a site with many product links
 * still gets its about and contact pages), preferring shallow paths.
 */
export function selectPages(
  links: PageLink[],
  home: URL,
  { maxPages, maxPerType }: { maxPages: number; maxPerType: number },
) {
  const seen = new Set([key(home)]);
  const byType = new Map<CrawlType, { url: URL; depth: number; order: number }[]>();
  links.forEach((link, order) => {
    const url = crawlableUrl(link.href, home);
    if (!url || seen.has(key(url))) return;
    const type = classifyPage(url, link.text);
    if (!type) return;
    seen.add(key(url));
    const list = byType.get(type) ?? [];
    list.push({ url, depth: url.pathname.split("/").filter(Boolean).length, order });
    byType.set(type, list);
  });
  for (const list of byType.values()) list.sort((a, b) => a.depth - b.depth || a.order - b.order);

  const picked: { url: URL; type: CrawlType }[] = [];
  for (let round = 0; round < maxPerType; round++) {
    for (const type of TYPE_ORDER) {
      if (picked.length >= maxPages - 1) return picked;
      const next = byType.get(type)?.[round];
      if (next) picked.push({ url: next.url, type });
    }
  }
  return picked;
}
