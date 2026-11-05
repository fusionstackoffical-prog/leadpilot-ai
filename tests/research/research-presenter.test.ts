// The findings presenter, driven by REAL Phase 3B output: extraction -> migration 009 payload ->
// stored-row shape -> sections. Also hostile website content, which must stay inert plain text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyQuote } from "../../src/features/research/engine/extract/evidence.ts";
import { extractFromPages } from "../../src/features/research/engine/extract/extract.ts";
import {
  buildCompletionPayload,
  type CompletionPayload,
} from "../../src/features/research/engine/extract/payload.ts";
import type { ParsedPage } from "../../src/features/research/engine/extract/types.ts";
import {
  countFindings,
  describeMethod,
  emptyResultsText,
  engineCategoryOf,
  groupFindings,
  linkOf,
  MAX_QUOTE,
  missingInformation,
  NOT_FOUND_TEXT,
  plain,
  presentSource,
  presentWarnings,
  type FindingRow,
  type PresentedFinding,
  type SourceRow,
} from "../../src/features/research/presenter.ts";
import {
  AGENCY_HOME,
  AGENCY_SERVICES,
  CLINIC,
  EMPTY,
  ESTATE_ABOUT,
  ESTATE_CONTACT,
  ESTATE_HOME,
  ESTATE_LISTINGS,
  HOTEL,
  pageOf,
  PARKED,
  RESTAURANT,
  SHOP,
} from "./extract-fixtures.ts";

const VERIFIED_AT = "2026-11-04T10:00:00.000Z";

/** What the database stores after worker_complete_research_run saves a payload. */
function storedRows(payload: CompletionPayload) {
  const findings: FindingRow[] = payload.findings.map((f) => ({
    id: f.ref,
    category: f.category,
    kind: f.kind,
    field_key: f.field_key,
    value_text: f.value_text,
    value_json: f.value_json as FindingRow["value_json"],
    source_id: f.source_ref,
    evidence_quote: f.evidence_quote,
    quote_check: f.quote_check ?? null,
    quote_verified_at: f.quote_check ? VERIFIED_AT : null,
    confidence: null,
    created_at: VERIFIED_AT,
  }));
  const sources: SourceRow[] = payload.sources.map((s) => ({
    id: s.ref,
    url: s.url,
    final_url: s.final_url,
    title: s.title,
    retrieved_at: s.retrieved_at,
    http_status: s.http_status,
    source_type: s.source_type,
  }));
  return { findings, sources };
}

function research(pages: ParsedPage[], companyName = "Test Company") {
  const result = extractFromPages(pages, { companyName });
  const { payload } = buildCompletionPayload(pages, result);
  return { pages, payload, ...storedRows(payload) };
}

const SITES: Record<string, ParsedPage[]> = {
  clinic: [pageOf(CLINIC)],
  restaurant: [pageOf(RESTAURANT)],
  hotel: [pageOf(HOTEL)],
  shop: [pageOf(SHOP)],
  agency: [
    pageOf(AGENCY_HOME),
    pageOf(AGENCY_SERVICES, "https://acme-co.com/services", "services"),
  ],
  estate: [
    pageOf(ESTATE_HOME, "https://primerealty.ae/"),
    pageOf(ESTATE_LISTINGS, "https://primerealty.ae/listings", "products"),
    pageOf(ESTATE_ABOUT, "https://primerealty.ae/about", "about"),
    pageOf(ESTATE_CONTACT, "https://primerealty.ae/contact-us", "contact"),
  ],
  parked: [pageOf(PARKED)],
  empty: [pageOf(EMPTY)],
};

const total = (sections: ReturnType<typeof groupFindings>) =>
  Object.values(sections).reduce((n, list) => n + list.length, 0);

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  id: "f1",
  category: "service",
  kind: "fact",
  field_key: "service:x",
  value_text: "Teeth Cleaning",
  value_json: { category: "service", method: "page-text" },
  source_id: "s1",
  evidence_quote: "Teeth Cleaning",
  quote_check: "normalized_exact_v1",
  quote_verified_at: VERIFIED_AT,
  confidence: null,
  created_at: VERIFIED_AT,
  ...over,
});

const src = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "s1",
  url: "https://acme-co.com/",
  final_url: "https://acme-co.com/",
  title: "Acme",
  retrieved_at: VERIFIED_AT,
  http_status: 200,
  source_type: "company_website",
  ...over,
});

describe("database category mapping (migration 009 <-> the 13 engine categories)", () => {
  const detail = (category: unknown, field_key: string) => ({
    category: "company_detail",
    field_key,
    value_json: category === undefined ? null : ({ category } as FindingRow["value_json"]),
  });

  it("passes the directly stored categories through", () => {
    for (const category of [
      "business_description",
      "service",
      "service_area",
      "location",
      "contact_email",
      "contact_phone",
      "contact_address",
      "social_profile",
    ]) {
      assert.equal(engineCategoryOf({ category, field_key: "x", value_json: null }), category);
    }
  });

  it("recovers company_detail types from value_json.category", () => {
    for (const category of ["company_name", "website", "industry", "product", "contact_page"]) {
      assert.equal(engineCategoryOf(detail(category, "anything")), category);
    }
  });

  it("falls back to the field_key prefix when value_json is missing", () => {
    assert.equal(engineCategoryOf(detail(undefined, "name:acme-dental")), "company_name");
    assert.equal(engineCategoryOf(detail(undefined, "industry:cuisine:italian")), "industry");
    assert.equal(engineCategoryOf(detail(undefined, "product:tea")), "product");
    assert.equal(engineCategoryOf(detail(undefined, "contact_page:contact")), "contact_page");
    assert.equal(engineCategoryOf(detail(undefined, "website")), "website");
  });

  it("prefers the stated category over a conflicting key prefix", () => {
    assert.equal(engineCategoryOf(detail("product", "industry:x")), "product");
  });

  it("ignores a stated category it doesn't know, and an unusable value_json", () => {
    assert.equal(
      engineCategoryOf(detail("service", "product:x")),
      "product",
      "service is not a detail type",
    );
    assert.equal(engineCategoryOf(detail("<script>", "name:x")), "company_name");
    assert.equal(
      engineCategoryOf({
        category: "company_detail",
        field_key: "name:x",
        value_json: ["company_name"],
      }),
      "company_name",
    );
    assert.equal(
      engineCategoryOf({ category: "company_detail", field_key: "name:x", value_json: "industry" }),
      "company_name",
    );
  });

  it("returns null for stored categories the engine doesn't write", () => {
    assert.equal(engineCategoryOf(detail(undefined, "mystery:x")), null);
    assert.equal(engineCategoryOf(detail("nonsense", "mystery:x")), null);
    for (const category of [
      "person",
      "certification",
      "company_summary",
      "observation",
      "challenge",
      "opportunity",
      "bogus",
    ]) {
      assert.equal(
        engineCategoryOf({ category, field_key: "x", value_json: null }),
        null,
        category,
      );
    }
  });
});

describe("real Phase 3B payloads", () => {
  for (const [name, pages] of Object.entries(SITES)) {
    it(`${name}: every stored finding lands in exactly one section; nothing is dropped`, () => {
      const { findings, sources, payload } = research(pages);
      const sections = groupFindings(findings, sources);
      assert.equal(total(sections), payload.findings.length);
      assert.equal(
        sections.other.length,
        0,
        "the engine only writes categories the presenter knows",
      );
    });
  }

  it("clinic: groups company information, services, contacts, locations and social profiles", () => {
    const { findings, sources } = research(SITES.clinic);
    const s = groupFindings(findings, sources);
    assert.deepEqual(
      s.companyNames.map((f) => f.value),
      ["Bright Smile Dental"],
    );
    assert.ok(s.industries.some((f) => f.value === "Dentist"));
    assert.deepEqual(s.services.map((f) => f.value).sort(), [
      "Dental Implants",
      "Emergency Dental Care",
      "Teeth Cleaning",
    ]);
    assert.deepEqual(
      s.emails.map((f) => f.value),
      ["hello@brightsmile-dental.com"],
    );
    assert.equal(s.phones.length, 1);
    assert.deepEqual(
      s.addresses.map((f) => f.value),
      ["100 Congress Ave, Austin, TX, 78701, US"],
    );
    assert.deepEqual(
      s.locations.map((f) => f.value),
      ["Austin, TX, US"],
    );
    assert.deepEqual(s.serviceAreas.map((f) => f.value).sort(), ["Austin", "Round Rock"]);
    assert.deepEqual(s.socialProfiles.map((f) => f.value).sort(), [
      "https://facebook.com/brightsmileatx",
      "https://instagram.com/brightsmileatx",
      "https://linkedin.com/company/bright-smile-dental",
    ]);
    assert.equal(s.products.length, 0);
  });

  it("restaurant, shop and estate: products and company_detail types are recovered", () => {
    const restaurant = sectionsOf(SITES.restaurant);
    assert.deepEqual(restaurant.products.map((f) => f.value).sort(), [
      "Margherita Pizza",
      "Spaghetti Carbonara",
    ]);
    assert.ok(restaurant.industries.some((f) => f.value === "Restaurant"));

    const shop = sectionsOf(SITES.shop);
    assert.ok(shop.products.length >= 3);

    const estate = sectionsOf(SITES.estate);
    assert.ok(estate.contactPages.some((f) => f.value === "https://primerealty.ae/contact-us"));
    assert.ok(estate.products.some((f) => f.value === "Palm Villa"));
  });

  it("every confirmed finding shows its source, its quote and its verification status", () => {
    for (const [name, pages] of Object.entries(SITES)) {
      const { findings, sources } = research(pages);
      const sections = groupFindings(findings, sources);
      for (const list of Object.values(sections)) {
        for (const f of list as PresentedFinding[]) {
          if (f.verification !== "confirmed") continue;
          assert.equal(f.kind, "fact", name);
          assert.ok(f.source, `${name}: ${f.value} has no source`);
          assert.ok(f.quote && f.quote.length >= 3, `${name}: ${f.value} has no quote`);
          assert.equal(f.verificationLabel, "Confirmed");
          assert.equal(f.verifiedAt, VERIFIED_AT);
          assert.match(f.source.urlText, /^https:\/\//);
          assert.match(f.source.href ?? "", /^https:\/\//);
        }
      }
    }
  });

  it("each finding is linked to the page it really came from: its quotes are found in that page's stored text", () => {
    for (const [name, pages] of Object.entries(SITES)) {
      const { findings, sources } = research(pages);
      const byRef = new Map(sources.map((s, i) => [s.id, pages[i]]));
      const sections = groupFindings(findings, sources);
      let checked = 0;
      for (const list of Object.values(sections)) {
        for (const f of list as PresentedFinding[]) {
          if (!f.source || !f.quote) continue;
          const page = byRef.get(f.source.id);
          assert.ok(page, `${name}: unknown source ${f.source.id}`);
          assert.equal(f.source.urlText, page.requestedUrl, name);
          assert.ok(verifyQuote(page, f.quote), `${name}: quote for "${f.value}" not on its page`);
          for (const extra of f.extraEvidence) {
            assert.ok(
              verifyQuote(page, extra),
              `${name}: extra evidence for "${f.value}" not on its page`,
            );
          }
          checked++;
        }
      }
      if (name !== "empty" && name !== "parked") assert.ok(checked > 0, name);
    }
  });

  it("a value built from several parts shows each part as supporting evidence", () => {
    const { findings, sources } = research(SITES.clinic);
    const address = groupFindings(findings, sources).addresses[0];
    assert.equal(address.verification, "confirmed");
    assert.ok(address.extraEvidence.length >= 3, "street, city, region, postcode... each quoted");
    assert.ok(
      address.details.some((d) => d.label === "streetAddress" && d.value === "100 Congress Ave"),
    );
  });

  it("shows unverified candidates separately from confirmed facts, never as confirmed", () => {
    const page = pageOf(
      `<main><blockquote>Thanks! Write to jo@client-company.com</blockquote></main><footer>Email: hello@acme-co.com</footer>`,
    );
    const { findings, sources } = research([page]);
    const s = groupFindings(findings, sources);
    const candidate = s.emails.find((f) => f.value === "jo@client-company.com");
    const fact = s.emails.find((f) => f.value === "hello@acme-co.com");
    assert.equal(candidate?.kind, "candidate");
    assert.equal(candidate?.verification, "unconfirmed");
    assert.equal(candidate?.verificationLabel, "Unconfirmed: needs review");
    assert.equal(candidate?.verifiedAt, null);
    assert.ok(candidate?.source && candidate.quote, "a candidate still shows where it was seen");
    assert.equal(fact?.verification, "confirmed");
    assert.equal(s.emails[0].value, "hello@acme-co.com", "confirmed items come first");
    assert.ok(countFindings(s).unconfirmed >= 1);
  });

  it("presents the engine's own totals", () => {
    const { findings, sources, payload } = research(SITES.clinic);
    const counts = countFindings(groupFindings(findings, sources));
    assert.equal(counts.confirmed, payload.findings.filter((f) => f.kind === "fact").length);
    assert.equal(counts.unconfirmed, payload.findings.filter((f) => f.kind === "candidate").length);
  });
});

/** Research a set of pages and present what was stored. */
function sectionsOf(pages: ParsedPage[]) {
  const { findings, sources } = research(pages);
  return groupFindings(findings, sources);
}

describe("a 'fact' without proof is never shown as confirmed", () => {
  it("downgrades a fact with no source", () => {
    const s = groupFindings([row({ source_id: null })], [src()]);
    assert.equal(s.services[0].verification, "unconfirmed");
    assert.match(s.services[0].verificationLabel, /source or quote is unavailable/);
    assert.equal(s.services[0].verifiedAt, null);
  });

  it("downgrades a fact whose source id is unknown", () => {
    assert.equal(
      groupFindings([row({ source_id: "nope" })], [src()]).services[0].verification,
      "unconfirmed",
    );
  });

  it("downgrades a fact with no quote, or an empty one", () => {
    for (const evidence_quote of [null, "", "   "]) {
      const f = groupFindings([row({ evidence_quote })], [src()]).services[0];
      assert.equal(f.verification, "unconfirmed", String(evidence_quote));
      assert.equal(f.quote, null);
    }
  });

  it("confirms a fact that has both", () => {
    const f = groupFindings([row()], [src()]).services[0];
    assert.equal(f.verification, "confirmed");
    assert.equal(f.source?.label, "Acme");
  });
});

describe("missing information", () => {
  it("lists what was not found, with the honest wording", () => {
    assert.equal(NOT_FOUND_TEXT, "Not found in the pages researched.");
    const { findings, sources } = research(SITES.shop);
    const missing = missingInformation(groupFindings(findings, sources));
    assert.ok(missing.length > 0);
    for (const item of missing) assert.equal(item.text, NOT_FOUND_TEXT);
    const labels = missing.map((m) => m.label);
    assert.ok(labels.includes("Business email"));
    assert.ok(labels.includes("Phone number"));
    assert.ok(!labels.includes("Products"), "the shop's products were found");
    assert.ok(!labels.includes("Company name"));
    assert.equal(new Set(labels).size, labels.length);
  });

  it("an empty website yields no invented values", () => {
    const { findings, sources } = research(SITES.empty);
    const s = groupFindings(findings, sources);
    const found = Object.entries(s)
      .filter(([, list]) => list.length > 0)
      .map(([k]) => k);
    for (const key of ["emails", "phones", "addresses", "services", "products", "socialProfiles"]) {
      assert.ok(!found.includes(key), `${key} must be empty for an empty page`);
    }
    const missing = missingInformation(s).map((m) => m.label);
    for (const label of [
      "Business email",
      "Phone number",
      "Address",
      "Services",
      "Products",
      "Social profiles",
    ]) {
      assert.ok(missing.includes(label), label);
    }
  });

  it("reports nothing missing when every group has something, and never lists the website", () => {
    const keys: [string, string, string][] = [
      ["company_detail", "name:a", "company_name"],
      ["business_description", "description:a", ""],
      ["company_detail", "industry:a", "industry"],
      ["service", "service:a", ""],
      ["company_detail", "product:a", "product"],
      ["contact_email", "email:a", ""],
      ["contact_phone", "phone:a", ""],
      ["company_detail", "contact_page:a", "contact_page"],
      ["contact_address", "address:a", ""],
      ["location", "location:a", ""],
      ["service_area", "area:a", ""],
      ["social_profile", "social:a", ""],
    ];
    const rows = keys.map(([category, field_key, detailType], i) =>
      row({
        id: `f${i}`,
        category,
        field_key,
        value_json: detailType ? { category: detailType } : null,
      }),
    );
    const missing = missingInformation(groupFindings(rows, [src()]));
    assert.deepEqual(missing, []);
    assert.ok(!missingInformation(groupFindings([], [])).some((m) => /website/i.test(m.label)));
  });

  it("a candidate counts as found (it is shown, unconfirmed)", () => {
    const s = groupFindings(
      [row({ kind: "candidate", quote_check: null, quote_verified_at: null })],
      [src()],
    );
    assert.ok(!missingInformation(s).some((m) => m.label === "Services"));
  });
});

describe("warnings", () => {
  it("explains each warning the engine can emit, without repeating the engine's own message", () => {
    const codes = [
      "page_failed",
      "page_skipped_robots",
      "page_skipped_offsite",
      "page_needs_javascript",
      "page_parse_limited",
      "page_parse_failed",
      "crawl_deadline",
      "parked_domain",
      "name_mismatch",
      "evidence_truncated",
      "quote_rejected",
      "evidence_insufficient",
      "limit_reached",
    ];
    const raw = codes.map((code) => ({
      code,
      message: `ENGINE TEXT ${code} <b>x</b>`,
      url: "https://acme-co.com/about",
    }));
    const out = presentWarnings(raw);
    assert.equal(out.length, codes.length);
    for (const [i, w] of out.entries()) {
      assert.equal(w.code, codes[i]);
      assert.ok(w.title.length > 0 && w.detail.length > 0);
      assert.doesNotMatch(w.title + w.detail, /ENGINE TEXT|<b>/);
      assert.equal(w.page, "acme-co.com");
      assert.equal(w.href, "https://acme-co.com/about");
    }
  });

  it("copes with missing, malformed and oversized input", () => {
    for (const raw of [null, undefined, {}, "x", 3, [], [null, 1, "x", []]]) {
      assert.deepEqual(presentWarnings(raw as never), []);
    }
    const many = Array.from({ length: 80 }, () => ({ code: "page_failed" }));
    assert.equal(presentWarnings(many).length, 50);
  });

  it("an unknown or hostile code never reaches the page as text it could carry", () => {
    const [a, b, c] = presentWarnings([
      { code: "brand_new_code" },
      { code: "<script>alert(1)</script>" },
      { code: 42 },
    ]);
    assert.equal(a.title, "Warning (brand_new_code)");
    assert.equal(b.code, "unknown");
    assert.doesNotMatch(b.title, /script/);
    assert.equal(c.code, "unknown");
  });

  it("names and links a warning's page only when it is a safe address", () => {
    const out = presentWarnings([
      { code: "page_failed", url: "javascript:alert(1)" },
      { code: "page_failed", url: "data:text/html,<script>1</script>" },
      // Contains spaces, so it is not a safe address: no page is named and nothing is linked.
      { code: "page_failed", url: 'https://evil.example/"><img src=x onerror=alert(1)>' },
      // No spaces: the address is encoded, so the link can't carry markup out of the attribute.
      { code: "page_failed", url: 'https://evil.example/"><script>alert(1)</script>' },
      { code: "page_failed", url: "//evil.example/x" },
      { code: "page_failed", url: "evil.example" },
      { code: "page_failed" },
    ]);
    for (const i of [0, 1, 2, 4, 5, 6]) {
      assert.equal(out[i].href, null, `entry ${i}`);
      assert.equal(out[i].page, null, `entry ${i}`);
    }
    assert.equal(out[3].page, "evil.example");
    assert.match(out[3].href ?? "", /^https:\/\/evil\.example\//);
    assert.doesNotMatch(out[3].href ?? "", /[<>"]/);
  });

  it("only links an address that carries an explicit http(s) scheme (linkOf)", () => {
    assert.equal(linkOf("https://acme-co.com/about"), "https://acme-co.com/about");
    assert.equal(linkOf("  http://acme-co.com/ "), "http://acme-co.com/");
    for (const text of [
      "acme-co.com",
      "//acme-co.com/x",
      "www.acme-co.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "mailto:a@b.co",
      "ftp://acme-co.com/",
      "https://user:pw@acme-co.com/",
      "https://localhost/",
      "https://127.0.0.1/",
      "https://acme co.com/",
      "",
      "   ",
      null,
      undefined,
    ]) {
      assert.equal(linkOf(text), null, String(text));
    }
  });

  it("real crawl warnings flow through the same mapping", () => {
    const { payload } = research(SITES.parked);
    const out = presentWarnings(payload.warnings as never);
    assert.ok(
      out.some((w) => w.code === "parked_domain"),
      JSON.stringify(payload.warnings),
    );
  });
});

describe("hostile website content stays inert plain text", () => {
  const HOSTILE = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(document.cookie)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:attacker@evil.example",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://evil.example/x",
    "//evil.example/x",
    "https://user:pass@evil.example/",
    "http://localhost/admin",
    "http://127.0.0.1/",
    "&lt;b&gt;bold&lt;/b&gt; {{7*7}} ${1+1}",
  ];

  it("never turns a hostile value into a link, in any category that may link", () => {
    for (const category of ["social_profile", "company_detail"]) {
      for (const value of HOSTILE) {
        for (const detailType of category === "company_detail"
          ? ["website", "contact_page"]
          : [""]) {
          const rows = [
            row({
              category,
              field_key: detailType ? `${detailType}:x` : "social:x",
              value_text: value,
              value_json: detailType ? { category: detailType } : null,
            }),
          ];
          const s = groupFindings(rows, [src()]);
          const f = [...s.socialProfiles, ...s.websites, ...s.contactPages][0];
          assert.ok(f, `${category}/${detailType}: ${value}`);
          assert.equal(f.href, null, `${value} must not be a link`);
          assert.equal(f.value, value.trim(), "the text is kept exactly, as plain text");
        }
      }
    }
  });

  it("links a genuine https address, with the value shown as text too", () => {
    const f = groupFindings(
      [
        row({
          category: "social_profile",
          field_key: "social:x",
          value_text: "https://facebook.com/acme",
          value_json: null,
        }),
      ],
      [src()],
    ).socialProfiles[0];
    assert.equal(f.href, "https://facebook.com/acme");
    assert.equal(f.value, "https://facebook.com/acme");
  });

  it("never links emails, phones, services or anything else, even when the value is a web address", () => {
    for (const category of [
      "contact_email",
      "contact_phone",
      "service",
      "service_area",
      "location",
      "contact_address",
      "business_description",
    ]) {
      const f = groupFindings(
        [
          row({
            category,
            field_key: "x:y",
            value_text: "https://evil.example/login",
            value_json: null,
          }),
        ],
        [src()],
      );
      const item = Object.values(f).flat()[0] as { href: string | null };
      assert.equal(item.href, null, category);
    }
  });

  it("keeps markup in values, quotes, titles and details as literal characters", () => {
    const evil = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const s = groupFindings(
      [
        row({
          value_text: evil,
          evidence_quote: evil,
          value_json: {
            category: "service",
            method: evil,
            evidence: [evil],
            details: { "<script>": evil, streetAddress: evil },
          },
        }),
      ],
      [src({ title: evil, url: "https://acme-co.com/", final_url: "https://acme-co.com/" })],
    );
    const f = s.services[0];
    assert.equal(f.value, evil);
    assert.equal(f.quote, evil);
    assert.deepEqual(f.extraEvidence, [evil]);
    assert.equal(f.source?.label, evil);
    assert.deepEqual(
      f.details,
      [{ label: "streetAddress", value: evil }],
      "a markup-like detail LABEL is dropped",
    );
    assert.doesNotMatch(f.method ?? "", /^$/);
    assert.equal(typeof f.method, "string");
  });

  it("hostile source addresses are text only", () => {
    const hostile = presentSource(
      src({ url: "javascript:alert(1)", final_url: null, title: null }),
    );
    assert.equal(hostile.href, null);
    assert.equal(hostile.urlText, "javascript:alert(1)");

    const encoded = presentSource(
      src({ url: 'https://evil.example/"><script>alert(1)</script>', final_url: null }),
    );
    assert.doesNotMatch(encoded.href ?? "", /[<>"]/);
    assert.equal(encoded.label, "Acme");

    const credentials = presentSource(
      src({ url: "https://user:pass@evil.example/", final_url: null }),
    );
    assert.equal(credentials.href, null);
  });

  it("presents only serialisable plain data (no markup objects)", () => {
    const { findings, sources } = research([pageOf(CLINIC)]);
    const s = groupFindings(findings, sources);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    const collect = (value: unknown, out: unknown[] = []): unknown[] => {
      if (value === null || typeof value !== "object") out.push(value);
      else for (const v of Object.values(value)) collect(v, out);
      return out;
    };
    for (const leaf of collect(s))
      assert.ok(["string", "number", "boolean"].includes(typeof leaf) || leaf === null);
  });

  it("limits the length of every displayed string", () => {
    const long = "x".repeat(5000);
    const f = groupFindings(
      [
        row({
          value_text: long,
          evidence_quote: long,
          value_json: { category: "service", evidence: [long] },
        }),
      ],
      [src({ title: long })],
    ).services[0];
    assert.ok(f.value.length <= 600);
    assert.ok((f.quote ?? "").length <= MAX_QUOTE);
    assert.ok(f.extraEvidence[0].length <= 300);
    assert.ok((f.source?.label ?? "").length <= 160);
  });
});

describe("plain()", () => {
  it("removes control characters but keeps line breaks and tabs", () => {
    assert.equal(plain("a\u0000b\u001bc\u007fd\u0085e\u009ff", 50), "abcdef");
    assert.equal(plain("line one\nline two\tend", 50), "line one\nline two\tend");
  });

  it("trims, and returns '' for anything that isn't a string", () => {
    assert.equal(plain("  hi  ", 10), "hi");
    for (const value of [null, undefined, 5, {}, []]) assert.equal(plain(value, 10), "");
  });

  it("cuts on a character boundary, never inside an emoji", () => {
    const out = plain("😀".repeat(50), 10);
    assert.ok(out.isWellFormed());
    assert.equal(Array.from(out).length, 10);
    assert.ok(out.endsWith("…"));
    assert.equal(plain("😀😀", 10), "😀😀");
  });
});

describe("AI assessments (none exist yet) are kept apart from facts", () => {
  it("maps each assessment category to its own section and never counts it as a finding", () => {
    const assess = (id: string, category: string) =>
      row({
        id,
        kind: "assessment",
        category,
        source_id: null,
        evidence_quote: null,
        quote_check: null,
        quote_verified_at: null,
        confidence: 0.6,
        value_text: `${category} text`,
      });
    const s = groupFindings(
      [
        assess("a", "company_summary"),
        assess("b", "observation"),
        assess("c", "challenge"),
        assess("d", "opportunity"),
      ],
      [],
    );
    assert.deepEqual(
      s.summary.map((a) => a.text),
      ["company_summary text"],
    );
    assert.deepEqual(
      s.observations.map((a) => a.text),
      ["observation text"],
    );
    assert.deepEqual(
      s.challenges.map((a) => a.text),
      ["challenge text"],
    );
    assert.deepEqual(
      s.opportunities.map((a) => a.text),
      ["opportunity text"],
    );
    assert.equal(s.observations[0].confidence, 0.6);
    assert.deepEqual(countFindings(s), { confirmed: 0, unconfirmed: 0 });
  });
});

describe("robustness", () => {
  it("shows a stored category it doesn't know under 'other' instead of dropping it", () => {
    const s = groupFindings([row({ category: "person", field_key: "person:x" })], [src()]);
    assert.equal(s.other.length, 1);
    assert.equal(s.other[0].category, "other");
  });

  it("skips rows of an unknown kind", () => {
    assert.equal(total(groupFindings([row({ kind: "weird" })], [src()])), 0);
  });

  it("handles a run with no findings and no sources", () => {
    const s = groupFindings([], []);
    assert.equal(total(s), 0);
    assert.equal(missingInformation(s).length, 12);
  });

  it("sorts confirmed before unconfirmed, then alphabetically", () => {
    const rows = [
      row({ id: "1", value_text: "Zeta" }),
      row({
        id: "2",
        value_text: "Alpha",
        kind: "candidate",
        quote_check: null,
        quote_verified_at: null,
      }),
      row({ id: "3", value_text: "Beta" }),
    ];
    assert.deepEqual(
      groupFindings(rows, [src()]).services.map((f) => f.value),
      ["Beta", "Zeta", "Alpha"],
    );
  });
});

describe("wording helpers", () => {
  it("names every extraction method the engine uses, and nothing for an unknown one", () => {
    const methods = [
      "json-ld",
      "meta-description",
      "og-site-name",
      "page-title",
      "page-url",
      "page-text",
      "address-element",
      "mailto-link",
      "tel-link",
      "labelled-text",
      "section-heading",
      "section-list-item",
      "site-link",
    ];
    for (const method of methods) {
      const text = describeMethod(method);
      assert.ok(text && text.length > 3, method);
      assert.doesNotMatch(text, /<|>|\{|\}/);
    }
    for (const unknown of ["brand-new", "<script>", "", null, undefined]) {
      assert.equal(describeMethod(unknown), null, String(unknown));
    }
  });

  it("every method that real research produces has a plain-language name", () => {
    const seen = new Set<string>();
    for (const pages of Object.values(SITES)) {
      for (const f of research(pages).findings) {
        const method = (f.value_json as { method?: unknown } | null)?.method;
        if (typeof method === "string") seen.add(method);
      }
    }
    assert.ok(seen.size > 5);
    for (const method of seen) assert.ok(describeMethod(method), `no wording for "${method}"`);
  });

  it("an empty list only claims 'not found' when research actually finished", () => {
    for (const runStatus of ["completed", "completed_with_warnings"]) {
      assert.equal(emptyResultsText({ runStatus, active: false }), NOT_FOUND_TEXT);
    }
    for (const runStatus of ["failed", "cancelled"]) {
      assert.match(emptyResultsText({ runStatus, active: false }), /didn't finish/);
    }
    for (const runStatus of ["queued", "running", null]) {
      assert.match(emptyResultsText({ runStatus, active: true }), /in progress/);
    }
    assert.match(emptyResultsText({ runStatus: "queued", active: false }), /in progress/);
    assert.match(
      emptyResultsText({ runStatus: null, active: false }),
      /Not researched yet\. Nothing has been looked up or inferred/,
    );
    // The two claims are never confused.
    assert.doesNotMatch(
      emptyResultsText({ runStatus: null, active: false }),
      /Not found in the pages/,
    );
    assert.doesNotMatch(
      emptyResultsText({ runStatus: "failed", active: false }),
      /Not found in the pages/,
    );
  });
});
