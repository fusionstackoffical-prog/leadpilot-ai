import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { HostRateLimiter } from "../../src/features/research/engine/net/host-limiter.ts";
import { RobotsCache } from "../../src/features/research/engine/net/robots.ts";
import type { SafeFetchResult } from "../../src/features/research/engine/net/safe-fetch.ts";
import { fakeClock } from "./net-fakes.ts";

const TOKEN = "LeadPilotResearchBot";

function robotsFile(text: string): SafeFetchResult {
  return {
    url: "",
    status: 200,
    contentType: "text/plain",
    charset: null,
    body: Buffer.from(text),
    truncated: false,
    redirects: [],
    remoteAddress: "",
    headers: {},
  };
}

function cache(
  responder: (url: URL) => SafeFetchResult | Error,
  options: { now?: () => number } = {},
) {
  const fetched: string[] = [];
  const robots = new RobotsCache({
    userAgentToken: TOKEN,
    now: options.now,
    fetchRobots: async (url) => {
      fetched.push(url.href);
      const r = responder(url);
      if (r instanceof Error) throw r;
      return r;
    },
  });
  return { robots, fetched };
}

const u = (s: string) => new URL(s);

describe("RobotsCache", () => {
  it("applies rules for our bot, falling back to *", async () => {
    const { robots } = cache(() =>
      robotsFile(
        [
          "User-agent: *",
          "Disallow: /",
          "",
          `User-agent: ${TOKEN}`,
          "Disallow: /private",
          "Allow: /",
        ].join("\n"),
      ),
    );
    assert.equal((await robots.check(u("https://acme.com/about"))).allowed, true);
    assert.equal((await robots.check(u("https://acme.com/private/x"))).allowed, false);
    assert.equal((await robots.check(u("https://acme.com/private/x"))).reason, "disallowed");
  });

  it("obeys a blanket disallow for all bots", async () => {
    const { robots } = cache(() => robotsFile("User-agent: *\nDisallow: /\n"));
    assert.equal((await robots.check(u("https://acme.com/"))).allowed, false);
  });

  it("reads Crawl-delay for our bot and caps it at 10 s", async () => {
    const { robots } = cache((url) =>
      robotsFile(
        url.host === "slow.com"
          ? "User-agent: *\nCrawl-delay: 60\n"
          : "User-agent: *\nCrawl-delay: 3\n",
      ),
    );
    assert.equal((await robots.check(u("https://acme.com/"))).crawlDelayMs, 3_000);
    assert.equal((await robots.check(u("https://slow.com/"))).crawlDelayMs, 10_000);
  });

  it("allows everything when robots.txt is missing (4xx)", async () => {
    for (const status of [404, 403, 410]) {
      const { robots } = cache(() => new ResearchFetchError("http_status", "x", { status }));
      const d = await robots.check(u("https://acme.com/anything"));
      assert.equal(d.allowed, true, String(status));
      assert.equal(d.reason, "no_robots_file");
    }
  });

  it("crawls nothing when robots.txt cannot be read (429, 5xx, timeouts)", async () => {
    const failures = [
      new ResearchFetchError("http_status", "x", { status: 429, retryable: true }),
      new ResearchFetchError("http_status", "x", { status: 503, retryable: true }),
      new ResearchFetchError("timeout", "x"),
      new ResearchFetchError("connection_failed", "x"),
    ];
    for (const failure of failures) {
      const { robots } = cache(() => failure);
      const d = await robots.check(u("https://acme.com/"));
      assert.equal(d.allowed, false, failure.code);
      assert.equal(d.reason, "unavailable");
    }
  });

  it("rethrows when the site itself cannot be reached", async () => {
    const { robots } = cache(() => new ResearchFetchError("dns_not_found", "no such domain"));
    await assert.rejects(
      robots.check(u("https://gone.com/")),
      (e: ResearchFetchError) => e.code === "dns_not_found",
    );
  });

  it("fetches robots.txt once per origin, even for concurrent checks", async () => {
    const { robots, fetched } = cache(() => robotsFile("User-agent: *\nAllow: /\n"));
    await Promise.all([
      robots.check(u("https://acme.com/a")),
      robots.check(u("https://acme.com/b")),
      robots.check(u("https://acme.com/c")),
    ]);
    await robots.check(u("https://www.acme.com/a"));
    assert.deepEqual(fetched, ["https://acme.com/robots.txt", "https://www.acme.com/robots.txt"]);
  });

  it("refreshes after the TTL, and retries failed reads sooner", async () => {
    const clock = fakeClock();
    let fail = true;
    const { robots, fetched } = cache(
      () =>
        fail ? new ResearchFetchError("timeout", "x") : robotsFile("User-agent: *\nAllow: /\n"),
      { now: clock.clock.now },
    );
    assert.equal((await robots.check(u("https://acme.com/"))).reason, "unavailable");
    fail = false;
    clock.advance(60_000);
    assert.equal((await robots.check(u("https://acme.com/"))).reason, "unavailable"); // still cached
    clock.advance(5 * 60_000);
    assert.equal((await robots.check(u("https://acme.com/"))).allowed, true);
    clock.advance(23 * 60 * 60_000);
    await robots.check(u("https://acme.com/"));
    clock.advance(2 * 60 * 60_000);
    await robots.check(u("https://acme.com/"));
    assert.equal(fetched.length, 3);
  });

  it("never fetches robots.txt to check robots.txt itself", async () => {
    const { robots, fetched } = cache(() => robotsFile("User-agent: *\nDisallow: /\n"));
    assert.equal((await robots.check(u("https://acme.com/robots.txt"))).allowed, true);
    assert.equal(fetched.length, 0);
  });
});

describe("HostRateLimiter", () => {
  it("spaces requests to the same host by at least 2 s", async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = new HostRateLimiter({ clock });
    const starts: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() => limiter.run("acme.com", async () => starts.push(clock.now()))),
    );
    assert.deepEqual(
      starts.map((s) => s - starts[0]),
      [0, 2_000, 4_000],
    );
    assert.deepEqual(sleeps, [2_000, 2_000]);
  });

  it("runs one request at a time per host", async () => {
    const limiter = new HostRateLimiter({ minIntervalMs: 0 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.run("acme.com", async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    assert.equal(peak, 1);
  });

  it("does not delay different hosts", async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = new HostRateLimiter({ clock });
    await Promise.all(["a.com", "b.com", "c.com"].map((h) => limiter.run(h, async () => {})));
    assert.deepEqual(sleeps, []);
  });

  it("honours Crawl-delay up to the cap", async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = new HostRateLimiter({ clock });
    await limiter.run("acme.com", async () => {}, 5_000);
    await limiter.run("acme.com", async () => {}, 5_000);
    await limiter.run("acme.com", async () => {}, 60_000);
    await limiter.run("acme.com", async () => {});
    assert.deepEqual(sleeps, [5_000, 5_000, 10_000]);
    assert.equal(limiter.intervalFor(0), 2_000);
  });

  it("releases the host after a failed request", async () => {
    const { clock } = fakeClock();
    const limiter = new HostRateLimiter({ clock });
    await assert.rejects(
      limiter.run("acme.com", async () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    assert.equal(await limiter.run("acme.com", async () => "next"), "next");
  });
});
