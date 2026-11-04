// Phase 3B.1 regression tests: one or more per issue found in the Phase 3B code review.
// Fake HTML, fake DNS and the in-memory HTTP fakes only; no real network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FETCH_LIMITS } from "../../src/features/research/engine/config.ts";
import { crawlCompanyWebsite } from "../../src/features/research/engine/extract/crawl.ts";
import { ExtractionError } from "../../src/features/research/engine/extract/errors.ts";
import { verifyQuote } from "../../src/features/research/engine/extract/evidence.ts";
import { extractFromPages } from "../../src/features/research/engine/extract/extract.ts";
import {
  compareNames,
  isDateLike,
  socialProfile,
} from "../../src/features/research/engine/extract/extractors.ts";
import { FindingCollector } from "../../src/features/research/engine/extract/findings.ts";
import { MAX_NODES } from "../../src/features/research/engine/extract/html.ts";
import { classifyPage } from "../../src/features/research/engine/extract/pages.ts";
import { buildCompletionPayload } from "../../src/features/research/engine/extract/payload.ts";
import {
  clip,
  clipCodePoints,
  normalizeText,
  quoteIn,
} from "../../src/features/research/engine/extract/text.ts";
import type {
  ExtractedFinding,
  ExtractionResult,
  ExtractionWarning,
} from "../../src/features/research/engine/extract/types.ts";
import {
  describeFailure,
  ResearchFetchError,
  statusError,
} from "../../src/features/research/engine/net/errors.ts";
import { createResearchFetcher } from "../../src/features/research/engine/net/fetcher.ts";
import type { SafeFetchResult } from "../../src/features/research/engine/net/safe-fetch.ts";
import { pageOf, RETRIEVED_AT } from "./extract-fixtures.ts";
import {
  fakeClock,
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  PUBLIC_V4_B,
  UA,
  type FakeRoute,
} from "./net-fakes.ts";

const SITE = "https://acme-co.com/";
const ld = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const pick = (r: ExtractionResult, category: ExtractedFinding["category"], kind?: string) =>
  r.findings
    .filter((f) => f.category === category && (!kind || f.kind === kind))
    .map((f) => f.value);

/** Every string anywhere in a value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

function fetcherFor(routes: Record<string, FakeRoute>, dnsTable: Record<string, string[]>) {
  const dns = fakeResolver(dnsTable);
  const net = fakeTransport(routes);
  const fetcher = createResearchFetcher({
    config: {
      ...DEFAULT_FETCH_LIMITS,
      contactUrl: "https://leadpilot.example.com/bot",
      userAgent: UA,
    },
    resolver: dns.resolver,
    transport: net.transport,
    clock: fakeClock().clock,
  });
  return { fetcher, net, dns };
}
const robotsAllowAll: FakeRoute = {
  body: "User-agent: *\nAllow: /\n",
  headers: { "content-type": "text/plain" },
};
const now = () => new Date(RETRIEVED_AT);

// ---------------------------------------------------------------------------
describe("M1: Unicode-safe truncation", () => {
  it("never splits a surrogate pair", () => {
    const s = `${"a".repeat(9)}😀`;
    assert.equal(clip(s, 10), "a".repeat(9));
    assert.equal(clip(s, 11), s);
    assert.ok(clip(s, 10).isWellFormed());
    assert.equal(clipCodePoints("😀𠜎𝒜x", 3), "😀𠜎𝒜");
    assert.equal(clipCodePoints("short", 10), "short");
  });

  it("repairs unpaired surrogates in source text", () => {
    assert.equal(normalizeText("x\ud83dy"), "x�y");
    assert.ok(normalizeText("\udc00 tail").isWellFormed());
  });

  it("a JSON-LD description cut mid-emoji yields a well-formed fact and payload", () => {
    // Reproduces the review: 2,000-character cut landing between the halves of an emoji.
    const description = `${"We are a family business. ".repeat(76)}${"x".repeat(23)}😀 and more`;
    const page = pageOf(
      ld({ "@type": "LocalBusiness", name: "Acme", url: SITE, description }),
      SITE,
    );
    const r = extractFromPages([page]);
    const fact = r.findings.find((f) => f.category === "business_description");
    assert.ok(fact, "description kept");
    assert.ok(fact.value.isWellFormed());
    const { payload } = buildCompletionPayload([page], r);
    const all = strings(payload);
    assert.ok(all.every((s) => s.isWellFormed()));
    assert.ok(!/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(JSON.stringify(payload)));
  });

  it("lone surrogate escapes in JSON-LD become U+FFFD", () => {
    const page = pageOf(
      `<script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme \\ud83d Co","url":"${SITE}"}</script>`,
      SITE,
    );
    assert.equal(page.jsonLd[0].props.name, "Acme � Co");
    const r = extractFromPages([page]);
    assert.ok(strings(buildCompletionPayload([page], r).payload).every((s) => s.isWellFormed()));
  });

  it("long blocks, titles and addresses with supplementary characters at the cut stay valid", () => {
    const html = `<title>${"t".repeat(499)}😀 Acme</title><main><p>${"p".repeat(1_999)}𠜎 rest</p>
      <address>${"a".repeat(1_999)}𝒜 Street 1</address></main><footer>${"f".repeat(299)}<a href="${SITE}contact">${"c".repeat(299)}😀</a></footer>`;
    const page = pageOf(html, SITE);
    const r = extractFromPages([page]);
    const { payload, uploads } = buildCompletionPayload([page], r);
    for (const s of [...strings(page), ...strings(r), ...strings(payload)])
      assert.ok(s.isWellFormed());
    assert.ok(uploads.length === 1);
  });
});

// ---------------------------------------------------------------------------
describe("M2: the business entity and privacy", () => {
  it("does not take a product's manufacturer or seller for the company", () => {
    const page = pageOf(
      ld({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Smart TV X1",
        manufacturer: {
          "@type": "Organization",
          name: "MegaCorp Electronics",
          url: "https://megacorp.example",
          address: {
            "@type": "PostalAddress",
            streetAddress: "1 Industrial Way",
            addressLocality: "Osaka",
            addressCountry: "JP",
          },
          telephone: "+81 6 1234 5678",
        },
        offers: {
          "@type": "Offer",
          seller: {
            "@type": "Organization",
            name: "Some Marketplace",
            url: "https://market.example",
          },
        },
      }),
      SITE,
    );
    const r = extractFromPages([page]);
    assert.deepEqual(pick(r, "company_name", "fact"), []);
    assert.deepEqual(pick(r, "contact_phone"), []);
    assert.deepEqual(pick(r, "contact_address"), []);
    assert.deepEqual(pick(r, "location"), []);
    assert.deepEqual(pick(r, "product", "fact"), ["Smart TV X1"]); // the product itself is still kept
  });

  it("never attributes a person's phone, email or social accounts to the company", () => {
    const person = ld({
      "@type": "Person",
      name: "Dr Jane Doe",
      telephone: "+1 512 555 0199",
      email: "jane.doe@acme-co.com",
      sameAs: ["https://twitter.com/janedoe_personal"],
    });
    const staff = ld({
      "@type": "Dentist",
      name: "Acme Dental",
      url: SITE,
      telephone: "+1 512 555 0100",
      employee: [
        {
          "@type": "Person",
          name: "Bob",
          telephone: "+1 512 555 0177",
          email: "bob@acme-co.com",
          sameAs: "https://www.instagram.com/bob.personal",
        },
      ],
    });
    const r = extractFromPages([pageOf(`${person}${staff}`, SITE)]);
    assert.deepEqual(pick(r, "company_name", "fact"), ["Acme Dental"]);
    assert.deepEqual(pick(r, "contact_phone"), ["+1 512 555 0100"]);
    assert.deepEqual(pick(r, "contact_email"), []);
    assert.deepEqual(pick(r, "social_profile"), []);
  });

  it("still reads the business's own contactPoint", () => {
    const r = extractFromPages([
      pageOf(
        ld({
          "@type": "Organization",
          name: "Acme Co",
          url: SITE,
          contactPoint: {
            "@type": "ContactPoint",
            telephone: "+1 512 555 0101",
            email: "sales@acme-co.com",
          },
          founder: {
            "@type": "Person",
            name: "Ann",
            telephone: "+1 512 555 0188",
            email: "ann@acme-co.com",
          },
        }),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "contact_phone"), ["+1 512 555 0101"]);
    assert.deepEqual(pick(r, "contact_email"), ["sales@acme-co.com"]);
  });

  it("ignores organizations whose own URL is on another domain", () => {
    const r = extractFromPages([
      pageOf(
        ld([
          {
            "@type": "Organization",
            name: "Partner Corp",
            url: "https://partner.example",
            telephone: "+44 20 7946 0000",
          },
          {
            "@type": "Organization",
            name: "Acme Co",
            url: "https://www.acme-co.com/",
            telephone: "+44 20 7946 0001",
          },
        ]),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "company_name", "fact"), ["Acme Co"]);
    assert.deepEqual(pick(r, "contact_phone"), ["+44 20 7946 0001"]);
  });

  it("recognises the business named as a page's publisher or a service's provider", () => {
    const r = extractFromPages([
      pageOf(
        ld([
          {
            "@type": "WebSite",
            name: "Acme site",
            publisher: {
              "@type": "Organization",
              name: "Acme Publishing Co",
              logo: "https://acme-co.com/logo.png",
            },
          },
          {
            "@type": "Service",
            name: "Bookkeeping",
            provider: {
              "@type": "AccountingService",
              name: "Acme Books",
              telephone: "+1 212 555 0111",
            },
          },
        ]),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "company_name", "fact").sort(), ["Acme Books", "Acme Publishing Co"]);
    assert.deepEqual(pick(r, "industry"), ["Accounting Service"]);
    assert.deepEqual(pick(r, "service", "fact"), ["Bookkeeping"]);
  });
});

// ---------------------------------------------------------------------------
describe("M3: official social profiles only", () => {
  const footer = (links: string[]) =>
    `<footer>${links.map((href, i) => `<a href="${href}">link ${i}</a>`).join("")}</footer>`;

  it("rejects videos, posts, reels, tweets and short links", () => {
    const r = extractFromPages([
      pageOf(
        footer([
          "https://www.youtube.com/watch?v=abc123",
          "https://www.youtube.com/shorts/abc123",
          "https://www.youtube.com/embed/abc123",
          "https://youtu.be/xyz",
          "https://www.instagram.com/p/C0ffee/",
          "https://www.instagram.com/reel/C0ffee/",
          "https://x.com/someone/status/123",
          "https://twitter.com/acmeco/status/456",
          "https://www.tiktok.com/@acmeco/video/789",
          "https://www.facebook.com/acmeco/posts/101",
          "https://www.facebook.com/watch/?v=1",
          "https://www.facebook.com/profile.php?id=100",
          "https://www.linkedin.com/posts/acme_activity-1",
          "https://www.linkedin.com/company/acme/posts/",
        ]),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "social_profile"), []);
  });

  it("accepts profile, page, channel and listing URLs", () => {
    const r = extractFromPages([
      pageOf(
        footer([
          "https://www.facebook.com/acmeco/",
          "https://www.instagram.com/acme.co/",
          "https://x.com/acmeco",
          "https://www.youtube.com/@acmeco",
          "https://www.youtube.com/channel/UC1234567890abcdefghijkl",
          "https://www.tiktok.com/@acmeco",
          "https://www.linkedin.com/company/acme/",
          "https://www.yelp.com/biz/acme-co-austin",
        ]),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "social_profile").sort(), [
      "https://facebook.com/acmeco",
      "https://instagram.com/acme.co",
      "https://linkedin.com/company/acme",
      "https://tiktok.com/@acmeco",
      "https://x.com/acmeco",
      "https://yelp.com/biz/acme-co-austin",
      "https://youtube.com/@acmeco",
      "https://youtube.com/channel/UC1234567890abcdefghijkl",
    ]);
  });

  it("ignores profile links inside testimonials, reviews and lists of posts", () => {
    const html = `<main>
      <blockquote>Great service! Follow me <a href="https://www.instagram.com/happy.customer">@happy.customer</a></blockquote>
      <div class="testimonials"><a href="https://www.facebook.com/someclient">Client</a></div>
      <article><h2>Post one</h2><a href="https://x.com/guestwriter">Guest</a></article>
      <article><h2>Post two</h2></article>
    </main>${footer(["https://www.instagram.com/acme.co"])}`;
    const r = extractFromPages([pageOf(html, SITE)]);
    assert.deepEqual(pick(r, "social_profile"), ["https://instagram.com/acme.co"]);
  });

  it("ignores profile links in the main content of pages other than home, about and contact", () => {
    const services = pageOf(
      `<main><h1>Services</h1><p>As featured by <a href="https://www.instagram.com/some.magazine">a magazine</a></p></main>`,
      `${SITE}services`,
      "services",
    );
    const r = extractFromPages([pageOf("<p>home</p>", SITE), services]);
    assert.deepEqual(pick(r, "social_profile"), []);
  });

  it("socialProfile itself never builds a fake profile from a short link", () => {
    assert.equal(socialProfile("https://youtu.be/xyz"), null);
    assert.equal(socialProfile("https://www.youtube.com/watch?v=abc"), null);
  });
});

// ---------------------------------------------------------------------------
describe("M4: deeply nested and huge HTML", () => {
  for (const depth of [20_000, 100_000]) {
    it(`does not crash on ${depth.toLocaleString("en-US")} nested elements and keeps shallow content`, () => {
      const html = `<h1>Acme Deep Co</h1><a href="mailto:hello@acme-co.com">mail</a>${"<div>".repeat(depth)}<p>deep text</p>${"</div>".repeat(depth)}`;
      const page = pageOf(html, SITE);
      assert.equal(page.parseLimited, true);
      assert.ok(page.blocks.some((b) => b.text === "Acme Deep Co"));
      assert.ok(!page.blocks.some((b) => b.text === "deep text"));
      assert.deepEqual(pick(extractFromPages([page]), "contact_email"), ["hello@acme-co.com"]);
    });
  }

  it("stops after MAX_NODES elements", () => {
    const html = `<p>first</p>${"<i></i>".repeat(MAX_NODES + 10)}<p>after the limit</p>`;
    const page = pageOf(html, SITE);
    assert.equal(page.parseLimited, true);
    assert.ok(page.blocks.some((b) => b.text === "first"));
    assert.ok(!page.blocks.some((b) => b.text === "after the limit"));
  });

  const DNS = { "acme-co.com": [PUBLIC_V4] };

  it("a hostile non-home page becomes a warning and the crawl completes", async () => {
    const { fetcher } = fetcherFor(
      {
        "acme-co.com/robots.txt": robotsAllowAll,
        "acme-co.com/": {
          body: `<nav><a href="/about">About</a><a href="/contact">Contact</a></nav>`,
        },
        "acme-co.com/about": { body: `${"<div>".repeat(50_000)}x` },
        "acme-co.com/contact": { body: "<p>Phone: 512-555-0142</p>" },
      },
      DNS,
    );
    const crawl = await crawlCompanyWebsite("acme-co.com", fetcher, { now });
    assert.deepEqual(
      crawl.pages.map((p) => p.pageType),
      ["home", "contact", "about"],
    );
    assert.deepEqual(
      crawl.warnings.map((w) => w.code),
      ["page_parse_limited"],
    );
  });

  it("an unreadable page is a parse warning, an unreadable home page a permanent error — never connection_failed", async () => {
    const good = (url: string, body: string): SafeFetchResult => ({
      url,
      status: 200,
      contentType: "text/html",
      charset: "utf-8",
      body: Buffer.from(body),
      truncated: false,
      redirects: [],
      remoteAddress: PUBLIC_V4,
      headers: {},
    });
    const unreadable = (url: string) =>
      ({
        ...good(url, ""),
        get body(): Buffer {
          throw new RangeError("Maximum call stack size exceeded");
        },
      }) as SafeFetchResult;

    const partial = await crawlCompanyWebsite(
      "acme-co.com",
      {
        fetchPage: async (u) => {
          const url = new URL(u).href;
          return url.endsWith("/about")
            ? unreadable(url)
            : good(url, `<nav><a href="/about">About</a></nav>`);
        },
      },
      { now },
    );
    assert.deepEqual(
      partial.warnings.map((w) => w.code),
      ["page_parse_failed"],
    );

    await assert.rejects(
      crawlCompanyWebsite("acme-co.com", { fetchPage: async (u) => unreadable(new URL(u).href) }),
      (e: ExtractionError) =>
        e instanceof ExtractionError && e.code === "page_unparseable" && !e.retryable,
    );
  });
});

// ---------------------------------------------------------------------------
describe("M5: the company's domain is the crawl boundary", () => {
  const DNS = {
    "old-brand.com": [PUBLIC_V4],
    "www.old-brand.com": [PUBLIC_V4],
    "en.old-brand.com": [PUBLIC_V4],
    "unrelated-new-owner.com": [PUBLIC_V4_B],
    "www.instagram.com": [PUBLIC_V4_B],
    "intranet.old-brand.com": ["10.0.0.5"],
  };

  it("refuses a home page that redirects to another domain, without contacting it", async () => {
    const { fetcher, net, dns } = fetcherFor(
      {
        "old-brand.com/robots.txt": robotsAllowAll,
        "old-brand.com/": {
          status: 301,
          headers: { location: "https://unrelated-new-owner.com/" },
        },
        "unrelated-new-owner.com/robots.txt": robotsAllowAll,
        "unrelated-new-owner.com/": { body: "<title>Unrelated Casino</title>" },
      },
      DNS,
    );
    await assert.rejects(
      crawlCompanyWebsite("old-brand.com", fetcher, { now }),
      (e: ResearchFetchError) =>
        e.code === "outside_boundary" &&
        !e.retryable &&
        e.message.includes("old-brand.com") &&
        e.message.includes("unrelated-new-owner.com"),
    );
    assert.ok(!net.requests.some((r) => r.url.hostname === "unrelated-new-owner.com"));
    assert.ok(!dns.calls.includes("unrelated-new-owner.com")); // not even looked up
  });

  it("allows home redirects within the domain (www, subdomains)", async () => {
    for (const target of ["https://www.old-brand.com/", "https://en.old-brand.com/"]) {
      const host = new URL(target).host;
      const { fetcher } = fetcherFor(
        {
          "old-brand.com/robots.txt": robotsAllowAll,
          "old-brand.com/": { status: 301, headers: { location: target } },
          [`${host}/robots.txt`]: robotsAllowAll,
          [`${host}/`]: { body: "<p>welcome</p>" },
        },
        DNS,
      );
      const crawl = await crawlCompanyWebsite("old-brand.com", fetcher, { now });
      assert.equal(crawl.pages[0].url, target);
    }
  });

  it("does not follow an internal link that redirects to a social network: no request, not even robots.txt", async () => {
    const { fetcher, net } = fetcherFor(
      {
        "old-brand.com/robots.txt": robotsAllowAll,
        "old-brand.com/": { body: `<nav><a href="/about-us">About us</a></nav>` },
        "old-brand.com/about-us": {
          status: 302,
          headers: { location: "https://www.instagram.com/oldbrand/" },
        },
        "www.instagram.com/robots.txt": robotsAllowAll,
        "www.instagram.com/oldbrand/": { body: "<p>profile</p>" },
      },
      DNS,
    );
    const crawl = await crawlCompanyWebsite("old-brand.com", fetcher, { now });
    assert.deepEqual(
      crawl.warnings.map((w) => w.code),
      ["page_skipped_offsite"],
    );
    assert.deepEqual(
      net.requests.map((r) => `${r.url.hostname}${r.url.pathname}`),
      ["old-brand.com/robots.txt", "old-brand.com/", "old-brand.com/about-us"],
    );
  });

  it("checks the boundary on the very first request too", async () => {
    const { fetcher, net } = fetcherFor({ "old-brand.com/": { body: "x" } }, DNS);
    await assert.rejects(
      fetcher.fetchPage("https://old-brand.com/", { boundary: () => false }),
      (e: ResearchFetchError) => e.code === "outside_boundary",
    );
    assert.equal(net.requests.length, 0);
  });

  it("keeps the Phase 3A address checks inside the boundary", async () => {
    const { fetcher, net } = fetcherFor(
      {
        "old-brand.com/robots.txt": robotsAllowAll,
        "old-brand.com/": { status: 302, headers: { location: "https://intranet.old-brand.com/" } },
      },
      DNS,
    );
    await assert.rejects(
      crawlCompanyWebsite("old-brand.com", fetcher, { now }),
      (e: ResearchFetchError) => e.code === "blocked_address",
    );
    assert.ok(!net.requests.some((r) => r.url.hostname === "intranet.old-brand.com"));
  });
});

// ---------------------------------------------------------------------------
describe("M6: evidence supports the whole value", () => {
  const address = {
    "@type": "LocalBusiness",
    name: "Acme",
    url: SITE,
    address: {
      "@type": "PostalAddress",
      streetAddress: "1 Main St",
      addressLocality: "Austin",
      addressRegion: "TX",
      postalCode: "78701",
      addressCountry: "US",
    },
  };

  it("quotes every component of a combined JSON-LD address", () => {
    const page = pageOf(ld(address), SITE);
    const r = extractFromPages([page]);
    const fact = r.findings.find((f) => f.category === "contact_address");
    assert.ok(fact);
    assert.equal(fact.value, "1 Main St, Austin, TX, 78701, US");
    assert.equal(fact.quote, "address.streetAddress: 1 Main St");
    assert.deepEqual(fact.evidence, [
      "address.addressLocality: Austin",
      "address.addressRegion: TX",
      "address.postalCode: 78701",
      "address.addressCountry: US",
    ]);
    for (const q of [fact.quote, ...(fact.evidence ?? [])]) assert.ok(verifyQuote(page, q));
    const { payload } = buildCompletionPayload([page], r);
    const saved = payload.findings.find((f) => f.value_text === fact.value);
    assert.deepEqual(saved?.value_json.evidence, fact.evidence);
  });

  it("quotes every component of a location", () => {
    const r = extractFromPages([pageOf(ld(address), SITE)]);
    const location = r.findings.find((f) => f.category === "location");
    assert.equal(location?.value, "Austin, TX, US");
    assert.equal(location?.quote, "address.addressLocality: Austin");
    assert.deepEqual(location?.evidence, [
      "address.addressRegion: TX",
      "address.addressCountry: US",
    ]);
  });

  it("only claims the components the page states", () => {
    const partial = {
      ...address,
      address: { "@type": "PostalAddress", streetAddress: "1 Main St", addressCountry: "US" },
    };
    const r = extractFromPages([pageOf(ld(partial), SITE)]);
    const fact = r.findings.find((f) => f.category === "contact_address");
    assert.equal(fact?.value, "1 Main St, US");
    assert.deepEqual(Object.keys(fact?.details ?? {}), ["streetAddress", "addressCountry"]);
  });

  it("drops a fact whose value is not fully stated in its evidence", () => {
    const page = pageOf(ld(address), SITE);
    const warnings: ExtractionWarning[] = [];
    const c = new FindingCollector(warnings);
    const kept = c.add(page, {
      category: "contact_address",
      kind: "fact",
      key: "address:x",
      value: "1 Main St, Austin, TX",
      quote: "address.streetAddress: 1 Main St",
      method: "json-ld",
    });
    assert.equal(kept, false);
    assert.equal(warnings[0].code, "evidence_insufficient");
    // A composite value names its components; each must be in a verified quote.
    const composite = {
      category: "contact_address" as const,
      kind: "fact" as const,
      key: "address:x",
      quote: "address.streetAddress: 1 Main St",
      evidence: ["address.addressLocality: Austin", "address.addressRegion: TX"],
      method: "json-ld" as const,
    };
    assert.equal(
      c.add(page, {
        ...composite,
        value: "1 Main St, Austin, TX, 90210",
        supportParts: ["1 Main St", "Austin", "TX", "90210"],
      }),
      false,
    );
    assert.equal(
      c.add(page, {
        ...composite,
        value: "1 Main St, Austin, TX",
        supportParts: ["1 Main St", "Austin", "TX"],
      }),
      true,
    );
    assert.deepEqual(
      warnings.map((w) => w.code),
      ["evidence_insufficient", "evidence_insufficient"],
    );
  });

  it("cuts long descriptions so the saved value fits inside its quote", () => {
    const long = `${"Acme builds custom furniture for homes and offices. ".repeat(30)}End.`;
    const page = pageOf(`<head><meta name="description" content="${long}"></head>`, SITE);
    const fact = extractFromPages([page]).findings.find(
      (f) => f.category === "business_description",
    );
    assert.ok(fact);
    assert.ok(fact.value.length < long.length);
    assert.ok(fact.quote.includes(fact.value));
  });

  it("uses the number stated in a tel: link as the value", () => {
    const r = extractFromPages([
      pageOf(`<footer><a href="tel:+15125550142">Call us today</a></footer>`, SITE),
    ]);
    assert.deepEqual(pick(r, "contact_phone"), ["+15125550142"]);
  });
});

// ---------------------------------------------------------------------------
describe("minor issues", () => {
  it("1. keeps every link it inspects quotable (450 links, then profile and mailto)", () => {
    const many = Array.from({ length: 450 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
    const r = extractFromPages([
      pageOf(
        `<footer>${many}<a href="https://www.instagram.com/acme_co">Instagram</a><a href="mailto:hello@acme-co.com">mail</a></footer>`,
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "social_profile"), ["https://instagram.com/acme_co"]);
    assert.deepEqual(pick(r, "contact_email"), ["hello@acme-co.com"]);
    assert.equal(r.warnings.filter((w) => w.code === "quote_rejected").length, 0);
  });

  it("2. does not read dates or year ranges as phone numbers", () => {
    for (const text of [
      "Reservations: 2024-2025 season opens soon",
      "Call 12/05/2024 to book",
      "Phone: 2024-11-04",
      "Bookings 2025/2026",
    ]) {
      assert.deepEqual(
        pick(extractFromPages([pageOf(`<p>${text}</p>`, SITE)]), "contact_phone"),
        [],
        text,
      );
    }
    assert.deepEqual(
      pick(extractFromPages([pageOf("<p>Phone: 512-555-0142</p>", SITE)]), "contact_phone"),
      ["512-555-0142"],
    );
    assert.equal(isDateLike("2024-2025"), true);
    assert.equal(isDateLike("555-0142"), false);
  });

  it("3. needs a distinctive shared word for a name match", () => {
    assert.equal(compareNames("Bright Smile Dental", ["Dental"]), "mismatch");
    assert.equal(compareNames("Acme Home Services", ["Home Services"]), "mismatch");
    assert.equal(compareNames("Acme Dental", ["Zenith Dental"]), "mismatch");
    assert.equal(compareNames("Acme Dental Group", ["Acme"]), "match");
    assert.equal(compareNames("Bright Smile Dental LLC", ["Bright Smile Dental"]), "match");
    assert.equal(compareNames("Acme Plumbing", ["Acme Heating & Air"]), "partial");
  });

  it("4. keeps candidates conservative around unrelated headings", () => {
    const r = extractFromPages([
      pageOf(
        `<main><h2>Insurance Coverage</h2><ul><li>Delta Dental</li><li>Cigna</li></ul>
         <h2>Serving Austin since 1998</h2><ul><li>Family owned</li></ul></main>`,
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "service_area"), []);
    const services = extractFromPages([
      pageOf(
        `<main><h1>Our work</h1><h2>Kitchen Remodeling</h2><h2>How it works</h2><h2>Why choose us?</h2><h2>What our clients say</h2><h2>Our Process</h2><h2>Bathroom Renovation</h2></main>`,
        `${SITE}services`,
        "services",
      ),
    ]);
    assert.deepEqual(pick(services, "service"), ["Kitchen Remodeling", "Bathroom Renovation"]);
  });

  it("5. classifies customer-service and store-locator pages correctly", () => {
    const at = (path: string, text = "") => classifyPage(new URL(path, SITE), text);
    assert.equal(at("/customer-service"), "contact");
    assert.equal(at("/help", "Customer Support"), "contact");
    assert.equal(at("/store-locator"), "locations");
    assert.equal(at("/stores"), "locations");
    assert.equal(at("/store"), "products");
    assert.equal(at("/services"), "services");
  });

  it("6. third-party contact details are not company facts", () => {
    const html = `<main>
      <blockquote>Thanks! — jo@client-company.com, 22 Elm Road, Leeds</blockquote>
      <article><h2>News one</h2><address>Press office, 5 Fleet St, London</address></article>
      <article><h2>News two</h2></article>
    </main><footer><p>Email: hello@acme-co.com</p><address>1 Main St, Austin</address></footer>`;
    const r = extractFromPages([pageOf(html, SITE)]);
    assert.deepEqual(pick(r, "contact_email", "fact"), ["hello@acme-co.com"]);
    assert.deepEqual(pick(r, "contact_email", "candidate"), ["jo@client-company.com"]);
    assert.deepEqual(pick(r, "contact_address"), ["1 Main St, Austin"]);
  });

  it("7. the business entity survives the JSON-LD entity cap", () => {
    const products = Array.from({ length: 150 }, (_, i) => ({
      "@type": "Product",
      name: `Item ${i}`,
    }));
    const r = extractFromPages([
      pageOf(
        ld([
          ...products,
          { "@type": "Store", name: "Acme Store", url: SITE, telephone: "+1 512 555 0142" },
        ]),
        SITE,
      ),
    ]);
    assert.deepEqual(pick(r, "company_name", "fact"), ["Acme Store"]);
    assert.deepEqual(pick(r, "industry"), ["Store"]);
    assert.equal(pick(r, "product").length, 40); // capped, as before
  });

  it("8. stops at the crawl deadline: partial result, or a permanent error if the home page never loads", async () => {
    const DNS = { "acme-co.com": [PUBLIC_V4] };
    const slowPage = fetcherFor(
      {
        "acme-co.com/robots.txt": robotsAllowAll,
        "acme-co.com/": {
          body: `<nav><a href="/about">About</a><a href="/contact">Contact</a></nav>`,
        },
        "acme-co.com/contact": { hang: true },
        "acme-co.com/about": { body: "<p>about</p>" },
      },
      DNS,
    );
    const crawl = await crawlCompanyWebsite("acme-co.com", slowPage.fetcher, {
      now,
      deadlineMs: 100,
    });
    assert.deepEqual(
      crawl.pages.map((p) => p.pageType),
      ["home"],
    );
    assert.deepEqual(
      crawl.warnings.map((w) => w.code),
      ["crawl_deadline"],
    );

    const slowHome = fetcherFor(
      { "acme-co.com/robots.txt": robotsAllowAll, "acme-co.com/": { hang: true } },
      DNS,
    );
    await assert.rejects(
      crawlCompanyWebsite("acme-co.com", slowHome.fetcher, { now, deadlineMs: 100 }),
      (e: ExtractionError) => e.code === "crawl_deadline_exceeded" && !e.retryable,
    );

    // Cancelling is still "cancelled", not a deadline.
    const controller = new AbortController();
    const pending = crawlCompanyWebsite("acme-co.com", slowHome.fetcher, {
      now,
      deadlineMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, (e: ResearchFetchError) => e.code === "cancelled");
  });

  it("9. checks quotes against a cached normalized document with unchanged results", () => {
    const html = `<main>${Array.from({ length: 3_000 }, (_, i) => `<p>Line   ${i} with text</p>`).join("")}</main>`;
    const page = pageOf(html, SITE);
    for (const q of ["Line 2999 with text", "Line   5\nwith text", "Line 3000 with text", "zz"]) {
      assert.equal(verifyQuote(page, q), quoteIn(page.evidence.text, q), q);
    }
    const started = performance.now();
    for (let i = 0; i < 5_000; i++) verifyQuote(page, `Line ${i % 3_000} with text`);
    assert.ok(performance.now() - started < 2_000);
  });

  it("10. hidden content is not evidence", () => {
    const html = `<main><p>Visible text here</p>
      <p class="hidden">class hidden</p><p class="d-none">bootstrap none</p><p class="invisible">invisible class</p>
      <p class="screen-reader-text">screen reader</p><p inert>inert text</p>
      <p style="opacity: 0">zero opacity</p><p style="font-size:0">zero font</p>
      <dialog>closed dialog</dialog><p class="hidden-xs">desktop only text</p></main>`;
    const text = pageOf(html, SITE).evidence.text;
    assert.ok(text.includes("Visible text here"));
    assert.ok(text.includes("desktop only text")); // responsive classes stay visible elsewhere
    for (const hidden of [
      "class hidden",
      "bootstrap none",
      "invisible class",
      "screen reader",
      "inert text",
      "zero opacity",
      "zero font",
      "closed dialog",
    ]) {
      assert.ok(!text.includes(hidden), hidden);
    }
  });

  it("offers without a typed item are not assumed to be services", () => {
    const offer = ld({ "@type": "Offer", itemOffered: { name: "Gift Card" } });
    assert.deepEqual(
      extractFromPages([pageOf(offer, SITE)]).findings.filter((f) => f.value === "Gift Card"),
      [],
    );
    const onProducts = extractFromPages([
      pageOf("<p>home</p>", SITE),
      pageOf(offer, `${SITE}shop`, "products"),
    ]);
    assert.deepEqual(pick(onProducts, "product", "candidate"), ["Gift Card"]);
    const typed = extractFromPages([
      pageOf(ld({ "@type": "Offer", itemOffered: { "@type": "Service", name: "Repair" } }), SITE),
    ]);
    assert.deepEqual(pick(typed, "service", "fact"), ["Repair"]);
  });
});

// ---------------------------------------------------------------------------
describe("describeFailure: extraction failures keep their own, permanent classification", () => {
  it("keeps the code, message and non-retryable flag of each extraction error", () => {
    for (const code of ["page_unparseable", "crawl_deadline_exceeded"] as const) {
      assert.deepEqual(describeFailure(new ExtractionError(code, `failed: ${code}`)), {
        code,
        message: `failed: ${code}`,
        retryable: false,
        retryAfterMs: undefined,
      });
    }
  });

  it("is not fooled by a retryable fetch error as the cause", () => {
    const cause = new ResearchFetchError("connection_failed", "reset");
    const d = describeFailure(
      new ExtractionError("page_unparseable", "The home page could not be read", { cause }),
    );
    assert.equal(d.code, "page_unparseable");
    assert.equal(d.retryable, false);
  });

  it("classifies the errors the crawl actually throws", async () => {
    const unreadable = (url: string) =>
      ({
        url,
        status: 200,
        contentType: "text/html",
        charset: "utf-8",
        truncated: false,
        redirects: [],
        remoteAddress: PUBLIC_V4,
        headers: {},
        get body(): Buffer {
          throw new RangeError("Maximum call stack size exceeded");
        },
      }) as SafeFetchResult;
    const unparseable = await crawlCompanyWebsite("acme-co.com", {
      fetchPage: async (u) => unreadable(new URL(u).href),
    }).catch((e: unknown) => e);
    assert.deepEqual(
      {
        code: describeFailure(unparseable).code,
        retryable: describeFailure(unparseable).retryable,
      },
      { code: "page_unparseable", retryable: false },
    );

    const { fetcher } = fetcherFor(
      { "acme-co.com/robots.txt": robotsAllowAll, "acme-co.com/": { hang: true } },
      { "acme-co.com": [PUBLIC_V4] },
    );
    const late = await crawlCompanyWebsite("acme-co.com", fetcher, { now, deadlineMs: 50 }).catch(
      (e: unknown) => e,
    );
    assert.deepEqual(
      { code: describeFailure(late).code, retryable: describeFailure(late).retryable },
      { code: "crawl_deadline_exceeded", retryable: false },
    );
  });

  it("leaves fetch error classification and cancellation unchanged", () => {
    const outside = new ResearchFetchError("outside_boundary", "other.com is outside");
    assert.deepEqual(
      [describeFailure(outside).code, describeFailure(outside).retryable],
      ["outside_boundary", false],
    );
    const busy = describeFailure(statusError(503, "https://acme-co.com/", "30", 0));
    assert.deepEqual([busy.code, busy.retryable, busy.retryAfterMs], ["http_status", true, 30_000]);
    const abort = describeFailure(Object.assign(new Error("aborted"), { name: "AbortError" }));
    assert.deepEqual([abort.code, abort.retryable], ["cancelled", false]);
    const unknown = describeFailure(new Error("socket hang up"));
    assert.deepEqual([unknown.code, unknown.retryable], ["connection_failed", true]);
  });
});
