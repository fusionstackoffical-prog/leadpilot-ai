import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { parseTargetUrl } from "../../src/features/research/engine/net/target-url.ts";

const codeOf = (value: string, base?: string) => {
  try {
    parseTargetUrl(value, base);
    return "ok";
  } catch (error) {
    assert.ok(error instanceof ResearchFetchError);
    return error.code;
  }
};

describe("parseTargetUrl", () => {
  it("accepts public http(s) URLs and drops the fragment", () => {
    assert.equal(
      parseTargetUrl("https://www.acme-dental.com/about#team").href,
      "https://www.acme-dental.com/about",
    );
    assert.equal(parseTargetUrl("  http://acme.co.uk/ ").href, "http://acme.co.uk/");
    assert.equal(parseTargetUrl("https://acme.com:443/").href, "https://acme.com/"); // default port
    assert.equal(parseTargetUrl("https://xn--caf-dma.fr/").hostname, "xn--caf-dma.fr");
    assert.equal(parseTargetUrl("https://café.fr/").hostname, "xn--caf-dma.fr");
  });

  it("resolves relative redirect locations against a base", () => {
    assert.equal(
      parseTargetUrl("/contact", "https://acme.com/about").href,
      "https://acme.com/contact",
    );
    assert.equal(
      parseTargetUrl("//www.acme.com/", "https://acme.com/").href,
      "https://www.acme.com/",
    );
  });

  it("rejects other schemes", () => {
    for (const value of [
      "ftp://acme.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,x",
      "gopher://acme.com/",
      "ws://acme.com/",
    ]) {
      assert.equal(codeOf(value), "invalid_url", value);
    }
  });

  it("rejects credentials and non-default ports", () => {
    assert.equal(codeOf("https://user:pass@acme.com/"), "invalid_url");
    assert.equal(codeOf("https://user@acme.com/"), "invalid_url");
    assert.equal(codeOf("http://acme.com:8080/"), "invalid_url");
    assert.equal(codeOf("https://acme.com:80/"), "invalid_url");
    assert.equal(codeOf("http://acme.com:22/"), "invalid_url");
  });

  it("rejects IP literals, including disguised loopback and metadata addresses", () => {
    for (const value of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/", // 127.0.0.1 as one number
      "http://0x7f.1/", // hex + short form
      "http://0177.0.0.1/", // octal
      "http://127.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "https://8.8.8.8/", // even public IPs: a domain name is required
    ]) {
      assert.equal(codeOf(value), "blocked_address", value);
    }
  });

  it("rejects local and reserved names", () => {
    for (const value of [
      "http://api.localhost/",
      "http://printer.local/",
      "http://db.internal/",
      "http://x.home.arpa/",
      "http://abc.onion/",
      "http://a.invalid/",
      "http://site.test/",
      "http://router.lan/",
    ]) {
      assert.equal(codeOf(value), "blocked_address", value);
    }
  });

  it("rejects single labels, odd hostnames and oversized URLs", () => {
    assert.equal(codeOf("http://intranet/"), "invalid_url");
    assert.equal(codeOf("http://localhost/"), "invalid_url");
    assert.equal(codeOf("http://acme.c0m/"), "invalid_url");
    assert.equal(codeOf("http://-acme.com/"), "invalid_url");
    assert.equal(codeOf("http://acme.com./"), "invalid_url");
    assert.equal(codeOf(""), "invalid_url");
    assert.equal(codeOf(`https://acme.com/${"a".repeat(2100)}`), "invalid_url");
    assert.equal(codeOf("not a url"), "invalid_url");
  });
});
