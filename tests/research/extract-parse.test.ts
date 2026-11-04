import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidence,
  MAX_EVIDENCE_CHARS,
  verifyQuote,
} from "../../src/features/research/engine/extract/evidence.ts";
import { decodeHtml } from "../../src/features/research/engine/extract/html.ts";
import { extractJsonLd } from "../../src/features/research/engine/extract/jsonld.ts";
import { normalizeText, quoteIn, slug } from "../../src/features/research/engine/extract/text.ts";
import { CLINIC, MALFORMED, pageOf } from "./extract-fixtures.ts";

describe("normalized_exact_v1", () => {
  it("collapses whitespace, NBSP and zero-width characters and applies NFC", () => {
    assert.equal(normalizeText("  Acme  Dental\n\t Care​ "), "Acme Dental Care");
    assert.equal(normalizeText("Café"), "Café");
    assert.equal(normalizeText("co­operative"), "cooperative");
  });

  it("verifies quotes exactly, apart from whitespace", () => {
    const text = "TEXT:\nWe offer teeth  cleaning\nand implants";
    assert.equal(quoteIn(text, "We offer teeth cleaning"), true);
    assert.equal(quoteIn(text, "We offer teeth cleanings"), false);
    assert.equal(quoteIn(text, "we offer teeth cleaning"), false); // case-sensitive
    assert.equal(quoteIn(text, "an"), false); // too short to be evidence
  });

  it("makes stable, bounded slugs", () => {
    assert.equal(slug("Teeth Cleaning & Whitening!"), "teeth-cleaning-whitening");
    assert.equal(slug("Crème brûlée"), "creme-brulee");
    assert.equal(slug("a".repeat(200)).length, 80);
    assert.match(slug("日本語"), /^[0-9a-f]{12}$/); // no Latin letters: hash
  });
});

describe("parsePage", () => {
  const page = pageOf(CLINIC);

  it("reads metadata", () => {
    assert.equal(page.title, "Bright Smile Dental | Family Dentist in Austin");
    assert.match(page.metaDescription ?? "", /^Bright Smile Dental is a family dental clinic/);
    assert.equal(page.ogSiteName, "Bright Smile Dental");
    assert.equal(page.lang, "en");
  });

  it("keeps visible text with its region and heading level", () => {
    const h2 = page.blocks.find((b) => b.text === "Our Services");
    assert.deepEqual(h2, {
      text: "Our Services",
      tag: "h2",
      region: "main",
      context: "site",
      level: 2,
    });
    assert.ok(page.blocks.some((b) => b.text === "Teeth Cleaning" && b.tag === "li"));
    assert.ok(page.blocks.some((b) => b.region === "nav" && b.text.includes("About Us")));
    assert.ok(
      page.blocks.some((b) => b.region === "footer" && b.text === "Call us: (512) 555-0142"),
    );
  });

  it("drops scripts, styles, hidden elements and cookie banners", () => {
    const all = page.evidence.text;
    for (const noise of [
      "secret-tracking-id",
      "color:red",
      "We use cookies",
      "Hidden promo text",
    ]) {
      assert.ok(!all.includes(noise), noise);
    }
  });

  it("resolves links to absolute URLs", () => {
    const hrefs = page.links.map((l) => l.href);
    assert.ok(hrefs.includes("https://acme-co.com/about-us"));
    assert.ok(hrefs.includes("mailto:hello@brightsmile-dental.com"));
    assert.ok(hrefs.includes("tel:+15125550142"));
  });

  it("parses JSON-LD into flat entities, nested ones included", () => {
    const dentist = page.jsonLd.find((e) => e.types.includes("Dentist"));
    assert.equal(dentist?.props["address.streetAddress"], "100 Congress Ave");
    assert.equal(dentist?.props["sameAs[1]"], "https://www.instagram.com/brightsmileatx/");
    assert.ok(page.jsonLd.some((e) => e.types.includes("PostalAddress")));
  });

  it("survives malformed HTML and never keeps script URLs", () => {
    const broken = pageOf(MALFORMED);
    assert.ok(broken.blocks.some((b) => b.text.includes("Unclosed para")));
    assert.ok(broken.blocks.some((b) => b.text === "Heading two" && b.level === 2));
    assert.deepEqual(
      broken.links.map((l) => l.href),
      ["https://acme-co.com/ok"],
    );
    assert.ok(!broken.evidence.text.includes("document.write"));
  });

  it("handles plain-text pages", () => {
    const text = pageOf(
      "Acme Tools\n\nWe sell hand tools.",
      "https://acme-co.com/info.txt",
      "about",
      "text/plain",
    );
    assert.deepEqual(
      text.blocks.map((b) => b.text),
      ["Acme Tools", "We sell hand tools."],
    );
  });

  it("flags pages that need JavaScript", () => {
    const spa = pageOf(
      `<html><body><div id="root"></div><noscript>Please enable JavaScript</noscript><script src="a.js"></script></body></html>`,
    );
    assert.equal(spa.needsJavaScript, true);
    assert.equal(page.needsJavaScript, false);
  });
});

describe("extractJsonLd", () => {
  it("ignores invalid, oversized and untyped JSON-LD", () => {
    assert.deepEqual(
      extractJsonLd([
        "{not json",
        JSON.stringify({ name: "untyped" }),
        `{"@type":"Organization","name":"${"x".repeat(250_000)}"}`,
      ]),
      [],
    );
  });

  it("reads @graph, arrays and schema.org IRIs, and limits depth", () => {
    const entities = extractJsonLd([
      JSON.stringify({ "@graph": [{ "@type": "https://schema.org/Bakery", name: "Crumbs" }] }),
      JSON.stringify([{ "@type": ["Store", "Bakery"], name: "Crumbs 2" }]),
    ]);
    assert.deepEqual(
      entities.map((e) => e.types),
      [["Bakery"], ["Store", "Bakery"]],
    );
    let deep: Record<string, unknown> = { "@type": "Thing", name: "bottom" };
    for (let i = 0; i < 20; i++) deep = { "@type": "Thing", child: deep };
    assert.ok(extractJsonLd([JSON.stringify(deep)]).length <= 8);
  });
});

describe("evidence document", () => {
  it("contains header, JSON-LD, links and text sections", () => {
    const text = pageOf(CLINIC).evidence.text;
    assert.match(text, /^URL: https:\/\/acme-co\.com\//);
    for (const line of [
      "TITLE: Bright Smile Dental | Family Dentist in Austin",
      "@type: Dentist",
      "name: Bright Smile Dental",
      "LINKS:",
      "mailto:hello@brightsmile-dental.com Email us",
      "TEXT:",
      "Teeth Cleaning",
    ]) {
      assert.ok(text.includes(line), line);
    }
  });

  it("hashes exactly what is stored", async () => {
    const { createHash } = await import("node:crypto");
    const evidence = pageOf(CLINIC).evidence;
    assert.equal(evidence.sha256, createHash("sha256").update(evidence.text).digest("hex"));
    assert.equal(evidence.chars, [...evidence.text].length);
  });

  it("caps very long pages at 200,000 characters and marks them truncated", () => {
    const html = `<main>${Array.from({ length: 4000 }, (_, i) => `<p>Paragraph ${i} ${"lorem ipsum ".repeat(10)}</p>`).join("")}</main>`;
    const evidence = pageOf(html).evidence;
    assert.ok(evidence.text.length <= MAX_EVIDENCE_CHARS);
    assert.equal(evidence.truncated, true);
    assert.ok(evidence.text.startsWith("URL: "));
  });

  it("verifies quotes against the stored text only", () => {
    const page = pageOf(CLINIC);
    assert.equal(verifyQuote(page, "Dental Implants"), true);
    assert.equal(verifyQuote(page, "Dental Implants and Braces"), false);
    assert.equal(verifyQuote(page, "secret-tracking-id"), false); // scripts are never evidence
  });

  it("decodes declared and <meta> charsets", () => {
    const latin1 = Buffer.from('<meta charset="iso-8859-1"><p>Caf\xe9</p>', "latin1");
    assert.match(decodeHtml({ body: latin1, charset: null }), /Café/);
    assert.match(
      decodeHtml({ body: Buffer.from("<p>Café</p>"), charset: "bogus-charset" }),
      /Café/,
    );
  });

  it("builds identical evidence for identical input", () => {
    const a = pageOf(CLINIC);
    const { evidence, ...rest } = a;
    assert.equal(buildEvidence(rest).sha256, evidence.sha256);
  });
});
