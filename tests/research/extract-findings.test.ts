import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFromPages } from "../../src/features/research/engine/extract/extract.ts";
import {
  compareNames,
  socialProfile,
  validEmail,
} from "../../src/features/research/engine/extract/extractors.ts";
import { verifyQuote } from "../../src/features/research/engine/extract/evidence.ts";
import { FindingCollector } from "../../src/features/research/engine/extract/findings.ts";
import type {
  ExtractedFinding,
  ExtractionResult,
  ExtractionWarning,
  ParsedPage,
} from "../../src/features/research/engine/extract/types.ts";
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
  PARKED,
  pageOf,
  RESTAURANT,
  SHOP,
} from "./extract-fixtures.ts";

const pick = (
  r: ExtractionResult,
  category: ExtractedFinding["category"],
  kind?: "fact" | "candidate",
) =>
  r.findings
    .filter((f) => f.category === category && (!kind || f.kind === kind))
    .map((f) => f.value);

/** Every finding must quote text that is really on its source page. */
function assertAllVerified(r: ExtractionResult, pages: ParsedPage[]) {
  for (const f of r.findings) {
    const page = pages.find((p) => p.url === f.sourceUrl);
    assert.ok(page, `source page for ${f.key}`);
    assert.ok(verifyQuote(page, f.quote), `quote for ${f.key}: ${f.quote}`);
  }
}

describe("clinic (schema.org Dentist)", () => {
  const pages = [pageOf(CLINIC, "https://brightsmile-dental.com/")];
  const r = extractFromPages(pages, { companyName: "Bright Smile Dental LLC" });

  it("extracts company facts with evidence", () => {
    assert.deepEqual(pick(r, "website"), ["https://brightsmile-dental.com/"]);
    assert.deepEqual(pick(r, "company_name", "fact"), ["Bright Smile Dental"]);
    assert.deepEqual(pick(r, "company_name", "candidate"), []); // no title guess when the site states its name
    assert.deepEqual(pick(r, "industry"), ["Dentist", "Specialty: Dentistry"]);
    assert.equal(pick(r, "business_description", "fact").length, 1);
    assert.equal(r.nameMatch, "match");
  });

  it("lists services from the services section as candidates (needs review)", () => {
    assert.deepEqual(pick(r, "service", "candidate"), [
      "Teeth Cleaning",
      "Dental Implants",
      "Emergency Dental Care",
    ]);
    assert.deepEqual(pick(r, "service", "fact"), []);
  });

  it("merges the same email and phone found in several places", () => {
    assert.deepEqual(pick(r, "contact_email"), ["hello@brightsmile-dental.com"]);
    assert.equal(pick(r, "contact_phone").length, 1);
    assert.equal(pick(r, "contact_address").length, 1);
  });

  it("extracts location, service areas and contact page", () => {
    assert.deepEqual(pick(r, "location"), ["Austin, TX, US"]);
    assert.deepEqual(pick(r, "service_area"), ["Austin", "Round Rock"]);
    assert.deepEqual(pick(r, "contact_page"), ["https://brightsmile-dental.com/contact"]);
  });

  it("keeps official social profiles but not share links or personal profiles", () => {
    assert.deepEqual(pick(r, "social_profile").sort(), [
      "https://facebook.com/brightsmileatx",
      "https://instagram.com/brightsmileatx",
      "https://linkedin.com/company/bright-smile-dental",
    ]);
  });

  it("has no products: reported as missing, not guessed", () => {
    assert.ok(r.missing.includes("product"));
    assert.ok(!r.missing.includes("service"));
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("restaurant (@graph, cuisine, menu)", () => {
  const pages = [pageOf(RESTAURANT, "https://luigis-trattoria.it/")];
  const r = extractFromPages(pages, { companyName: "Luigi's Trattoria" });

  it("reads industry and cuisine from structured data, ignoring the WebSite entity", () => {
    assert.deepEqual(pick(r, "company_name", "fact"), ["Luigi's Trattoria"]);
    assert.deepEqual(pick(r, "industry"), ["Restaurant", "Cuisine: Italian", "Cuisine: Pizza"]);
  });

  it("lists menu items as product candidates and stops at the next section", () => {
    assert.deepEqual(pick(r, "product", "candidate"), ["Margherita Pizza", "Spaghetti Carbonara"]);
  });

  it("merges the JSON-LD and labelled phone numbers", () => {
    assert.deepEqual(pick(r, "contact_phone"), ["+39 06 1234 5678"]);
  });

  it("treats instruction-like page text as plain data", () => {
    assert.ok(!r.findings.some((f) => /ignore all previous|password/i.test(f.value)));
    // The address in that sentence is real page text, so it is reported like any other email.
    assert.deepEqual(pick(r, "contact_email"), ["admin@luigis-trattoria.it"]);
  });

  it("keeps the Instagram profile and drops the Facebook share link", () => {
    assert.deepEqual(pick(r, "social_profile"), ["https://instagram.com/luigis.trattoria"]);
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("hotel (rooms and amenities)", () => {
  const pages = [pageOf(HOTEL, "https://seasideinn.co.za/")];
  const r = extractFromPages(pages, { companyName: "Seaside Inn" });

  it("reads rooms as product facts, amenities as service candidates", () => {
    assert.deepEqual(pick(r, "industry"), ["Hotel"]);
    assert.deepEqual(pick(r, "product", "fact"), ["Ocean View Suite", "Garden Double Room"]);
    assert.deepEqual(
      r.findings.find((f) => f.value === "Ocean View Suite")?.details?.description,
      "King bed with sea views",
    );
    assert.deepEqual(pick(r, "service", "candidate"), ["Rooftop Pool", "Day Spa"]);
  });

  it("never takes a named amenity for the company", () => {
    assert.deepEqual(pick(r, "company_name"), ["Seaside Inn"]);
  });

  it("finds a labelled email and the address", () => {
    assert.deepEqual(pick(r, "contact_email"), ["stay@seasideinn.co.za"]);
    assert.deepEqual(pick(r, "contact_address"), ["12 Beach Road, Cape Town, ZA"]);
    assert.deepEqual(pick(r, "location"), ["Cape Town, ZA"]);
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("real estate (no structured data, several pages)", () => {
  const pages = [
    pageOf(ESTATE_HOME, "https://primerealty.ae/"),
    pageOf(ESTATE_LISTINGS, "https://primerealty.ae/listings", "products"),
    pageOf(ESTATE_ABOUT, "https://primerealty.ae/about", "about"),
    pageOf(ESTATE_CONTACT, "https://primerealty.ae/contact-us", "contact"),
  ];
  const r = extractFromPages(pages, { companyName: "Prime Realty" });

  it("only guesses the name from the title, as a candidate", () => {
    assert.deepEqual(pick(r, "company_name", "fact"), []);
    assert.deepEqual(pick(r, "company_name", "candidate"), ["Prime Realty"]);
    assert.equal(r.nameMatch, "match");
  });

  it("reads listings as product candidates and the about paragraph as a description candidate", () => {
    assert.deepEqual(pick(r, "product", "candidate"), ["Marina View Apartment", "Palm Villa"]);
    assert.equal(pick(r, "business_description", "candidate").length, 1);
    assert.deepEqual(pick(r, "business_description", "fact"), []);
  });

  it("reads contact details from the contact page", () => {
    assert.deepEqual(pick(r, "contact_phone", "fact"), ["+971 4 123 4567"]);
    assert.deepEqual(pick(r, "contact_email"), ["info@primerealty.ae"]);
    assert.deepEqual(pick(r, "contact_address"), ["Office 1204, Bay Tower, Business Bay, Dubai"]);
    assert.deepEqual(pick(r, "contact_page"), ["https://primerealty.ae/contact-us"]);
  });

  it("does not claim an industry without evidence", () => {
    assert.ok(r.missing.includes("industry"));
    assert.deepEqual(pick(r, "social_profile"), ["https://youtube.com/@primerealty"]);
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("e-commerce (Product JSON-LD)", () => {
  const pages = [pageOf(SHOP, "https://greenleaf-tea.com/")];
  const r = extractFromPages(pages, { companyName: "Green Leaf Tea Company" });

  it("reads products as facts, collections as candidates", () => {
    assert.deepEqual(pick(r, "industry"), ["Online Store"]);
    assert.deepEqual(pick(r, "product", "fact"), ["Organic Sencha", "Earl Grey Classic"]);
    assert.equal(
      r.findings.find((f) => f.value === "Organic Sencha")?.details?.category,
      "Green tea",
    );
    assert.deepEqual(pick(r, "product", "candidate"), ["Matcha", "Herbal Infusions"]);
    assert.equal(r.nameMatch, "match");
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("marketing agency (services page, unlabeled phone)", () => {
  const pages = [
    pageOf(AGENCY_HOME, "https://northwind-digital.co.uk/"),
    pageOf(AGENCY_SERVICES, "https://northwind-digital.co.uk/services/", "services"),
  ];
  const r = extractFromPages(pages, { companyName: "Northwind Digital Ltd" });

  it("reads services from the services page and skips generic headings", () => {
    assert.deepEqual(pick(r, "service", "candidate"), [
      "SEO",
      "Paid Social Advertising",
      "Web Design",
    ]);
  });

  it("keeps an unlabeled international number only as a candidate", () => {
    // "Talk to us:" is not a recognised label, so the number is a possible match, not a fact.
    assert.deepEqual(pick(r, "contact_phone", "fact"), []);
    assert.deepEqual(pick(r, "contact_phone", "candidate"), ["+44 20 7946 0958"]);
  });

  it("ignores placeholder emails", () => {
    assert.deepEqual(pick(r, "contact_email"), []);
    assert.ok(r.missing.includes("contact_email"));
  });

  it("verifies every quote", () => assertAllVerified(r, pages));
});

describe("missing information and warnings", () => {
  it("reports everything missing for an empty site and invents nothing", () => {
    const r = extractFromPages([pageOf(EMPTY)], { companyName: "Acme Co" });
    assert.deepEqual(
      r.findings.map((f) => f.category),
      ["website"],
    ); // "Coming soon" is not a name
    for (const c of [
      "company_name",
      "business_description",
      "industry",
      "service",
      "product",
      "contact_email",
      "contact_phone",
      "contact_page",
      "contact_address",
      "location",
      "service_area",
      "social_profile",
    ]) {
      assert.ok(r.missing.includes(c as ExtractedFinding["category"]), c);
    }
    assert.equal(r.nameMatch, "unknown");
  });

  it("warns when the website's name does not match the imported company", () => {
    const r = extractFromPages([pageOf(CLINIC, "https://brightsmile-dental.com/")], {
      companyName: "Zenith Plumbing",
    });
    assert.equal(r.nameMatch, "mismatch");
    assert.ok(r.warnings.some((w) => w.code === "name_mismatch"));
  });

  it("returns nothing for no pages", () => {
    const r = extractFromPages([]);
    assert.equal(r.website, null);
    assert.deepEqual(r.findings, []);
  });

  it("warns about parked domains", () => {
    const r = extractFromPages([pageOf(PARKED)]);
    assert.ok(r.warnings.some((w) => w.code === "parked_domain"));
  });
});

describe("FindingCollector", () => {
  const page = pageOf(CLINIC);

  it("rejects a finding whose quote is not on the page", () => {
    const warnings: ExtractionWarning[] = [];
    const c = new FindingCollector(warnings);
    assert.equal(
      c.add(page, {
        category: "service",
        kind: "fact",
        key: "service:x",
        value: "Orthodontics",
        quote: "We offer orthodontics",
        method: "page-text",
      }),
      false,
    );
    assert.equal(c.list().length, 0);
    assert.equal(warnings[0].code, "quote_rejected");
  });

  it("lets a fact replace a candidate, never the other way round", () => {
    const c = new FindingCollector([]);
    c.add(page, {
      category: "service",
      kind: "candidate",
      key: "service:teeth-cleaning",
      value: "Teeth Cleaning",
      quote: "Teeth Cleaning",
      method: "section-list-item",
    });
    c.add(page, {
      category: "service",
      kind: "fact",
      key: "service:teeth-cleaning",
      value: "Teeth Cleaning",
      quote: "Teeth Cleaning",
      method: "json-ld",
    });
    c.add(page, {
      category: "service",
      kind: "candidate",
      key: "service:teeth-cleaning",
      value: "Teeth Cleaning",
      quote: "Teeth Cleaning",
      method: "section-list-item",
    });
    assert.deepEqual(
      c.list().map((f) => f.kind),
      ["fact"],
    );
  });

  it("enforces per-category caps with a warning", () => {
    const warnings: ExtractionWarning[] = [];
    const c = new FindingCollector(warnings);
    // Values must be stated in their quote (Phase 3B.1), so each uses a supported value.
    for (let i = 0; i < 5; i++)
      c.add(page, {
        category: "contact_page",
        kind: "fact",
        key: `contact_page:${i}`,
        value: "Teeth Cleaning",
        quote: "Teeth Cleaning",
        method: "site-link",
      });
    assert.equal(c.count("contact_page"), 2);
    assert.equal(warnings.filter((w) => w.code === "limit_reached").length, 1);
  });
});

describe("helpers", () => {
  it("validates business emails", () => {
    assert.equal(validEmail("Info@Acme-Co.com"), "info@acme-co.com");
    for (const bad of ["name@example.com", "logo@2x.png", "user@sentry.io", "a@b", "not-an-email"])
      assert.equal(validEmail(bad), null, bad);
  });

  it("recognises social profiles", () => {
    assert.deepEqual(socialProfile("https://m.facebook.com/acme/?ref=1"), {
      platform: "facebook",
      canonical: "https://facebook.com/acme",
      host: "facebook.com",
      id: "acme",
    });
    assert.deepEqual(socialProfile("https://wa.me/15125550142"), {
      platform: "whatsapp",
      canonical: "https://wa.me/15125550142",
      host: "wa.me",
      id: "15125550142",
    });
    for (const not of [
      "https://facebook.com/",
      "https://www.facebook.com/sharer.php?u=x",
      "https://l.facebook.com/l.php?u=x",
      "https://twitter.com/intent/tweet",
      "https://www.linkedin.com/in/someone",
      "https://acme-co.com/facebook",
      "javascript:alert(1)",
    ]) {
      assert.equal(socialProfile(not), null, not);
    }
  });

  it("compares names loosely", () => {
    assert.equal(compareNames("Acme Plumbing LLC", ["Acme Plumbing"]), "match");
    assert.equal(compareNames("Acme Plumbing", ["Acme Heating & Air"]), "partial");
    assert.equal(compareNames("Acme Plumbing", ["Zenith Dental"]), "mismatch");
    assert.equal(compareNames("", ["Acme"]), "unknown");
    assert.equal(compareNames("Acme", []), "unknown");
  });
});
