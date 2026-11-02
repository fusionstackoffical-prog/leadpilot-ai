import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import {
  decodeBody,
  safeFetch,
  type SafeFetchOptions,
} from "../../src/features/research/engine/net/safe-fetch.ts";
import {
  fakeResolver,
  fakeTransport,
  PUBLIC_V4,
  PUBLIC_V4_B,
  UA,
  type FakeRoute,
} from "./net-fakes.ts";

const DNS = {
  "acme.com": [PUBLIC_V4],
  "www.acme.com": [PUBLIC_V4],
  "other.com": [PUBLIC_V4_B],
  "evil.com": ["10.0.0.7"],
  "metadata.com": ["169.254.169.254"],
};

function setup(routes: Record<string, FakeRoute>, extra: Partial<SafeFetchOptions> = {}) {
  const dns = fakeResolver(DNS);
  const net = fakeTransport(routes);
  const fetch = (url: string, more: Partial<SafeFetchOptions> = {}) =>
    safeFetch(url, {
      userAgent: UA,
      resolver: dns.resolver,
      transport: net.transport,
      ...extra,
      ...more,
    });
  return { fetch, dns, net };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (error) {
    assert.ok(
      error instanceof ResearchFetchError,
      `expected ResearchFetchError, got ${String(error)}`,
    );
    return error.code;
  }
};

describe("safeFetch: basics", () => {
  it("fetches a page through the pinned, validated address", async () => {
    const { fetch, net } = setup({ "acme.com/": { body: "<h1>Acme</h1>" } });
    const res = await fetch("https://acme.com/");
    assert.equal(res.status, 200);
    assert.equal(decodeBody(res), "<h1>Acme</h1>");
    assert.equal(res.contentType, "text/html");
    assert.equal(res.charset, "utf-8");
    assert.deepEqual(res.redirects, []);
    assert.equal(net.requests[0].address, PUBLIC_V4);
    assert.equal(net.requests[0].headers["user-agent"], UA);
    assert.equal(net.requests[0].headers.cookie, undefined);
  });

  it("decodes the declared charset", async () => {
    const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9]); // "Café" in ISO-8859-1
    const { fetch } = setup({
      "acme.com/": { body: latin1, headers: { "content-type": "text/html; charset=ISO-8859-1" } },
    });
    assert.equal(decodeBody(await fetch("https://acme.com/")), "Café");
  });

  it("refuses private, metadata and invalid targets before any request", async () => {
    const { fetch, net } = setup({});
    assert.equal(await code(fetch("https://evil.com/")), "blocked_address");
    assert.equal(await code(fetch("https://metadata.com/")), "blocked_address");
    assert.equal(await code(fetch("http://169.254.169.254/")), "blocked_address");
    assert.equal(await code(fetch("https://acme.com:8443/")), "invalid_url");
    assert.equal(await code(fetch("file:///etc/passwd")), "invalid_url");
    assert.equal(await code(fetch("https://unknown-domain.com/")), "dns_not_found");
    assert.equal(net.requests.length, 0);
  });
});

describe("safeFetch: redirects", () => {
  it("follows relative and cross-host redirects, re-validating each hop", async () => {
    const { fetch, dns } = setup({
      "acme.com/": { status: 301, headers: { location: "https://www.acme.com/home" } },
      "www.acme.com/home": { status: 302, headers: { location: "/en" } },
      "www.acme.com/en": { body: "ok" },
    });
    const res = await fetch("https://acme.com/");
    assert.equal(res.url, "https://www.acme.com/en");
    assert.deepEqual(res.redirects, ["https://www.acme.com/home", "https://www.acme.com/en"]);
    assert.deepEqual(dns.calls, ["acme.com", "www.acme.com", "www.acme.com"]);
  });

  it("blocks redirects to private addresses, IP literals, other schemes and http downgrades", async () => {
    const { fetch, net } = setup({
      "acme.com/to-private": { status: 302, headers: { location: "https://evil.com/" } },
      "acme.com/to-ip": { status: 302, headers: { location: "http://127.0.0.1/admin" } },
      "acme.com/to-metadata": {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      },
      "acme.com/to-file": { status: 302, headers: { location: "file:///etc/passwd" } },
      "acme.com/to-port": { status: 302, headers: { location: "https://acme.com:8080/" } },
      "acme.com/downgrade": { status: 301, headers: { location: "http://acme.com/" } },
    });
    assert.equal(await code(fetch("https://acme.com/to-private")), "blocked_address");
    assert.equal(await code(fetch("https://acme.com/to-ip")), "redirect_blocked");
    assert.equal(await code(fetch("https://acme.com/to-metadata")), "redirect_blocked");
    assert.equal(await code(fetch("https://acme.com/to-file")), "redirect_blocked");
    assert.equal(await code(fetch("https://acme.com/to-port")), "redirect_blocked");
    assert.equal(await code(fetch("https://acme.com/downgrade")), "redirect_blocked");
    // Only the six first hops were requested; no blocked target was ever contacted.
    assert.equal(net.requests.length, 6);
    assert.ok(net.requests.every((r) => r.address === PUBLIC_V4));
  });

  it("allows http -> https upgrades", async () => {
    const { fetch, net } = setup({
      "acme.com/start": { status: 301, headers: { location: "https://acme.com/done" } },
      "acme.com/done": { body: "secure" },
    });
    const res = await fetch("http://acme.com/start");
    assert.equal(res.url, "https://acme.com/done");
    assert.deepEqual(
      net.requests.map((r) => r.url.protocol),
      ["http:", "https:"],
    );
  });

  it("stops redirect loops and long chains", async () => {
    const chain: Record<string, FakeRoute> = {};
    for (let i = 0; i < 7; i++)
      chain[`acme.com/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } };
    const { fetch } = setup({
      ...chain,
      "acme.com/a": { status: 302, headers: { location: "/b" } },
      "acme.com/b": { status: 302, headers: { location: "/a" } },
    });
    assert.equal(await code(fetch("https://acme.com/r0")), "too_many_redirects");
    assert.equal(await code(fetch("https://acme.com/a")), "too_many_redirects");
  });

  it("treats a redirect without a location as an error", async () => {
    const { fetch } = setup({ "acme.com/": { status: 302 } });
    assert.equal(await code(fetch("https://acme.com/")), "http_status");
  });

  it("runs every hop through the hop hook (robots + rate limiting)", async () => {
    const hops: string[] = [];
    const { fetch } = setup(
      {
        "acme.com/": { status: 301, headers: { location: "https://other.com/x" } },
        "other.com/x": { body: "ok" },
      },
      { hop: async (url, run) => (hops.push(url.href), run()) },
    );
    await fetch("https://acme.com/");
    assert.deepEqual(hops, ["https://acme.com/", "https://other.com/x"]);
  });
});

describe("safeFetch: statuses and content", () => {
  it("classifies HTTP errors and honours Retry-After", async () => {
    const { fetch } = setup({
      "acme.com/404": { status: 404 },
      "acme.com/503": { status: 503, headers: { "retry-after": "30" } },
      "acme.com/429": { status: 429, headers: { "retry-after": "5" } },
      "acme.com/304": { status: 304 },
    });
    await assert.rejects(
      fetch("https://acme.com/404"),
      (e: ResearchFetchError) => e.code === "http_status" && e.status === 404 && !e.retryable,
    );
    await assert.rejects(
      fetch("https://acme.com/503"),
      (e: ResearchFetchError) => e.retryable && e.retryAfterMs === 30_000,
    );
    await assert.rejects(
      fetch("https://acme.com/429"),
      (e: ResearchFetchError) => e.retryable && e.retryAfterMs === 5_000,
    );
    assert.equal(await code(fetch("https://acme.com/304")), "http_status");
  });

  it("accepts only web page content types by default", async () => {
    const { fetch } = setup({
      "acme.com/file.pdf": { body: "%PDF", headers: { "content-type": "application/pdf" } },
      "acme.com/img": { body: "x", headers: { "content-type": "image/png" } },
      "acme.com/none": { body: "x", headers: { "content-type": "" } },
      "acme.com/xhtml": { body: "<x/>", headers: { "content-type": "application/xhtml+xml" } },
      "acme.com/txt": { body: "hi", headers: { "content-type": "text/plain" } },
    });
    assert.equal(await code(fetch("https://acme.com/file.pdf")), "unsupported_content_type");
    assert.equal(await code(fetch("https://acme.com/img")), "unsupported_content_type");
    assert.equal(await code(fetch("https://acme.com/none")), "unsupported_content_type");
    assert.equal(await code(fetch("https://acme.com/xhtml")), "ok");
    assert.equal(await code(fetch("https://acme.com/txt")), "ok");
    assert.equal(await code(fetch("https://acme.com/img", { allowedContentTypes: null })), "ok");
  });

  it("decompresses gzip, deflate and brotli", async () => {
    const html = "<p>compressed page</p>";
    const { fetch } = setup({
      "acme.com/gz": { body: gzipSync(html), headers: { "content-encoding": "gzip" } },
      "acme.com/df": { body: deflateSync(html), headers: { "content-encoding": "deflate" } },
      "acme.com/br": { body: brotliCompressSync(html), headers: { "content-encoding": "br" } },
      "acme.com/bad": { body: Buffer.from("not gzip"), headers: { "content-encoding": "gzip" } },
      "acme.com/zstd": { body: "x", headers: { "content-encoding": "zstd" } },
    });
    for (const path of ["gz", "df", "br"])
      assert.equal(decodeBody(await fetch(`https://acme.com/${path}`)), html, path);
    assert.equal(await code(fetch("https://acme.com/bad")), "decode_error");
    assert.equal(await code(fetch("https://acme.com/zstd")), "decode_error");
  });
});

describe("safeFetch: size limits", () => {
  it("rejects a declared oversize body before reading it", async () => {
    const { fetch } = setup({
      "acme.com/": { body: "x", headers: { "content-length": String(10 * 1024 * 1024) } },
    });
    assert.equal(await code(fetch("https://acme.com/", { maxBytes: 1024 })), "response_too_large");
  });

  it("stops reading an oversize body without a content-length", async () => {
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(1024, 97));
    const { fetch } = setup({ "acme.com/": { body: chunks } });
    assert.equal(await code(fetch("https://acme.com/", { maxBytes: 4096 })), "response_too_large");
  });

  it("stops a decompression bomb by counting decoded bytes", async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024)); // ~20 KB that expands to 20 MB
    assert.ok(bomb.length < 100 * 1024);
    const { fetch } = setup({
      "acme.com/": { body: bomb, headers: { "content-encoding": "gzip" } },
    });
    assert.equal(
      await code(fetch("https://acme.com/", { maxBytes: 1024 * 1024 })),
      "response_too_large",
    );
  });

  it("can keep the first maxBytes instead (robots.txt)", async () => {
    const { fetch } = setup({ "acme.com/": { body: "a".repeat(5000) } });
    const res = await fetch("https://acme.com/", { maxBytes: 1000, oversize: "truncate" });
    assert.equal(res.body.length, 1000);
    assert.equal(res.truncated, true);
  });
});

describe("safeFetch: timeouts and cancellation", () => {
  it("times out a server that never answers (retryable)", async () => {
    const { fetch } = setup({ "acme.com/": { hang: true } });
    await assert.rejects(
      fetch("https://acme.com/", { timeoutMs: 50 }),
      (e: ResearchFetchError) => e.code === "timeout" && e.retryable,
    );
  });

  it("times out a body that stalls mid-stream", async () => {
    const { fetch } = setup({ "acme.com/": { stallBody: true, body: [Buffer.from("<html>")] } });
    await assert.rejects(
      fetch("https://acme.com/", { timeoutMs: 50 }),
      (e: ResearchFetchError) => e.code === "timeout",
    );
  });

  it("times out slow DNS", async () => {
    const net = fakeTransport({});
    const res = safeFetch("https://acme.com/", {
      userAgent: UA,
      transport: net.transport,
      resolver: () => new Promise(() => {}),
      timeoutMs: 50,
    });
    await assert.rejects(res, (e: ResearchFetchError) => e.code === "timeout");
  });

  it("stops when the caller cancels", async () => {
    const { fetch } = setup({ "acme.com/": { hang: true } });
    const controller = new AbortController();
    const pending = fetch("https://acme.com/", { signal: controller.signal, timeoutMs: 5_000 });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(
      pending,
      (e: ResearchFetchError) => e.code === "cancelled" && !e.retryable,
    );
  });

  it("requires a user agent", async () => {
    await assert.rejects(safeFetch("https://acme.com/", { userAgent: "" }), /user agent/);
  });
});
