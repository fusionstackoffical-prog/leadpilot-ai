// The public crawler information page makes five claims about the research bot. This file proves each one
// against the real engine code, using the project's in-memory DNS and HTTP fakes (nothing here touches the
// network, and the page itself is never fetched):
//   1. The bot identifies itself as "LeadPilotResearchBot/1.0" plus a link to the page.
//   2. It follows robots.txt, and "User-agent: LeadPilotResearchBot / Disallow: /" blocks it completely.
//   3. It reads at most six public pages per visit, at a limited rate.
//   4. It does not log in, submit forms, run scripts, or access non-public content.
//   5. It does not crawl search engines or social media platforms (from links on a company's site).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import robotsParser from "robots-parser";
import {
  BOT_TOKEN,
  DEFAULT_FETCH_LIMITS,
  loadResearchFetchConfig,
  ResearchConfigError,
  type ResearchFetchConfig,
} from "../../src/features/research/engine/config.ts";
import { researchEligibility } from "../../src/features/research/eligibility.ts";
import {
  crawlCompanyWebsite,
  DEFAULT_CRAWL,
} from "../../src/features/research/engine/extract/crawl.ts";
import { researchCompanyWebsite } from "../../src/features/research/engine/extract/extract.ts";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { createResearchFetcher } from "../../src/features/research/engine/net/fetcher.ts";
import { RobotsCache, ROBOTS_MAX_BYTES } from "../../src/features/research/engine/net/robots.ts";
import type { SafeFetchResult } from "../../src/features/research/engine/net/safe-fetch.ts";
import {
  fakeClock,
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  PUBLIC_V4_B,
  type FakeRoute,
} from "./net-fakes.ts";

const PAGE = "https://coruscating-pasca-a9e91e.netlify.app";
const CONFIG: ResearchFetchConfig = loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: PAGE });
const FULL_UA = CONFIG.userAgent;
const OUR_GROUP = "User-agent: LeadPilotResearchBot\nDisallow: /\n";
const now = () => new Date("2026-01-01T00:00:00Z");

const txt = (body: string | Buffer): FakeRoute => ({
  body,
  headers: { "content-type": "text/plain" },
});
const html = (body: string): FakeRoute => ({ body: `<html><body>${body}</body></html>` });

function world(
  routes: Record<string, FakeRoute>,
  options: { hosts?: Record<string, string[]>; config?: Partial<ResearchFetchConfig> } = {},
) {
  const dns = fakeResolver({
    "acme.com": [PUBLIC_V4],
    "www.acme.com": [PUBLIC_V4],
    "other.com": [PUBLIC_V4_B],
    ...options.hosts,
  });
  const net = fakeTransport(routes);
  const time = fakeClock();
  const fetcher = createResearchFetcher({
    config: { ...CONFIG, ...options.config },
    resolver: dns.resolver,
    transport: net.transport,
    clock: time.clock,
  });
  return { fetcher, net, time, dns };
}
const requested = (net: { requests: { url: URL }[] }) =>
  net.requests.map((r) => r.url.host + r.url.pathname);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof ResearchFetchError ? error.code : `other: ${String(error)}`;
  }
}

function robotsFile(text: string | Buffer): SafeFetchResult {
  return {
    url: "",
    status: 200,
    contentType: "text/plain",
    charset: null,
    body: Buffer.isBuffer(text) ? text : Buffer.from(text),
    truncated: false,
    redirects: [],
    remoteAddress: "",
    headers: {},
  };
}

// ---------------------------------------------------------------------------------------------------
describe("claim 1: the bot identifies itself as LeadPilotResearchBot/1.0 with a link to the page", () => {
  it("the Netlify page is accepted as RESEARCH_BOT_CONTACT_URL (a public https URL)", () => {
    assert.equal(CONFIG.contactUrl, "https://coruscating-pasca-a9e91e.netlify.app/");
  });

  it("builds exactly 'LeadPilotResearchBot/1.0 (+<the page>)'", () => {
    assert.equal(
      CONFIG.userAgent,
      "LeadPilotResearchBot/1.0 (+https://coruscating-pasca-a9e91e.netlify.app/)",
    );
    assert.ok(CONFIG.userAgent.startsWith(`${BOT_TOKEN}/1.0 (+`));
    assert.equal(BOT_TOKEN, "LeadPilotResearchBot");
  });

  it("is the same with a trailing slash, surrounding spaces or an uppercase host", () => {
    for (const value of [
      `${PAGE}/`,
      `  ${PAGE}  `,
      "https://CORUSCATING-PASCA-A9E91E.netlify.app",
    ]) {
      assert.equal(
        loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: value }).userAgent,
        CONFIG.userAgent,
        JSON.stringify(value),
      );
    }
  });

  it("is plain ASCII with no line breaks, so it is a valid HTTP header value", () => {
    assert.match(CONFIG.userAgent, /^[\x20-\x7e]+$/);
  });

  it("the fetch settings around it keep the documented limits", () => {
    assert.equal(CONFIG.minHostIntervalMs, 2_000);
    assert.equal(CONFIG.maxCrawlDelayMs, 10_000);
    assert.equal(CONFIG.maxRedirects, 5);
    assert.equal(CONFIG.timeoutMs, 15_000);
  });

  it("the page address must be a real public https page: other values are refused", () => {
    for (const value of [
      "http://coruscating-pasca-a9e91e.netlify.app",
      "https://localhost/bot",
      "https://netlify",
    ]) {
      assert.throws(
        () => loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: value }),
        ResearchConfigError,
        value,
      );
    }
  });

  it("every request, including robots.txt, sends that User-Agent", async () => {
    const { fetcher, net } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": html("home"),
      "acme.com/about": html("about"),
    });
    await fetcher.fetchPage("https://acme.com/");
    await fetcher.fetchPage("https://acme.com/about");
    assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/", "acme.com/about"]);
    for (const request of net.requests) assert.equal(request.headers["user-agent"], FULL_UA);
  });

  it("redirect hops identify themselves too", async () => {
    const { fetcher, net } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": { status: 301, headers: { location: "https://www.acme.com/" } },
      "www.acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "www.acme.com/": html("home"),
    });
    await fetcher.fetchPage("https://acme.com/");
    assert.ok(net.requests.length >= 4);
    for (const request of net.requests) assert.equal(request.headers["user-agent"], FULL_UA);
  });

  it("a whole crawl sends it on every request, and nothing identifying the operator beyond the page", async () => {
    const { fetcher, net } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": html('<a href="/about">About us</a><a href="/contact-us">Contact</a>'),
      "acme.com/about": html("about"),
      "acme.com/contact-us": html("contact"),
    });
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.ok(net.requests.length >= 4);
    for (const request of net.requests) assert.equal(request.headers["user-agent"], FULL_UA);
  });
});

// ---------------------------------------------------------------------------------------------------
describe("claim 2: robots.txt is followed, and 'User-agent: LeadPilotResearchBot / Disallow: /' blocks the bot", () => {
  type Case = { name: string; robots: string; blocksUs: boolean };
  const blocked = (name: string, robots: string): Case => ({ name, robots, blocksUs: true });
  const allowed = (name: string, robots: string): Case => ({ name, robots, blocksUs: false });
  const CASES: Case[] = [
    blocked("the group named on the page", OUR_GROUP),
    blocked(
      "lowercase group name (leadpilotresearchbot)",
      "User-agent: leadpilotresearchbot\nDisallow: /\n",
    ),
    blocked("uppercase group name", "User-agent: LEADPILOTRESEARCHBOT\nDisallow: /\n"),
    blocked(
      "group name with a version (LeadPilotResearchBot/1.0)",
      "User-agent: LeadPilotResearchBot/1.0\nDisallow: /\n",
    ),
    blocked("CRLF line endings", "User-agent: LeadPilotResearchBot\r\nDisallow: /\r\n"),
    blocked(
      "one group naming several agents, ours among them",
      "User-agent: SomeoneElse\nUser-agent: LeadPilotResearchBot\nDisallow: /\n",
    ),
    blocked("a '*' group with Disallow: / and no group for us", "User-agent: *\nDisallow: /\n"),
    blocked(
      "our group listed after a '*' group that allows everything",
      "User-agent: *\nAllow: /\n\nUser-agent: LeadPilotResearchBot\nDisallow: /\n",
    ),
    blocked(
      "an inline comment after the agent name",
      "User-agent: LeadPilotResearchBot # our crawler\nDisallow: /\n",
    ),
    blocked(
      "comment lines around the rules",
      "# robots\nUser-agent: LeadPilotResearchBot\n# nothing allowed\nDisallow: /\n",
    ),
    blocked(
      "a blank line between User-agent and Disallow",
      "User-agent: LeadPilotResearchBot\n\nDisallow: /\n",
    ),
    blocked("no space after the colon", "User-agent:LeadPilotResearchBot\nDisallow:/\n"),
    blocked("directive names in capitals", "USER-AGENT: LeadPilotResearchBot\nDISALLOW: /\n"),
    blocked("tabs after the colon", "User-agent:\tLeadPilotResearchBot\nDisallow:\t/\n"),
    blocked("Disallow: /*", "User-agent: LeadPilotResearchBot\nDisallow: /*\n"),
    allowed(
      "a specific Allow group overriding a '*' Disallow",
      "User-agent: *\nDisallow: /\n\nUser-agent: LeadPilotResearchBot\nAllow: /\n",
    ),
    allowed(
      "a specific empty Disallow overriding a '*' Disallow",
      "User-agent: *\nDisallow: /\n\nUser-agent: LeadPilotResearchBot\nDisallow:\n",
    ),
    allowed("a group that only names another bot", "User-agent: SomeoneElse\nDisallow: /\n"),
    allowed(
      "a longer agent name that merely starts with ours (exact names are matched)",
      "User-agent: LeadPilotResearchBotX\nDisallow: /\n",
    ),
    allowed(
      "a shorter name that is a prefix of ours (exact names are matched)",
      "User-agent: LeadPilot\nDisallow: /\n",
    ),
    allowed(
      "only /private blocked: the home page and other pages stay open",
      "User-agent: LeadPilotResearchBot\nDisallow: /private\n",
    ),
    allowed("an empty robots.txt", ""),
    allowed(
      "an HTML page served as robots.txt (no rules in it)",
      "<!doctype html><html><body>Not found</body></html>",
    ),
    allowed("Crawl-delay only", "User-agent: LeadPilotResearchBot\nCrawl-delay: 5\n"),
  ];

  describe("robots-parser@3.0.1 with the bot's real full User-Agent string", () => {
    for (const c of CASES) {
      it(c.name, () => {
        const robot = robotsParser("https://acme.com/robots.txt", c.robots);
        for (const url of ["https://acme.com/", "https://acme.com/about"]) {
          // The code passes the product token; the full string, and any case, must give the same answer.
          const answers = [
            BOT_TOKEN,
            FULL_UA,
            BOT_TOKEN.toLowerCase(),
            BOT_TOKEN.toUpperCase(),
          ].map((ua) => robot.isAllowed(url, ua));
          if (c.name.startsWith("only /private")) {
            assert.deepEqual(answers, [true, true, true, true], url);
          } else {
            assert.deepEqual(new Set(answers).size, 1, `${url}: ${answers.join(",")}`);
            assert.equal(answers[0], !c.blocksUs, `${url}`);
          }
        }
      });
    }

    it("the full User-Agent string reduces to the product token (the part before '/')", () => {
      const robot = robotsParser("https://acme.com/robots.txt", OUR_GROUP);
      assert.equal(robot.isAllowed("https://acme.com/", FULL_UA), false);
      assert.equal(
        robot.isAllowed("https://acme.com/", "SomeOtherBot/2.0 (+https://example.com)"),
        true,
      );
    });

    it("a version-less group is matched by the full string, and 'Allow' beats an equal-length 'Disallow' (standard behaviour)", () => {
      const robot = robotsParser(
        "https://acme.com/robots.txt",
        "User-agent: LeadPilotResearchBot\nAllow: /\nDisallow: /\n",
      );
      assert.equal(robot.isAllowed("https://acme.com/", FULL_UA), true);
    });

    it("Disallow: / followed by a longer Allow opens only that path", () => {
      const robot = robotsParser(
        "https://acme.com/robots.txt",
        "User-agent: LeadPilotResearchBot\nDisallow: /\nAllow: /about\n",
      );
      assert.equal(robot.isAllowed("https://acme.com/", FULL_UA), false);
      assert.equal(robot.isAllowed("https://acme.com/about", FULL_UA), true);
    });
  });

  describe("RobotsCache (the code the worker uses, with the real product token)", () => {
    for (const c of CASES) {
      it(c.name, async () => {
        const robots = new RobotsCache({
          userAgentToken: BOT_TOKEN,
          fetchRobots: async () => robotsFile(c.robots),
        });
        const home = await robots.check(new URL("https://acme.com/"));
        const bare = await robots.check(new URL("https://acme.com"));
        assert.equal(home.allowed, !c.blocksUs);
        assert.equal(bare.allowed, !c.blocksUs);
        if (c.blocksUs) assert.equal(home.reason, "disallowed");
      });
    }

    it("a UTF-8 byte-order mark before the first line does not hide our group", async () => {
      const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(OUR_GROUP)]);
      // the fetcher decodes with TextDecoder, which drops the BOM; RobotsCache receives the raw body
      const robots = new RobotsCache({
        userAgentToken: BOT_TOKEN,
        fetchRobots: async () => robotsFile(body),
      });
      assert.equal((await robots.check(new URL("https://acme.com/"))).allowed, false);
    });

    it("answers for another origin are never 'allowed' by accident", async () => {
      const robots = new RobotsCache({
        userAgentToken: BOT_TOKEN,
        fetchRobots: async () => robotsFile(OUR_GROUP),
      });
      assert.equal((await robots.check(new URL("https://acme.com/x"))).allowed, false);
      assert.equal((await robots.check(new URL("https://acme.com:443/x"))).allowed, false);
    });
  });

  describe("end to end through the real fetcher: a blocked page is never requested", () => {
    it("Disallow: / blocks the home page itself (with and without the trailing slash)", async () => {
      for (const url of [
        "https://acme.com/",
        "https://acme.com",
        "https://acme.com/about",
        "https://acme.com/?x=1",
      ]) {
        const { fetcher, net } = world({
          "acme.com/robots.txt": txt(OUR_GROUP),
          "acme.com/": html("home"),
          "acme.com/about": html("about"),
        });
        assert.equal(await codeOf(fetcher.fetchPage(url)), "robots_disallowed", url);
        assert.deepEqual(requested(net), ["acme.com/robots.txt"], url);
      }
    });

    it("a whole research crawl of a blocking site fails with robots_disallowed and reads nothing", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": txt(OUR_GROUP),
        "acme.com/": html('<a href="/about">About</a>'),
        "acme.com/about": html("about"),
      });
      assert.equal(
        await codeOf(crawlCompanyWebsite("acme.com", fetcher, { now })),
        "robots_disallowed",
      );
      assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
    });

    it("blocking is not retryable: the run fails permanently", async () => {
      const { fetcher } = world({
        "acme.com/robots.txt": txt(OUR_GROUP),
        "acme.com/": html("home"),
      });
      await assert.rejects(
        fetcher.fetchPage("https://acme.com/"),
        (e: unknown) =>
          e instanceof ResearchFetchError &&
          e.code === "robots_disallowed" &&
          e.retryable === false,
      );
    });

    it("the www and apex sites have their own robots.txt", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": txt(OUR_GROUP),
        "www.acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
        "www.acme.com/": html("home"),
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
      assert.equal(await codeOf(fetcher.fetchPage("https://www.acme.com/")), "ok");
      assert.deepEqual(requested(net), [
        "acme.com/robots.txt",
        "www.acme.com/robots.txt",
        "www.acme.com/",
      ]);
    });

    it("pages disallowed individually are skipped with a warning while the rest are read", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": txt("User-agent: LeadPilotResearchBot\nDisallow: /contact-us\n"),
        "acme.com/": html('<a href="/about">About us</a><a href="/contact-us">Contact us</a>'),
        "acme.com/about": html("about"),
        "acme.com/contact-us": html("contact"),
      });
      const crawl = await crawlCompanyWebsite("acme.com", fetcher, { now });
      assert.ok(!requested(net).includes("acme.com/contact-us"));
      assert.ok(crawl.warnings.some((w) => w.code === "page_skipped_robots"));
      assert.equal(crawl.pages.length, 2);
    });

    it("rules are read once per site and kept, not re-fetched for every page", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
        "acme.com/a": html("a"),
        "acme.com/b": html("b"),
        "acme.com/c": html("c"),
      });
      for (const p of ["a", "b", "c"]) await fetcher.fetchPage(`https://acme.com/${p}`);
      assert.equal(requested(net).filter((u) => u.endsWith("/robots.txt")).length, 1);
    });
  });

  describe("when robots.txt cannot be read normally", () => {
    const ok = "ok";

    for (const status of [404, 410, 403, 401, 451, 400]) {
      it(`${status} means 'no robots.txt': the site may be read`, async () => {
        const { fetcher, net } = world({
          "acme.com/robots.txt": { status, body: "nope" },
          "acme.com/": html("home"),
        });
        assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), ok);
        assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/"]);
      });
    }

    for (const status of [500, 502, 503, 504, 521]) {
      it(`${status} means 'could not read the rules': nothing is crawled, and it is retryable`, async () => {
        const { fetcher, net } = world({
          "acme.com/robots.txt": { status },
          "acme.com/": html("home"),
        });
        await assert.rejects(
          fetcher.fetchPage("https://acme.com/"),
          (e: unknown) =>
            e instanceof ResearchFetchError &&
            e.code === "robots_unavailable" &&
            e.retryable === true,
        );
        assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
      });
    }

    it("429 stops the crawl and passes on the site's Retry-After", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": { status: 429, headers: { "retry-after": "120" } },
        "acme.com/": html("home"),
      });
      await assert.rejects(
        fetcher.fetchPage("https://acme.com/"),
        (e: unknown) =>
          e instanceof ResearchFetchError &&
          e.code === "robots_unavailable" &&
          e.retryable &&
          e.retryAfterMs === 120_000,
      );
      assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
    });

    it("a robots.txt that never answers times out: nothing is crawled", async () => {
      const { fetcher, net } = world(
        { "acme.com/robots.txt": { hang: true }, "acme.com/": html("home") },
        { config: { timeoutMs: 40 } },
      );
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
      assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
    });

    it("a robots.txt that stalls half-way times out: nothing is crawled", async () => {
      const { fetcher, net } = world(
        {
          "acme.com/robots.txt": { body: "User-agent: *\n", stallBody: true },
          "acme.com/": html("home"),
        },
        { config: { timeoutMs: 40 } },
      );
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
      assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
    });

    it("an unreachable site is reported as such, not as 'allowed'", async () => {
      const { fetcher } = world({}, { hosts: {} });
      assert.equal(await codeOf(fetcher.fetchPage("https://unknown-site.com/")), "dns_not_found");
    });

    it("a failed read is remembered only briefly, then tried again", async () => {
      let calls = 0;
      const clock = fakeClock();
      const robots = new RobotsCache({
        userAgentToken: BOT_TOKEN,
        now: clock.clock.now,
        fetchRobots: async () => {
          calls++;
          throw new ResearchFetchError("http_status", "503", { status: 503 });
        },
      });
      assert.equal((await robots.check(new URL("https://acme.com/"))).reason, "unavailable");
      assert.equal((await robots.check(new URL("https://acme.com/a"))).reason, "unavailable");
      assert.equal(calls, 1);
      clock.advance(5 * 60 * 1000 + 1);
      await robots.check(new URL("https://acme.com/"));
      assert.equal(calls, 2);
    });
  });

  describe("robots.txt that redirects", () => {
    const RULES_BLOCK = txt(OUR_GROUP);
    const RULES_ALLOW = txt("User-agent: *\nAllow: /\n");

    for (const status of [301, 302, 303, 307, 308]) {
      it(`${status} to a rules file on the same site: those rules apply (blocking)`, async () => {
        const { fetcher, net } = world({
          "acme.com/robots.txt": { status, headers: { location: "/rules.txt" } },
          "acme.com/rules.txt": RULES_BLOCK,
          "acme.com/": html("home"),
        });
        assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
        assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/rules.txt"]);
      });
    }

    it("a redirect to rules that allow us lets the site be read", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": { status: 301, headers: { location: "/rules.txt" } },
        "acme.com/rules.txt": RULES_ALLOW,
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "ok");
      assert.ok(requested(net).includes("acme.com/"));
    });

    it("a redirect to ANOTHER host's robots.txt is followed, and its rules apply", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": {
          status: 301,
          headers: { location: "https://other.com/robots.txt" },
        },
        "other.com/robots.txt": RULES_BLOCK,
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
      assert.ok(!requested(net).includes("acme.com/"));
    });

    it("five redirects are followed", async () => {
      const routes: Record<string, FakeRoute> = {
        "acme.com/robots.txt": { status: 301, headers: { location: "/r1" } },
        "acme.com/r5": RULES_BLOCK,
        "acme.com/": html("home"),
      };
      for (let i = 1; i < 5; i++)
        routes[`acme.com/r${i}`] = { status: 301, headers: { location: `/r${i + 1}` } };
      const { fetcher } = world(routes);
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
    });

    it("six redirects are too many: the rules could not be read, so nothing is crawled", async () => {
      const routes: Record<string, FakeRoute> = {
        "acme.com/robots.txt": { status: 301, headers: { location: "/r1" } },
        "acme.com/r6": RULES_ALLOW,
        "acme.com/": html("home"),
      };
      for (let i = 1; i < 6; i++)
        routes[`acme.com/r${i}`] = { status: 301, headers: { location: `/r${i + 1}` } };
      const { fetcher, net } = world(routes);
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
      assert.ok(!requested(net).includes("acme.com/"));
    });

    it("a redirect loop is 'could not read': nothing is crawled", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": { status: 301, headers: { location: "/robots.txt" } },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
      assert.ok(!requested(net).includes("acme.com/"));
    });

    it("a redirect from https to plain http is refused: nothing is crawled", async () => {
      const { fetcher, net } = world({
        "acme.com/robots.txt": { status: 301, headers: { location: "http://acme.com/robots.txt" } },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
      assert.ok(!requested(net).includes("acme.com/"));
    });

    it("a redirect without a location, or to a non-web address, is 'could not read'", async () => {
      const variants: Record<string, string>[] = [
        {},
        { location: "ftp://acme.com/robots.txt" },
        { location: "javascript:alert(1)" },
      ];
      for (const headers of variants) {
        const { fetcher, net } = world({
          "acme.com/robots.txt": { status: 301, headers },
          "acme.com/": html("home"),
        });
        assert.equal(
          await codeOf(fetcher.fetchPage("https://acme.com/")),
          "robots_unavailable",
          JSON.stringify(headers),
        );
        assert.ok(!requested(net).includes("acme.com/"));
      }
    });

    it("a redirect to a private network address is refused outright, never contacted", async () => {
      const { fetcher, net, dns } = world(
        {
          "acme.com/robots.txt": {
            status: 301,
            headers: { location: "https://internal.example.com/robots.txt" },
          },
          "acme.com/": html("home"),
        },
        { hosts: { "internal.example.com": ["10.1.2.3"] } },
      );
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "blocked_address");
      assert.ok(dns.calls.includes("internal.example.com"));
      assert.deepEqual(requested(net), ["acme.com/robots.txt"]);
    });

    it("a redirect to a missing file means 'no robots.txt' (a 4xx), as for a missing file", async () => {
      const { fetcher } = world({
        "acme.com/robots.txt": { status: 301, headers: { location: "/gone" } },
        "acme.com/gone": { status: 404 },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "ok");
    });

    it("a redirect to a server error means 'could not read': nothing is crawled", async () => {
      const { fetcher } = world({
        "acme.com/robots.txt": { status: 301, headers: { location: "/broken" } },
        "acme.com/broken": { status: 503 },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_unavailable");
    });
  });

  describe("what is read from robots.txt", () => {
    it("only the first 500 KiB: rules inside it apply", async () => {
      const filler = "# padding\n".repeat(60_000); // ~600 KB
      const { fetcher } = world({
        "acme.com/robots.txt": txt(OUR_GROUP + filler),
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
      assert.equal(ROBOTS_MAX_BYTES, 500 * 1024);
    });

    it("... and rules beyond it are ignored (the same limit Google uses)", async () => {
      const filler = "# padding\n".repeat(60_000);
      const { fetcher } = world({
        "acme.com/robots.txt": txt(filler + OUR_GROUP),
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "ok");
    });

    it("a UTF-8 byte-order mark in the file is ignored by the decoder", async () => {
      const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(OUR_GROUP)]);
      const { fetcher } = world({ "acme.com/robots.txt": txt(body), "acme.com/": html("home") });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
    });

    it("any content type is accepted for robots.txt (soft-404 HTML simply has no rules)", async () => {
      const { fetcher } = world({
        "acme.com/robots.txt": {
          body: "<html>hi</html>",
          headers: { "content-type": "text/html" },
        },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "ok");
    });

    it("a gzip-encoded robots.txt is decoded before the rules are read", async () => {
      const { gzipSync } = await import("node:zlib");
      const { fetcher } = world({
        "acme.com/robots.txt": {
          body: gzipSync(Buffer.from(OUR_GROUP)),
          headers: { "content-type": "text/plain", "content-encoding": "gzip" },
        },
        "acme.com/": html("home"),
      });
      assert.equal(await codeOf(fetcher.fetchPage("https://acme.com/")), "robots_disallowed");
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe("claim 3: at most six public pages per visit, at a limited rate", () => {
  const manyLinks = [
    ...["contact", "contact-us"].map((p) => [p, "Contact"] as const),
    ...["about", "about-us"].map((p) => [p, "About"] as const),
    ...["services", "services/web"].map((p) => [p, "Services"] as const),
    ...["products", "shop"].map((p) => [p, "Products"] as const),
    ...["locations", "service-areas"].map((p) => [p, "Locations"] as const),
    ...Array.from({ length: 30 }, (_, i) => [`services/item-${i}`, `Service ${i}`] as const),
  ];
  const site = (robots = "User-agent: *\nAllow: /\n") => {
    const routes: Record<string, FakeRoute> = {
      "acme.com/robots.txt": txt(robots),
      "acme.com/": html(manyLinks.map(([p, t]) => `<a href="/${p}">${t}</a>`).join(" ")),
    };
    for (const [p] of manyLinks) routes[`acme.com/${p}`] = html(`<h1>${p}</h1>`);
    return world(routes);
  };

  it("the default limits are six pages in total, two per type", () => {
    assert.deepEqual({ ...DEFAULT_CRAWL }, { maxPages: 6, maxPerType: 2, deadlineMs: 120_000 });
  });

  it("a site with dozens of pages still gives six: the home page plus five", async () => {
    const { fetcher, net } = site();
    const crawl = await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.equal(crawl.pages.length, 6);
    const pageRequests = net.requests.filter((r) => r.url.pathname !== "/robots.txt");
    assert.equal(pageRequests.length, 6);
  });

  it("the only extra request is robots.txt, once per site", async () => {
    const { fetcher, net } = site();
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.equal(net.requests.length, 7);
    assert.equal(net.requests.filter((r) => r.url.pathname === "/robots.txt").length, 1);
  });

  it("the full research pipeline stays inside the same six pages", async () => {
    const { fetcher, net } = site();
    const result = await researchCompanyWebsite(
      "acme.com",
      fetcher,
      { companyName: "Acme" },
      { now },
    );
    assert.ok(result.pages.length <= 6);
    assert.equal(
      net.requests.filter((r) => r.url.pathname !== "/robots.txt").length,
      result.pages.length,
    );
  });

  it("requests are spaced: at least two seconds between any two to the same site", async () => {
    const { fetcher, net, time } = site();
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.equal(time.sleeps.length, net.requests.length - 1);
    assert.ok(
      time.sleeps.every((ms) => ms >= 2_000),
      JSON.stringify(time.sleeps),
    );
    assert.equal(DEFAULT_FETCH_LIMITS.minHostIntervalMs, 2_000);
  });

  it("the site's Crawl-delay slows the bot further, up to a ten-second cap", async () => {
    const slow = site("User-agent: *\nCrawl-delay: 4\n");
    await crawlCompanyWebsite("acme.com", slow.fetcher, { now });
    assert.ok(
      slow.time.sleeps.slice(1).every((ms) => ms === 4_000),
      JSON.stringify(slow.time.sleeps),
    );
    const capped = site("User-agent: LeadPilotResearchBot\nCrawl-delay: 600\n");
    await crawlCompanyWebsite("acme.com", capped.fetcher, { now });
    assert.ok(
      capped.time.sleeps.slice(1).every((ms) => ms === 10_000),
      JSON.stringify(capped.time.sleeps),
    );
  });

  it("one request at a time per site, never in parallel", async () => {
    const { fetcher } = site();
    let active = 0;
    let max = 0;
    const original = fetcher.fetchPage;
    const spy = {
      fetchPage: async (...args: Parameters<typeof original>) => {
        active++;
        max = Math.max(max, active);
        try {
          return await original(...args);
        } finally {
          active--;
        }
      },
    };
    await crawlCompanyWebsite("acme.com", spy, { now });
    assert.equal(max, 1);
  });

  it("every page is fetched from the company's own site (including a www redirect)", async () => {
    const { fetcher, net } = site();
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.ok(net.requests.every((r) => r.url.host === "acme.com"));
  });
});

// ---------------------------------------------------------------------------------------------------
describe("claim 4: no log-in, no forms, no scripts, no non-public content", () => {
  const HOME = `
    <a href="/about">About us</a><a href="/contact-us">Contact us</a>
    <a href="/login">Log in</a><a href="/sign-in">Sign in</a><a href="/register">Register</a>
    <a href="/my-account">My account</a><a href="/account/orders">Orders</a><a href="/cart">Cart</a>
    <a href="/checkout">Checkout</a><a href="/admin">Admin</a><a href="/wp-admin/">WP admin</a>
    <a href="/wp-login.php">WP login</a><a href="/search?q=plumber">Search</a>
    <form action="/subscribe" method="post"><input name="email"><button>Join</button></form>
    <script src="/assets/app.js"></script>
    <script>fetch('/tracking/beacon'); document.location = '/redirected-by-script';</script>
    <script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme"}</script>
    <link rel="stylesheet" href="/assets/site.css"><img src="/pixel.gif">
    <iframe src="https://widget.example.com/embed"></iframe>
    <noscript><a href="/noscript-page">No JavaScript</a></noscript>
    <meta http-equiv="refresh" content="0; url=/meta-refresh">`;
  const routes = (): Record<string, FakeRoute> => ({
    "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
    "acme.com/": html(HOME),
    "acme.com/about": html("about"),
    "acme.com/contact-us": html("contact"),
  });

  it("only the company's own public pages are requested: no login, account, cart, admin or search pages", async () => {
    const { fetcher, net } = world(routes());
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    // (the crawl takes one page per type in turn, contact first, so compare as a set)
    assert.deepEqual(
      requested(net).sort(),
      ["acme.com/", "acme.com/about", "acme.com/contact-us", "acme.com/robots.txt"].sort(),
    );
  });

  it("a page inside a login, account, cart, checkout, admin or search area is skipped even if it sounds like a business page", async () => {
    const guarded = [
      "login/contact-us",
      "sign-in/about",
      "signin/services",
      "register/products",
      "account/contact-us",
      "my-account/about",
      "cart/shop",
      "checkout/products",
      "admin/services",
      "wp-admin/about",
      "search/locations",
      "feed/about",
    ];
    const r = routes();
    r["acme.com/"] = html(
      guarded.map((p) => `<a href="/${p}">${p.split("/")[1].replace("-", " ")}</a>`).join(" ") +
        '<a href="/about">About us</a>',
    );
    for (const p of guarded) r[`acme.com/${p}`] = html("private area");
    const { fetcher, net } = world(r);
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    // only the ordinary public page is read
    assert.deepEqual(requested(net).sort(), ["acme.com/", "acme.com/about", "acme.com/robots.txt"]);
  });

  it("forms are never submitted: the form's action address is never requested", async () => {
    const { fetcher, net } = world(routes());
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.ok(!requested(net).join(" ").includes("/subscribe"));
  });

  it("a link that happens to sit inside a form is an ordinary link (a plain GET), never a form submission", async () => {
    const r = routes();
    r["acme.com/"] = html(
      '<form action="/subscribe" method="post"><input name="email"><a href="/in-form/contact-us">Contact us</a></form>',
    );
    r["acme.com/in-form/contact-us"] = html("contact");
    const { fetcher, net } = world(r);
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.deepEqual(requested(net), [
      "acme.com/robots.txt",
      "acme.com/",
      "acme.com/in-form/contact-us",
    ]);
    assert.ok(!requested(net).join(" ").includes("/subscribe"));
  });

  it("scripts are never run or even downloaded: nothing a script or tag would load is requested", async () => {
    const { fetcher, net } = world(routes());
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    const all = requested(net).join(" ");
    for (const never of [
      "app.js",
      "tracking",
      "redirected-by-script",
      "site.css",
      "pixel.gif",
      "widget.example.com",
      "noscript-page",
      "meta-refresh",
    ]) {
      assert.ok(!all.includes(never), never);
    }
  });

  it("a page that needs JavaScript is only reported as such: its content is not rendered", async () => {
    const { fetcher } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": {
        body: '<html><body><div id="app"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script><noscript>Please enable JavaScript</noscript></body></html>',
      },
    });
    const crawl = await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.ok(crawl.warnings.some((w) => w.code === "page_needs_javascript"));
  });

  it("every request is a plain anonymous GET: no cookies, no credentials, no referrer", async () => {
    const { fetcher, net } = world(routes());
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    for (const request of net.requests) {
      assert.deepEqual(Object.keys(request.headers).sort(), [
        "accept",
        "accept-encoding",
        "accept-language",
        "user-agent",
      ]);
    }
  });

  it("a web address with a user name or password is refused before any request", async () => {
    const { fetcher, net } = world(routes());
    assert.equal(
      await codeOf(crawlCompanyWebsite("https://user:secret@acme.com/", fetcher, { now })),
      "invalid_url",
    );
    assert.equal(net.requests.length, 0);
  });

  it("pages that need a login (401 / 403) are not read; the research continues without them", async () => {
    for (const status of [401, 403]) {
      const r = routes();
      r["acme.com/contact-us"] = { status };
      const { fetcher } = world(r);
      const crawl = await crawlCompanyWebsite("acme.com", fetcher, { now });
      assert.equal(crawl.pages.length, 2, String(status));
      assert.ok(
        crawl.warnings.some((w) => w.code === "page_failed" && w.url?.endsWith("/contact-us")),
        String(status),
      );
    }
  });

  it("a home page that needs a login stops the research with an http_status error", async () => {
    const r = routes();
    r["acme.com/"] = { status: 401 };
    const { fetcher } = world(r);
    assert.equal(await codeOf(crawlCompanyWebsite("acme.com", fetcher, { now })), "http_status");
  });

  it("private networks, local names, IP addresses and unusual ports are refused before any request", async () => {
    for (const website of [
      "http://localhost/",
      "http://127.0.0.1/",
      "https://192.168.1.1/",
      "https://[::1]/",
      "https://acme.com:8443/",
      "https://intranet.local/",
      "https://printer.internal/",
    ]) {
      const { fetcher, net } = world(routes());
      assert.notEqual(await codeOf(crawlCompanyWebsite(website, fetcher, { now })), "ok", website);
      assert.equal(net.requests.length, 0, website);
    }
  });

  it("a name that resolves to a private address is never connected to", async () => {
    const { fetcher, net } = world(
      { "intranet-lookalike.com/": html("secret") },
      { hosts: { "intranet-lookalike.com": ["192.168.0.10"] } },
    );
    assert.equal(
      await codeOf(crawlCompanyWebsite("intranet-lookalike.com", fetcher, { now })),
      "blocked_address",
    );
    assert.equal(net.requests.length, 0);
  });

  describe("source guard: the engine has no way to log in, submit, or execute", () => {
    const dirs = ["../../src/features/research/engine/", "../../src/features/research/worker/"];
    const files = dirs.flatMap((dir) => {
      const base = new URL(dir, import.meta.url);
      const walk = (url: URL): URL[] =>
        readdirSync(url, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(new URL(`${entry.name}/`, url))
            : entry.name.endsWith(".ts")
              ? [new URL(entry.name, url)]
              : [],
        );
      return walk(base).map((url) => ({
        name: url.pathname.split("/").slice(-2).join("/"),
        text: readFileSync(url, "utf8"),
      }));
    });
    const code = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    it("finds the engine and worker sources", () =>
      assert.ok(files.length > 20, String(files.length)));

    it("the only HTTP method used anywhere is GET", () => {
      // (the extractors also have a field called "method"; it holds labels such as "page-text", not verbs)
      const verbs = /\bmethod\s*:\s*["'`](POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)["'`]/i;
      assert.deepEqual(
        files.filter((f) => verbs.test(code(f.text))).map((f) => f.name),
        [],
      );
      // ... and the one place a request is made states GET explicitly
      assert.deepEqual(
        files.filter((f) => /method:\s*"GET"/.test(f.text)).map((f) => f.name),
        ["net/transport.ts"],
      );
      // No outbound verb names anywhere in the engine. (worker/handler.ts is excluded: it is the worker's own
      // INBOUND endpoint and checks that its caller used POST; it makes no outbound request.)
      assert.deepEqual(
        files
          .filter((f) => !f.name.startsWith("worker/"))
          .filter((f) => /["'`](POST|PUT|PATCH|DELETE)["'`]/.test(code(f.text)))
          .map((f) => f.name),
        [],
      );
    });

    it("no cookies or credentials are ever attached to a request", () => {
      const hits = files
        .filter((f) =>
          /["'`](cookie|authorization|proxy-authorization|referer|origin)["'`]\s*:/i.test(
            code(f.text),
          ),
        )
        .map((f) => f.name);
      assert.deepEqual(hits, []);
    });

    it("no script engine, browser or DOM implementation is imported", () => {
      const pattern =
        /\beval\s*\(|new Function\s*\(|["']node:vm["']|vm2|isolated-vm|["']node:child_process["']|puppeteer|playwright|jsdom|cheerio|happy-dom/;
      assert.deepEqual(
        files.filter((f) => pattern.test(code(f.text))).map((f) => f.name),
        [],
      );
    });

    it("only one file opens network connections", () => {
      // A file can only connect if it imports a networking module (or uses fetch / WebSocket).
      const importsNetworking =
        /from\s+["']node:(https?|net|tls|http2|dgram)["']|\bfetch\s*\(|new WebSocket|XMLHttpRequest/;
      const hits = files.filter((f) => importsNetworking.test(code(f.text))).map((f) => f.name);
      // ip-policy.ts and target-url.ts import only node:net's BlockList / isIP, to CHECK addresses.
      assert.deepEqual(hits.sort(), ["net/ip-policy.ts", "net/target-url.ts", "net/transport.ts"]);
      // ... and the only file that opens a connection is transport.ts
      const opens = files.filter(
        (f) =>
          /from\s+["']node:(https?|tls|http2|dgram)["']/.test(code(f.text)) ||
          /\.(connect|createConnection)\(/.test(code(f.text)),
      );
      assert.deepEqual(
        opens.map((f) => f.name),
        ["net/transport.ts"],
      );
    });

    it("form fields are never read: only <a href> links become crawl candidates", () => {
      const html = files.find((f) => f.name === "extract/html.ts")?.text ?? "";
      assert.ok(/name === "a"/.test(html));
      assert.ok(!/action|formaction|\.submit|onsubmit/i.test(code(html)));
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe("claim 5: no crawling of search engines or social media platforms (links found on a company's site, and a start address that is one)", () => {
  const SOCIAL_AND_SEARCH = [
    "https://facebook.com/acme",
    "https://www.facebook.com/acme/about",
    "https://www.instagram.com/acme/",
    "https://www.linkedin.com/company/acme/about",
    "https://twitter.com/acme",
    "https://x.com/acme",
    "https://www.youtube.com/@acme",
    "https://www.tiktok.com/@acme",
    "https://www.pinterest.com/acme/",
    "https://wa.me/15551234567",
    "https://t.me/acme",
    "https://www.google.com/search?q=acme",
    "https://www.google.com/maps/place/acme",
    "https://www.bing.com/search?q=acme",
    "https://duckduckgo.com/?q=acme",
    "https://www.yelp.com/biz/acme",
    "https://www.tripadvisor.com/Hotel_Review-acme",
  ];
  const links = SOCIAL_AND_SEARCH.map(
    (href) => `<a href="${href}">Contact us on ${new URL(href).host}</a>`,
  ).join("");
  const routes = (): Record<string, FakeRoute> => ({
    "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
    "acme.com/": html(`<a href="/about">About</a>${links}<footer>${links}</footer>`),
    "acme.com/about": html("about"),
  });

  it("links to social networks and search engines are never requested, and their addresses are never even looked up", async () => {
    const { fetcher, net, dns } = world(routes());
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/", "acme.com/about"]);
    assert.deepEqual([...new Set(dns.calls)], ["acme.com"]);
  });

  it("a start address that IS a social network, search engine or map page is refused before any lookup or request", async () => {
    for (const href of SOCIAL_AND_SEARCH) {
      for (const start of [href, href.replace("https://", "")]) {
        const { fetcher, net, dns } = world({});
        assert.equal(
          await codeOf(crawlCompanyWebsite(start, fetcher, { now })),
          "invalid_url",
          start,
        );
        assert.deepEqual(requested(net), [], start);
        assert.deepEqual(dns.calls, [], start);
      }
    }
  });

  it("... and the dashboard's eligibility check refuses the same addresses", () => {
    for (const href of SOCIAL_AND_SEARCH) {
      const result = researchEligibility({ website: href, suppressed: false });
      assert.equal(!result.eligible && result.reason, "not_company_website", href);
    }
  });

  it("... even when the link text looks like a page the bot would want (Contact us, About us)", async () => {
    const { fetcher, net } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": html(
        '<a href="https://facebook.com/acme/contact">Contact us</a><a href="https://www.linkedin.com/company/acme/about">About us</a>',
      ),
    });
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/"]);
  });

  it("a company home page that redirects to a social network or search engine is not followed, nor contacted", async () => {
    for (const target of [
      "https://www.facebook.com/acme",
      "https://www.instagram.com/acme/",
      "https://www.google.com/search?q=acme",
      "https://www.bing.com/",
    ]) {
      const { fetcher, net, dns } = world({
        "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
        "acme.com/": { status: 302, headers: { location: target } },
      });
      assert.equal(
        await codeOf(crawlCompanyWebsite("acme.com", fetcher, { now })),
        "outside_boundary",
        target,
      );
      assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/"], target);
      assert.deepEqual([...new Set(dns.calls)], ["acme.com"], target);
    }
  });

  it("a page on the company's site that redirects to a social network is skipped with a warning", async () => {
    const { fetcher, net, dns } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": html('<a href="/about">About us</a><a href="/contact-us">Contact us</a>'),
      "acme.com/about": html("about"),
      "acme.com/contact-us": {
        status: 301,
        headers: { location: "https://www.facebook.com/acme" },
      },
    });
    const crawl = await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.ok(crawl.warnings.some((w) => w.code === "page_skipped_offsite"));
    assert.ok(!requested(net).some((u) => u.includes("facebook")));
    assert.deepEqual([...new Set(dns.calls)], ["acme.com"]);
  });

  it("social profiles found on the site are recorded as findings (as links), without visiting them", async () => {
    const { fetcher, net } = world({
      "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
      "acme.com/": html(
        '<h1>Acme</h1><p>We fix things.</p><footer><a href="https://www.facebook.com/acme">Facebook</a> <a href="https://www.instagram.com/acme/">Instagram</a></footer>',
      ),
    });
    const result = await researchCompanyWebsite(
      "acme.com",
      fetcher,
      { companyName: "Acme" },
      { now },
    );
    const social = result.extraction.findings.filter((f) => f.category === "social_profile");
    assert.ok(social.length >= 1, "no social profile finding was recorded");
    assert.ok(social.some((f) => /facebook\.com|instagram\.com/.test(f.value)));
    assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/"]);
  });

  it("the boundary is the company's own domain: a look-alike that merely contains it is outside", async () => {
    const { fetcher, net } = world(
      {
        "acme.com/robots.txt": txt("User-agent: *\nAllow: /\n"),
        "acme.com/": html(
          '<a href="https://acme.com.evil.example/contact-us">Contact us</a><a href="https://notacme.com/about">About us</a><a href="https://facebook.com/acme.com">About us</a>',
        ),
      },
      { hosts: {} },
    );
    await crawlCompanyWebsite("acme.com", fetcher, { now });
    assert.deepEqual(requested(net), ["acme.com/robots.txt", "acme.com/"]);
  });
});
