import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FETCH_LIMITS,
  type ResearchFetchConfig,
} from "../../src/features/research/engine/config.ts";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import {
  createProductionFetcher,
  createResearchFetcher,
} from "../../src/features/research/engine/net/fetcher.ts";
import {
  fakeClock,
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  PUBLIC_V4_B,
  UA,
  type FakeRoute,
} from "./net-fakes.ts";

const config: ResearchFetchConfig = {
  ...DEFAULT_FETCH_LIMITS,
  contactUrl: "https://leadpilot.example.com/bot",
  userAgent: UA,
};
const robots = (text: string): FakeRoute => ({
  body: text,
  headers: { "content-type": "text/plain" },
});

function setup(routes: Record<string, FakeRoute>) {
  const dns = fakeResolver({
    "acme.com": [PUBLIC_V4],
    "shop.acme.com": [PUBLIC_V4_B],
    "other.com": [PUBLIC_V4_B],
  });
  const net = fakeTransport(routes);
  const time = fakeClock();
  const fetcher = createResearchFetcher({
    config,
    resolver: dns.resolver,
    transport: net.transport,
    clock: time.clock,
  });
  return { fetcher, net, time };
}

describe("createResearchFetcher", () => {
  it("checks robots.txt before the first page and caches it", async () => {
    const { fetcher, net } = setup({
      "acme.com/robots.txt": robots("User-agent: *\nAllow: /\n"),
      "acme.com/": { body: "home" },
      "acme.com/about": { body: "about" },
    });
    await fetcher.fetchPage("https://acme.com/");
    await fetcher.fetchPage("https://acme.com/about");
    assert.deepEqual(
      net.requests.map((r) => r.url.pathname),
      ["/robots.txt", "/", "/about"],
    );
  });

  it("refuses pages disallowed by robots.txt without requesting them", async () => {
    const { fetcher, net } = setup({
      "acme.com/robots.txt": robots("User-agent: LeadPilotResearchBot\nDisallow: /team\n"),
      "acme.com/team": { body: "people" },
    });
    await assert.rejects(
      fetcher.fetchPage("https://acme.com/team"),
      (e: ResearchFetchError) => e.code === "robots_disallowed" && !e.retryable,
    );
    assert.deepEqual(
      net.requests.map((r) => r.url.pathname),
      ["/robots.txt"],
    );
  });

  it("applies robots.txt of the redirect target too", async () => {
    const { fetcher, net } = setup({
      "acme.com/robots.txt": robots("User-agent: *\nAllow: /\n"),
      "acme.com/store": { status: 302, headers: { location: "https://shop.acme.com/private" } },
      "shop.acme.com/robots.txt": robots("User-agent: *\nDisallow: /private\n"),
      "shop.acme.com/private": { body: "secret" },
    });
    await assert.rejects(
      fetcher.fetchPage("https://acme.com/store"),
      (e: ResearchFetchError) => e.code === "robots_disallowed",
    );
    assert.ok(!net.requests.some((r) => r.url.href === "https://shop.acme.com/private"));
  });

  it("does not crawl when robots.txt cannot be read, and says it is retryable", async () => {
    const { fetcher, net } = setup({
      "acme.com/robots.txt": { status: 503 },
      "acme.com/": { body: "home" },
    });
    await assert.rejects(
      fetcher.fetchPage("https://acme.com/"),
      (e: ResearchFetchError) => e.code === "robots_unavailable" && e.retryable,
    );
    assert.deepEqual(
      net.requests.map((r) => r.url.pathname),
      ["/robots.txt"],
    );
  });

  it("crawls when the site has no robots.txt", async () => {
    const { fetcher } = setup({
      "acme.com/robots.txt": { status: 404 },
      "acme.com/": { body: "home" },
    });
    assert.equal((await fetcher.fetchPage("https://acme.com/")).status, 200);
  });

  it("spaces requests per host using the site's Crawl-delay", async () => {
    const { fetcher, time } = setup({
      "acme.com/robots.txt": robots("User-agent: *\nCrawl-delay: 4\n"),
      "acme.com/a": { body: "a" },
      "acme.com/b": { body: "b" },
    });
    await fetcher.fetchPage("https://acme.com/a");
    await fetcher.fetchPage("https://acme.com/b");
    // robots.txt -> 2 s default pause -> /a -> 4 s crawl delay -> /b
    assert.deepEqual(time.sleeps, [2_000, 4_000]);
  });

  it("reports the real reason when the domain does not exist", async () => {
    const { fetcher } = setup({});
    await assert.rejects(
      fetcher.fetchPage("https://missing.com/"),
      (e: ResearchFetchError) => e.code === "dns_not_found",
    );
  });

  it("will not build a production fetcher without the bot contact URL", () => {
    assert.throws(() => createProductionFetcher({}), /RESEARCH_BOT_CONTACT_URL/);
    assert.doesNotThrow(() =>
      createProductionFetcher({ RESEARCH_BOT_CONTACT_URL: "https://leadpilot.example.com/bot" }),
    );
  });
});
