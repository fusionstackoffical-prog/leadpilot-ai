/**
 * Hosts that are never a company's OWN website: social networks, messaging links, review
 * listings, search engines and map pages. Research reads a company's own website only, so a lead
 * whose website value is one of these is refused up front (dashboard) and again at the start of the
 * crawl (`startUrl`).
 *
 * Pure string logic: no DNS, no network, no Node imports (safe for any module to import).
 *
 * MATCHING RULE. The hostname is lowercased (the URL parser does that) and a trailing dot is
 * dropped. A host matches a listed domain only when it IS that domain or ends with "." + that
 * domain, compared label by label. So `m.facebook.com` and `business.facebook.com` match
 * `facebook.com`, while `notfacebook.com`, `facebook.com.example.org` and `box.com` (vs `x.com`)
 * do not: the listed domain must be the whole registrable tail of the host.
 *
 * BRAND FAMILIES (google, yandex, pinterest, yelp, tripadvisor) exist on many country domains.
 * `<brand>.<suffix>` matches only when the suffix is `com`, a two-letter country code (`de`) or
 * a `com|co|org|net|ac` + two-letter pair (`co.uk`, `com.au`). `google.evil`, `mygoogle.com` and
 * `google.com.evil.org` therefore do not match. Google is further limited to its search and maps
 * hosts (bare, www, m, maps, ...), so `sites.google.com` (a real way to host a company website)
 * stays allowed.
 */

export type NonCompanyKind = "social" | "listing" | "search" | "map";
export type NonCompanyMatch = { kind: NonCompanyKind; domain: string };

const FIXED: ReadonlyArray<readonly [NonCompanyKind, readonly string[]]> = [
  [
    "social",
    [
      "facebook.com",
      "fb.com",
      "fb.me",
      "fb.watch",
      "m.me",
      "messenger.com",
      "instagram.com",
      "instagr.am",
      "linkedin.com",
      "lnkd.in",
      "twitter.com",
      "x.com",
      "t.co",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "pin.it",
      "threads.net",
      "threads.com",
      "snapchat.com",
      "reddit.com",
      "redd.it",
      "wa.me",
      "whatsapp.com",
      "t.me",
      "telegram.me",
    ],
  ],
  [
    "search",
    [
      "bing.com",
      "duckduckgo.com",
      "search.yahoo.com",
      "baidu.com",
      "ecosia.org",
      "startpage.com",
      "qwant.com",
      "search.brave.com",
      "ask.com",
    ],
  ],
  [
    "map",
    [
      "maps.app.goo.gl",
      "g.page",
      "g.co",
      "maps.apple.com",
      "openstreetmap.org",
      "waze.com",
      "mapquest.com",
    ],
  ],
];

/** Brands that live on many country domains: matched as `<brand>.<suffix>`. */
const FAMILIES: ReadonlyArray<{
  brand: string;
  kind: NonCompanyKind;
  subdomains?: ReadonlySet<string>;
}> = [
  {
    brand: "google",
    kind: "search",
    // Search and maps surfaces only. `sites.google.<tld>` (Google Sites) is a legitimate company website.
    subdomains: new Set([
      "",
      "www",
      "m",
      "maps",
      "encrypted",
      "images",
      "news",
      "scholar",
      "shopping",
      "books",
      "business",
      "local",
    ]),
  },
  { brand: "yandex", kind: "search" },
  { brand: "pinterest", kind: "social" },
  { brand: "yelp", kind: "listing" },
  { brand: "tripadvisor", kind: "listing" },
];

const COUNTRY_CODE = /^[a-z]{2}$/;
const SECOND_LEVEL = new Set(["com", "co", "org", "net", "ac"]);

/** Number of trailing labels that form a valid brand suffix, or 0. */
function suffixLength(labels: readonly string[]): number {
  const last = labels[labels.length - 1];
  const prev = labels[labels.length - 2];
  if (last === "com") return 1;
  if (!COUNTRY_CODE.test(last ?? "")) return 0;
  return prev !== undefined && SECOND_LEVEL.has(prev) ? 2 : 1;
}

function matchesDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Returns what kind of non-company page the URL is, or null when it may be a company website. */
export function nonCompanySite(url: URL): NonCompanyMatch | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  for (const [kind, domains] of FIXED) {
    for (const domain of domains) {
      if (matchesDomain(host, domain)) return { kind, domain };
    }
  }

  // goo.gl is also used by ordinary short links, so only its maps links are refused.
  if (matchesDomain(host, "goo.gl") && /^\/maps(\/|$)/i.test(url.pathname)) {
    return { kind: "map", domain: "goo.gl/maps" };
  }

  const labels = host.split(".");
  for (const family of FAMILIES) {
    for (const length of [1, 2]) {
      const tail = labels.slice(labels.length - length);
      const brandAt = labels.length - length - 1;
      if (brandAt < 0 || labels[brandAt] !== family.brand) continue;
      if (suffixLength(labels) !== length || tail.length !== length) continue;
      const subdomains = labels.slice(0, brandAt).join(".");
      if (family.subdomains && !family.subdomains.has(subdomains)) continue;
      return { kind: family.kind, domain: `${family.brand}.${tail.join(".")}` };
    }
  }
  return null;
}

/** Every fixed domain, for documentation and tests. Brand families are matched by rule, not listed. */
export const NON_COMPANY_DOMAINS: readonly string[] = FIXED.flatMap(([, domains]) => domains);
