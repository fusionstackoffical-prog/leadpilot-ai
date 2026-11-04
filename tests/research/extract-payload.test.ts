// The completion payload must satisfy migration 009's constraints exactly, because Phase 3C
// will pass it to public.worker_complete_research_run unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import { extractFromPages } from "../../src/features/research/engine/extract/extract.ts";
import {
  buildCompletionPayload,
  evidenceStoragePath,
  PayloadError,
} from "../../src/features/research/engine/extract/payload.ts";
import { quoteIn } from "../../src/features/research/engine/extract/text.ts";
import {
  CLINIC,
  ESTATE_CONTACT,
  ESTATE_HOME,
  HOTEL,
  pageOf,
  RESTAURANT,
  SHOP,
} from "./extract-fixtures.ts";

// Mirrors research_findings / lead_sources checks in supabase/migrations/20261103000009_company_research.sql.
const DB_CATEGORIES = new Set([
  "business_description",
  "service",
  "service_area",
  "location",
  "contact_email",
  "contact_phone",
  "contact_address",
  "social_profile",
  "person",
  "certification",
  "company_detail",
  "company_summary",
  "observation",
  "challenge",
  "opportunity",
]);
const ASSESSMENT_ONLY = new Set(["company_summary", "observation", "challenge", "opportunity"]);

function build(pagesHtml: [string, string, Parameters<typeof pageOf>[2]][]) {
  const pages = pagesHtml.map(([html, url, type]) => pageOf(html, url, type));
  const extraction = extractFromPages(pages, { companyName: "Test" });
  return { pages, extraction, ...buildCompletionPayload(pages, extraction) };
}

describe("buildCompletionPayload", () => {
  const cases = {
    clinic: build([[CLINIC, "https://brightsmile-dental.com/", "home"]]),
    restaurant: build([[RESTAURANT, "https://luigis-trattoria.it/", "home"]]),
    hotel: build([[HOTEL, "https://seasideinn.co.za/", "home"]]),
    shop: build([[SHOP, "https://greenleaf-tea.com/", "home"]]),
    estate: build([
      [ESTATE_HOME, "https://primerealty.ae/", "home"],
      [ESTATE_CONTACT, "https://primerealty.ae/contact-us", "contact"],
    ]),
  };

  for (const [name, { payload, uploads, pages }] of Object.entries(cases)) {
    it(`${name}: satisfies the database constraints`, () => {
      assert.ok(payload.sources.length >= 1 && payload.sources.length <= 25);
      assert.ok(payload.findings.length >= 1 && payload.findings.length <= 300);
      const sourceRefs = new Set(payload.sources.map((s) => s.ref));
      const keys = new Set<string>();
      for (const s of payload.sources) {
        assert.match(s.url, /^https?:\/\//);
        assert.match(s.final_url, /^https?:\/\//);
        assert.match(s.text.sha256, /^[0-9a-f]{64}$/);
        assert.ok(s.text.chars >= 1 && s.text.chars <= 200_000);
        assert.ok(s.text.bytes >= 1 && s.text.bytes <= 262_144);
        assert.ok(s.title === null || s.title.length <= 500);
        assert.equal(s.source_type, "company_website");
      }
      assert.equal(
        new Set(payload.sources.map((s) => s.url)).size,
        payload.sources.length,
        "unique (run_id, url)",
      );
      for (const f of payload.findings) {
        assert.ok(DB_CATEGORIES.has(f.category), f.category);
        assert.ok(!ASSESSMENT_ONLY.has(f.category), "never an assessment category");
        assert.ok(f.kind === "fact" || f.kind === "candidate", "no AI assessments in Phase 3B");
        assert.ok(f.field_key.length >= 1 && f.field_key.length <= 200);
        assert.ok(f.value_text.length >= 1 && f.value_text.length <= 4_000);
        assert.ok(sourceRefs.has(f.source_ref));
        assert.ok(f.evidence_quote.length >= 3 && f.evidence_quote.length <= 1_000);
        assert.equal(f.quote_check, f.kind === "fact" ? "normalized_exact_v1" : undefined);
        assert.equal(typeof f.value_json, "object");
        const id = `${f.category}|${f.field_key}`;
        assert.ok(!keys.has(id), `unique (run_id, category, field_key): ${id}`);
        keys.add(id);
      }
      // Every quote is in the text that will be uploaded for its source.
      const textBySha = new Map(
        uploads.map((u) => [u.sha256, gunzipSync(u.body).toString("utf8")]),
      );
      for (const f of payload.findings) {
        const source = payload.sources.find((s) => s.ref === f.source_ref)!;
        assert.ok(quoteIn(textBySha.get(source.text.sha256)!, f.evidence_quote), f.field_key);
      }
      assert.equal(uploads.length, new Set(pages.map((p) => p.evidence.sha256)).size);
    });
  }

  it("uploads gzip text whose hash and size match the source metadata", () => {
    const { payload, uploads } = cases.clinic;
    const source = payload.sources[0];
    const upload = uploads.find((u) => u.sha256 === source.text.sha256)!;
    const text = gunzipSync(upload.body).toString("utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), source.text.sha256);
    assert.equal(upload.body.length, source.text.bytes);
    assert.equal(upload.contentType, "application/gzip");
  });

  it("maps categories migration 009 lacks to company_detail, keeping the original in value_json", () => {
    const shop = cases.shop.payload.findings;
    const product = shop.find((f) => f.value_text === "Organic Sencha")!;
    assert.equal(product.category, "company_detail");
    assert.match(product.field_key, /^product:/);
    assert.equal(product.value_json.category, "product");
    const industry = shop.find((f) => f.value_text === "Online Store")!;
    assert.equal(industry.category, "company_detail");
    assert.equal(industry.value_json.category, "industry");
  });

  it("derives the same storage path as the database", () => {
    assert.equal(
      evidenceStoragePath({ workspaceId: "w", leadId: "l", runId: "r" }, "a".repeat(64)),
      `w/l/r/${"a".repeat(64)}.txt.gz`,
    );
  });

  it("refuses to build a payload with an unverified quote", () => {
    const { pages, extraction } = cases.hotel;
    const tampered = {
      ...extraction,
      findings: [{ ...extraction.findings[0], quote: "We are the best hotel in Africa" }],
    };
    assert.throws(() => buildCompletionPayload(pages, tampered), PayloadError);
  });

  it("never includes AI assessments, only facts and candidates", () => {
    for (const { payload } of Object.values(cases)) {
      assert.ok(payload.findings.every((f) => f.kind !== ("assessment" as string)));
    }
  });
});
