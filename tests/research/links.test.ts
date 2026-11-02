import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayHost, safeExternalUrl } from "../../src/features/research/links.ts";

describe("safeExternalUrl", () => {
  it("keeps http(s) URLs", () => {
    assert.equal(
      safeExternalUrl("https://www.acme-hvac.com/about"),
      "https://www.acme-hvac.com/about",
    );
    assert.equal(safeExternalUrl("http://acme-hvac.com"), "http://acme-hvac.com/");
  });

  it("assumes https for bare domains", () => {
    assert.equal(safeExternalUrl("acme-hvac.com"), "https://acme-hvac.com/");
    assert.equal(
      safeExternalUrl("  www.acme-hvac.com/contact "),
      "https://www.acme-hvac.com/contact",
    );
    assert.equal(safeExternalUrl("//acme-hvac.com"), "https://acme-hvac.com/");
  });

  it("never links script, data or other schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///C:/Windows",
      "ftp://acme-hvac.com",
      "mailto:info@acme-hvac.com",
    ]) {
      assert.equal(safeExternalUrl(value), null, value);
    }
  });

  it("rejects values that are not a public hostname", () => {
    for (const value of [
      "",
      "   ",
      null,
      undefined,
      "N/A",
      "localhost",
      "http://localhost:3000",
      "http://127.0.0.1",
      "192.168.1.10",
      "https://user:pass@acme-hvac.com",
      "acme hvac.com",
      "https://acme-hvac.c0m",
    ]) {
      assert.equal(safeExternalUrl(value), null, String(value));
    }
  });
});

describe("displayHost", () => {
  it("shows the hostname without www", () => {
    assert.equal(displayHost("https://www.acme-hvac.com/about"), "acme-hvac.com");
  });

  it("falls back to the raw text for unsafe values", () => {
    assert.equal(displayHost("javascript:alert(1)"), "javascript:alert(1)");
    assert.equal(displayHost(null), null);
  });
});
