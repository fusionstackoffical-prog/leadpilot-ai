// The crawler runs on the real Phase 3A fetcher (address policy, pinning, redirects, robots.txt,
// rate limiting) with the in-memory DNS and HTTP fakes; no real network is used.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FETCH_LIMITS } from "../../src/features/research/engine/config.ts";
import { crawlCompanyWebsite, startUrl } from "../../src/features/research/engine/extract/crawl.ts";
import { researchCompanyWebsite } from "../../src/features/research/engine/extract/extract.ts";
import {
  classifyPage,
  crawlableUrl,
  selectPages,
} from "../../src/features/research/engine/extract/pages.ts";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { createResearchFetcher } from "../../src/features/research/engine/net/fetcher.ts";
import {
  ESTATE_ABOUT,
  ESTATE_CONTACT,
  ESTATE_HOME,
  ESTATE_LISTINGS,
  RETRIEVED_AT,
} from "./extract-fixtures.ts";
import {
  fakeClock,
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  PUBLIC_V4_B,
  UA,
  type FakeRoute,
} from "./net-fakes.ts";

const robotsAllowAll: FakeRoute = {
  body: "User-agent: *\nAllow: /\n",
  headers: { "content-type": "text/plain" },
};

function setup(routes: Record<string, FakeRoute>) {
  const dns = fakeResolver({
    "primerealty.ae": [PUBLIC_V4],
    "www.primerealty.ae": [PUBLIC_V4],
    "partner-site.com": [PUBLIC_V4_B],
    "www.youtube.com": [PUBLIC_V4_B],
    "internal-site.com": ["10.1.2.3"],
  });
  const net = fakeTransport(routes);
  const time = fakeClock();
  const fetcher = createResearchFetcher({
    config: {
      ...DEFAULT_FETCH_LIMITS,
      contactUrl: "https://leadpilot.example.com/bot",
      userAgent: UA,
    },
    resolver: dns.resolver,
    transport: net.transport,
    clock: time.clock,
  });
  return { fetcher, net, time };
}

const ESTATE: Record<string, FakeRoute> = {
  "primerealty.ae/robots.txt": robotsAllowAll,
  "primerealty.ae/": { body: ESTATE_HOME },
  "primerealty.ae/listings": { body: ESTATE_LISTINGS },
  "primerealty.ae/about": { body: ESTATE_ABOUT },
  "primerealty.ae/contact-us": { body: ESTATE_CONTACT },
};
const now = () => new Date(RETRIEVED_AT);

describe("crawlCompanyWebsite", () => {
  it("fetches the home page and its about, products and contact pages through the secure fetcher", async () => {
    const { fetcher, net } = setup(ESTATE);
    const crawl = await crawlCompanyWebsite("primerealty.ae", fetcher, { now });
    assert.deepEqual(
      crawl.pages.map((p) => [p.pageType, new URL(p.url).pathname]),
      [
        ["home", "/"],
        ["contact", "/contact-us"],
        ["about", "/about"],
        ["products", "/listings"],
      ],
    );
    assert.deepEqual(crawl.warnings, []);
    // Every request was robots-checked and went to the pinned public address.
    assert.equal(net.requests[0].url.pathname, "/robots.txt");
    assert.ok(net.requests.every((r) => r.address === PUBLIC_V4));
    assert.ok(net.requests.every((r) => r.headers["user-agent"] === UA));
    assert.equal(crawl.pages[0].retrievedAt, RETRIEVED_AT);
  });

  it("never requests other websites, social networks, files or app pages", async () => {
    const { fetcher, net } = setup(ESTATE);
    await crawlCompanyWebsite("https://primerealty.ae/", fetcher, { now });
    const requested = net.requests.map((r) => r.url.href);
    for (const never of ["youtube.com", "partner-site.com", "brochure.pdf", "/login"]) {
      assert.ok(!requested.some((u) => u.includes(never)), never);
    }
  });

  it("respects the page limit and spaces requests to the site", async () => {
    const { fetcher, net, time } = setup(ESTATE);
    const crawl = await crawlCompanyWebsite("primerealty.ae", fetcher, { maxPages: 2, now });
    assert.equal(crawl.pages.length, 2);
    assert.equal(net.requests.length, 3); // robots.txt + 2 pages
    assert.ok(time.sleeps.every((ms) => ms >= 2_000));
  });

  it("skips pages robots.txt disallows, with a warning", async () => {
    const { fetcher, net } = setup({
      ...ESTATE,
      "primerealty.ae/robots.txt": {
        body: "User-agent: *\nDisallow: /about\n",
        headers: { "content-type": "text/plain" },
      },
    });
    const crawl = await crawlCompanyWebsite("primerealty.ae", fetcher, { now });
    assert.ok(!net.requests.some((r) => r.url.pathname === "/about"));
    assert.deepEqual(
      crawl.warnings.map((w) => w.code),
      ["page_skipped_robots"],
    );
  });

  it("keeps going when a page fails, and does not use pages that redirect to other sites", async () => {
    const { fetcher, net } = setup({
      ...ESTATE,
      "primerealty.ae/about": { status: 500 },
      "primerealty.ae/listings": {
        status: 302,
        headers: { location: "https://partner-site.com/offers" },
      },
      "partner-site.com/robots.txt": robotsAllowAll,
      "partner-site.com/offers": { body: "<h1>Not the company</h1>" },
    });
    const crawl = await crawlCompanyWebsite("primerealty.ae", fetcher, { now });
    assert.deepEqual(
      crawl.pages.map((p) => p.pageType),
      ["home", "contact"],
    );
    // Phase 3B.1: the off-site redirect is refused before the other site is contacted at all.
    assert.deepEqual(crawl.warnings.map((w) => w.code).sort(), [
      "page_failed",
      "page_skipped_offsite",
    ]);
    assert.ok(!net.requests.some((r) => r.url.hostname === "partner-site.com"));
  });

  it("follows a www redirect on the home page and treats www as the same site", async () => {
    const { fetcher } = setup({
      "primerealty.ae/robots.txt": robotsAllowAll,
      "primerealty.ae/": { status: 301, headers: { location: "https://www.primerealty.ae/" } },
      "www.primerealty.ae/robots.txt": robotsAllowAll,
      "www.primerealty.ae/": { body: ESTATE_HOME },
      "www.primerealty.ae/contact-us": { body: ESTATE_CONTACT },
    });
    const crawl = await crawlCompanyWebsite("primerealty.ae", fetcher, { now });
    assert.equal(crawl.pages[0].url, "https://www.primerealty.ae/");
    assert.ok(crawl.pages.some((p) => p.url === "https://www.primerealty.ae/contact-us"));
  });

  it("fails clearly when the home page cannot be fetched", async () => {
    const { fetcher } = setup({
      "primerealty.ae/robots.txt": robotsAllowAll,
      "primerealty.ae/": { status: 503 },
    });
    await assert.rejects(
      crawlCompanyWebsite("primerealty.ae", fetcher, { now }),
      (e: ResearchFetchError) => e.code === "http_status" && e.retryable,
    );
  });

  it("refuses invalid and internal websites before any request", async () => {
    const { fetcher, net } = setup({});
    for (const [site, code] of [
      ["", "invalid_url"],
      ["javascript:alert(1)", "invalid_url"],
      ["http://localhost/", "invalid_url"],
      ["http://192.168.1.1/", "blocked_address"],
      ["internal-site.com", "blocked_address"],
      ["ftp://primerealty.ae/", "invalid_url"],
    ] as const) {
      await assert.rejects(
        crawlCompanyWebsite(site, fetcher),
        (e: ResearchFetchError) => e.code === code,
        site,
      );
    }
    assert.equal(net.requests.length, 0);
  });

  it("stops when cancelled", async () => {
    const { fetcher } = setup(ESTATE);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      crawlCompanyWebsite("primerealty.ae", fetcher, { signal: controller.signal }),
      (e: ResearchFetchError) => e.code === "cancelled",
    );
  });

  it("runs the whole research pipeline end to end", async () => {
    const { fetcher } = setup(ESTATE);
    const { pages, extraction } = await researchCompanyWebsite(
      "primerealty.ae",
      fetcher,
      { companyName: "Prime Realty" },
      { now },
    );
    assert.equal(pages.length, 4);
    assert.equal(extraction.website, "https://primerealty.ae/");
    assert.ok(
      extraction.findings.some(
        (f) => f.category === "contact_email" && f.value === "info@primerealty.ae",
      ),
    );
    assert.equal(extraction.nameMatch, "match");
  });
});

describe("page discovery helpers", () => {
  const home = new URL("https://www.acme-co.com/");

  it("normalizes the imported website value", () => {
    assert.equal(startUrl("acme-co.com").href, "https://acme-co.com/");
    assert.equal(startUrl("  http://acme-co.com/about ").href, "http://acme-co.com/about");
  });

  it("keeps only same-site, crawlable URLs", () => {
    assert.equal(
      crawlableUrl("https://acme-co.com/about?utm_source=x", home)?.href,
      "https://acme-co.com/about",
    );
    for (const not of [
      "https://other.com/about",
      "https://shop.acme-co.com/",
      "mailto:a@acme-co.com",
      "https://acme-co.com/menu.pdf",
      "https://acme-co.com/cart",
      "https://acme-co.com/a/b/c/d/e",
      "https://acme-co.com/x?sessionid=1",
    ]) {
      assert.equal(crawlableUrl(not, home), null, not);
    }
  });

  it("classifies pages for any industry", () => {
    const cases: [string, string, string | null][] = [
      ["/contact-us", "", "contact"],
      ["/who-we-are", "", "about"],
      ["/treatments", "", "services"],
      ["/practice-areas/family-law", "", "services"],
      ["/menu", "", "products"],
      ["/rooms", "", "products"],
      ["/properties", "", "products"],
      ["/collections/all", "", "products"],
      ["/service-areas", "", "services"],
      ["/our-locations", "", "locations"],
      ["/p/123", "About the clinic", "about"],
      ["/blog/post", "Read more", null],
      ["/%E0%A4%A", "", null], // malformed escape: no crash
    ];
    for (const [path, text, type] of cases)
      assert.equal(classifyPage(new URL(path, home), text), type, path);
  });

  it("picks pages round-robin across types, shallow first", () => {
    const links = [
      ...Array.from({ length: 10 }, (_, i) => ({
        href: `https://www.acme-co.com/products/item-${i}`,
        text: "Product",
        region: "main" as const,
        context: "site" as const,
      })),
      {
        href: "https://www.acme-co.com/products",
        text: "Products",
        region: "nav" as const,
        context: "site" as const,
      },
      {
        href: "https://www.acme-co.com/about",
        text: "About",
        region: "nav" as const,
        context: "site" as const,
      },
      {
        href: "https://www.acme-co.com/contact",
        text: "Contact",
        region: "nav" as const,
        context: "site" as const,
      },
    ];
    const picked = selectPages(links, home, { maxPages: 6, maxPerType: 2 }).map(
      (p) => `${p.type}:${p.url.pathname}`,
    );
    assert.deepEqual(picked, [
      "contact:/contact",
      "about:/about",
      "products:/products",
      "products:/products/item-0",
    ]);
  });
});
