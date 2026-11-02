import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOT_TOKEN,
  loadResearchFetchConfig,
  ResearchConfigError,
} from "../../src/features/research/engine/config.ts";
import {
  describeFailure,
  isRetryableStatus,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  ResearchFetchError,
  statusError,
  toFetchError,
} from "../../src/features/research/engine/net/errors.ts";
import { resolvePublicAddress } from "../../src/features/research/engine/net/resolve.ts";
import { fakeResolver, PUBLIC_V4, PUBLIC_V4_B } from "./net-fakes.ts";

describe("retry classification", () => {
  it("retries only transient HTTP statuses", () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504])
      assert.equal(isRetryableStatus(s), true, String(s));
    for (const s of [400, 401, 403, 404, 410, 451, 501, 505])
      assert.equal(isRetryableStatus(s), false, String(s));
    assert.equal(statusError(503, "https://a.com/").retryable, true);
    assert.equal(statusError(404, "https://a.com/").retryable, false);
  });

  it("parses Retry-After in seconds and as an HTTP date, capped at one hour", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    assert.equal(parseRetryAfter("120", now), 120_000);
    assert.equal(parseRetryAfter("Mon, 02 Nov 2026 12:00:30 GMT", now), 30_000);
    assert.equal(parseRetryAfter("Mon, 02 Nov 2026 11:00:00 GMT", now), 0); // in the past
    assert.equal(parseRetryAfter("999999", now), MAX_RETRY_AFTER_MS);
    assert.equal(parseRetryAfter("soon", now), undefined);
    assert.equal(parseRetryAfter(undefined, now), undefined);
    assert.equal(statusError(429, "https://a.com/", "7", now).retryAfterMs, 7_000);
  });

  it("maps system errors to retryable or permanent codes", () => {
    const cases: [string, string, boolean][] = [
      ["ENOTFOUND", "dns_not_found", false],
      ["EAI_AGAIN", "dns_temporary", true],
      ["ECONNREFUSED", "connection_failed", true],
      ["ECONNRESET", "connection_failed", true],
      ["ETIMEDOUT", "connection_failed", true],
      ["CERT_HAS_EXPIRED", "tls_error", false],
      ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_error", false],
      ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_error", false],
      ["ABORT_ERR", "cancelled", false],
    ];
    for (const [sys, code, retryable] of cases) {
      const e = toFetchError(Object.assign(new Error(sys), { code: sys }), "https://acme.com/");
      assert.equal(e.code, code, sys);
      assert.equal(e.retryable, retryable, sys);
    }
    assert.equal(toFetchError(new Error("weird"), "not a url").code, "connection_failed");
  });

  it("describes failures for the worker without leaking details", () => {
    const d = describeFailure(
      new ResearchFetchError("robots_disallowed", "robots.txt does not allow https://a.com/x"),
    );
    assert.deepEqual(d, {
      code: "robots_disallowed",
      message: "robots.txt does not allow https://a.com/x",
      retryable: false,
      retryAfterMs: undefined,
    });
  });
});

describe("resolvePublicAddress", () => {
  it("returns a public address, preferring IPv4", async () => {
    const { resolver } = fakeResolver({ "acme.com": ["2606:4700::1111", PUBLIC_V4] });
    assert.deepEqual(await resolvePublicAddress("acme.com", resolver), {
      address: PUBLIC_V4,
      family: 4,
    });
  });

  it("refuses a host if any of its addresses is private (mixed answers)", async () => {
    const { resolver } = fakeResolver({
      "mixed.com": [PUBLIC_V4, "10.0.0.5"],
      "meta.com": ["169.254.169.254"],
      "v6.com": ["::1"],
    });
    for (const host of ["mixed.com", "meta.com", "v6.com"]) {
      await assert.rejects(
        resolvePublicAddress(host, resolver),
        (e: ResearchFetchError) => e.code === "blocked_address",
        host,
      );
    }
  });

  it("maps DNS failures", async () => {
    const { resolver } = fakeResolver({
      "slow.com": Object.assign(new Error("again"), { code: "EAI_AGAIN" }),
      "empty.com": [],
    });
    await assert.rejects(
      resolvePublicAddress("missing.com", resolver),
      (e: ResearchFetchError) => e.code === "dns_not_found",
    );
    await assert.rejects(
      resolvePublicAddress("slow.com", resolver),
      (e: ResearchFetchError) => e.code === "dns_temporary" && e.retryable,
    );
    await assert.rejects(
      resolvePublicAddress("empty.com", resolver),
      (e: ResearchFetchError) => e.code === "dns_not_found",
    );
  });

  it("checks the answer each time it resolves (no stale trust)", async () => {
    let n = 0;
    const { resolver } = fakeResolver({
      "rebind.com": () => (n++ === 0 ? [PUBLIC_V4_B] : ["127.0.0.1"]),
    });
    assert.equal((await resolvePublicAddress("rebind.com", resolver)).address, PUBLIC_V4_B);
    await assert.rejects(
      resolvePublicAddress("rebind.com", resolver),
      (e: ResearchFetchError) => e.code === "blocked_address",
    );
  });
});

describe("loadResearchFetchConfig", () => {
  it("requires RESEARCH_BOT_CONTACT_URL and never invents one", () => {
    assert.throws(() => loadResearchFetchConfig({}), ResearchConfigError);
    assert.throws(
      () => loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: "   " }),
      ResearchConfigError,
    );
  });

  it("requires a public https URL without spaces", () => {
    for (const value of [
      "http://leadpilot.example.com/bot",
      "not a url",
      "https://localhost/bot",
      "https://user:pw@leadpilot.example.com/",
      "https://leadpilot.example.com/a b",
      "mailto:bot@example.com",
    ]) {
      assert.throws(
        () => loadResearchFetchConfig({ RESEARCH_BOT_CONTACT_URL: value }),
        ResearchConfigError,
        value,
      );
    }
  });

  it("builds the bot user agent from the contact URL", () => {
    const config = loadResearchFetchConfig({
      RESEARCH_BOT_CONTACT_URL: "https://leadpilot.example.com/bot",
    });
    assert.equal(config.userAgent, `${BOT_TOKEN}/1.0 (+https://leadpilot.example.com/bot)`);
    assert.equal(config.maxPageBytes, 2 * 1024 * 1024);
    assert.equal(config.maxRedirects, 5);
  });
});
