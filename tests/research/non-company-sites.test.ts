// Social network, search engine and map pages are never a company's own website. Enforced twice:
// the dashboard (researchEligibility) explains it, and the crawl start URL (startUrl) is the real
// refusal. Neither layer resolves DNS or requests anything. No network, no real company.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadResearchFetchConfig } from "../../src/features/research/engine/config.ts";
import { crawlCompanyWebsite, startUrl } from "../../src/features/research/engine/extract/crawl.ts";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { createResearchFetcher } from "../../src/features/research/engine/net/fetcher.ts";
import {
  NON_COMPANY_DOMAINS,
  nonCompanySite,
} from "../../src/features/research/engine/net/non-company-sites.ts";
import {
  INVALID_WEBSITE_MESSAGE,
  NOT_COMPANY_WEBSITE_MESSAGE,
  researchEligibility,
} from "../../src/features/research/eligibility.ts";
import { processRun } from "../../src/features/research/worker/process-run.ts";
import { fakeClock, fakeResolver, fakeTransport, PUBLIC_V4 } from "./net-fakes.ts";
import { fakeRepo, manualScheduler, realFetcher } from "./worker-fakes.ts";

const CONFIG = loadResearchFetchConfig({
  RESEARCH_BOT_CONTACT_URL: "https://coruscating-pasca-a9e91e.netlify.app",
});

const SOCIAL = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "threads.net",
  "snapchat.com",
  "reddit.com",
  "wa.me",
  "t.me",
  "yelp.com",
  "tripadvisor.com",
];
const SEARCH = [
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "yandex.com",
  "yandex.ru",
  "baidu.com",
];
const MAPS = ["maps.app.goo.gl", "g.page"];
const GOOGLE_COUNTRIES = [
  "google.com",
  "google.co.uk",
  "google.com.au",
  "google.co.in",
  "google.de",
  "google.fr",
  "google.ae",
  "google.com.pk",
  "google.co.za",
  "google.ca",
  "google.com.br",
  "google.co.jp",
];
const SUBS = ["", "www.", "m.", "business."];

const sample = (host: string, path = "/acme") => `https://${host}${path}`;
/** Subdomain prefixes that make sense for a host (the "search." hosts have no "business." form). */
const subsFor = (host: string) =>
  SUBS.filter((s) => !(s === "business." && host.startsWith("search.")));

function world() {
  const dns = fakeResolver({ "acme.com": [PUBLIC_V4] });
  const net = fakeTransport({});
  const fetcher = createResearchFetcher({
    config: { ...CONFIG, minHostIntervalMs: 0 },
    resolver: dns.resolver,
    transport: net.transport,
    clock: fakeClock().clock,
  });
  return { dns, net, fetcher };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e instanceof ResearchFetchError ? e.code : `other:${String(e)}`;
  }
  return "none";
}

const denied = [
  ...new Set([...SOCIAL, ...SEARCH, ...MAPS, ...GOOGLE_COUNTRIES, ...NON_COMPANY_DOMAINS]),
];
const allowed = [
  "notfacebook.com",
  "facebook.com.example.org",
  "mygoogle.com",
  "box.com",
  "bing.com.evil.org",
  "redditor.com",
  "googleapis.com",
  "google.evil",
  "google.com.evil.org",
  "fbi.com",
  "sites.google.com",
  "docs.google.com",
  "yahoo.com",
  "mail.yahoo.com",
  "goo.gl.example.org",
  "facebook.co",
  "my-instagram.com",
  "acme.com",
  "www.acme.com",
  "acme-bakery.co.uk",
  "googlefacebook.com",
  "facebookcom.example.com",
  "t.company.com",
  "wa.me.evil.net",
];

describe("deny-list matching rule", () => {
  for (const host of denied) {
    it(`matches ${host} and its subdomains`, () => {
      for (const sub of subsFor(host)) {
        assert.ok(nonCompanySite(new URL(sample(sub + host))), `${sub}${host} should be refused`);
      }
    });
  }

  it("matches a trailing-dot host and any letter case", () => {
    assert.ok(nonCompanySite(new URL("https://WWW.Facebook.COM./acme")));
    assert.ok(nonCompanySite(new URL("https://www.google.co.uk./search?q=x")));
  });

  it("matches every google country domain for search and maps hosts only", () => {
    for (const country of GOOGLE_COUNTRIES) {
      for (const sub of ["", "www.", "maps.", "m.", "encrypted.", "business."]) {
        assert.ok(nonCompanySite(new URL(sample(sub + country))), `${sub}${country}`);
      }
      assert.equal(nonCompanySite(new URL(sample(`sites.${country}`))), null, `sites.${country}`);
    }
  });

  it("refuses goo.gl/maps links but not other goo.gl short links", () => {
    assert.ok(nonCompanySite(new URL("https://goo.gl/maps/abc123")));
    assert.equal(nonCompanySite(new URL("https://goo.gl/abc123")), null);
    assert.equal(nonCompanySite(new URL("https://goo.gl/mapsfoo")), null);
  });

  for (const host of allowed) {
    it(`does not match ${host}`, () => {
      assert.equal(nonCompanySite(new URL(sample(host))), null);
    });
  }

  it("reports the kind", () => {
    assert.equal(nonCompanySite(new URL("https://www.facebook.com/x"))?.kind, "social");
    assert.equal(nonCompanySite(new URL("https://www.bing.com/search"))?.kind, "search");
    assert.equal(nonCompanySite(new URL("https://maps.app.goo.gl/x"))?.kind, "map");
    assert.equal(nonCompanySite(new URL("https://www.yelp.com/biz/x"))?.kind, "listing");
  });
});

describe("dashboard layer: researchEligibility", () => {
  it("explains that the value is not the company's own website", () => {
    const result = researchEligibility({ website: "facebook.com/mybakery", suppressed: false });
    assert.deepEqual(result, {
      eligible: false,
      reason: "not_company_website",
      message: NOT_COMPANY_WEBSITE_MESSAGE,
    });
    assert.equal(
      NOT_COMPANY_WEBSITE_MESSAGE,
      "This website value looks like a social media, review, search or map page, not the company's own website. Research only reads a company's own website, so replace it with the company's own web address, such as example.com.",
    );
  });

  for (const host of denied) {
    it(`refuses ${host}`, () => {
      for (const sub of subsFor(host)) {
        for (const value of [sub + host, `https://${sub}${host}/acme`, `http://${sub}${host}`]) {
          const result = researchEligibility({ website: value, suppressed: false });
          assert.equal(result.eligible, false, value);
          assert.equal(!result.eligible && result.reason, "not_company_website", value);
        }
      }
    });
  }

  for (const host of allowed) {
    it(`still allows ${host}`, () => {
      assert.deepEqual(researchEligibility({ website: host, suppressed: false }), {
        eligible: true,
      });
    });
  }

  it("keeps the existing refusals and their order", () => {
    const bad = researchEligibility({ website: "localhost", suppressed: false });
    assert.equal(bad.eligible === false && bad.message, INVALID_WEBSITE_MESSAGE);
    const suppressed = researchEligibility({ website: "facebook.com/x", suppressed: true });
    assert.equal(suppressed.eligible === false && suppressed.reason, "suppressed");
    const none = researchEligibility({ website: "  ", suppressed: false });
    assert.equal(none.eligible === false && none.reason, "no_website");
  });
});

describe("crawl start URL layer: startUrl", () => {
  for (const host of denied) {
    it(`refuses ${host} with invalid_url`, async () => {
      for (const sub of subsFor(host)) {
        for (const value of [sub + host, `https://${sub}${host}/acme`, `http://${sub}${host}/`]) {
          assert.equal(
            await codeOf(Promise.resolve().then(() => startUrl(value))),
            "invalid_url",
            value,
          );
        }
      }
    });
  }

  for (const host of allowed) {
    it(`still starts at ${host}`, () => {
      assert.equal(startUrl(host).hostname, host);
    });
  }

  it("the refusal is non-retryable and says why", () => {
    try {
      startUrl("facebook.com/mybakery");
      assert.fail("expected a refusal");
    } catch (e) {
      assert.ok(e instanceof ResearchFetchError);
      assert.equal(e.code, "invalid_url");
      assert.equal(e.retryable, false);
      assert.match(e.message, /social media, review, search or map page/);
    }
  });

  it("crawlCompanyWebsite resolves nothing and requests nothing for a refused host", async () => {
    for (const website of [
      "facebook.com/mybakery",
      "https://www.instagram.com/mybakery/",
      "google.com/search?q=mybakery",
      "https://www.google.co.uk/maps/place/x",
      "maps.app.goo.gl/abc",
      "bing.com/search?q=x",
      "https://m.linkedin.com/company/acme",
      "wa.me/15551234567",
    ]) {
      const w = world();
      const code = await codeOf(
        crawlCompanyWebsite(website, w.fetcher, { now: () => new Date("2026-01-01") }),
      );
      assert.equal(code, "invalid_url", website);
      assert.equal(w.dns.calls.length, 0, `${website}: no DNS lookup`);
      assert.equal(w.net.requests.length, 0, `${website}: no request, not even robots.txt`);
    }
  });
});

describe("worker: a lead whose website is a social page fails without any contact", () => {
  it("fails the run, non-retryable, with nothing fetched", async () => {
    const repo = fakeRepo();
    const seeded = repo.seed({ website: "https://www.facebook.com/mybakery" });
    const sched = manualScheduler();
    const site = realFetcher();
    const claimed = await repo.claim("worker-A", seeded);
    const outcome = await processRun(claimed, {
      repo: repo.repo,
      fetcher: site.fetcher,
      workerId: "worker-A",
      schedule: sched.schedule,
      sleep: async () => {},
    });
    assert.equal(outcome, "failed");
    assert.equal(repo.failures.length, 1);
    assert.equal(repo.failures[0].failure.code, "invalid_url");
    assert.equal(repo.failures[0].failure.retryable, false);
    assert.equal(site.net.requests.length, 0);
    assert.equal(site.dns.calls.length, 0);
    assert.equal(repo.calls.includes("uploadSource"), false);
  });
});
