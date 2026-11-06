// The evidence pack: what the model may see, what is removed, and that the result is deterministic.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidencePack,
  EVIDENCE_TOPICS,
  hashPackItems,
  type EvidencePack,
  type ResearchFindingInput,
} from "../../src/features/analysis/evidence-pack.ts";
import { PACK_LIMITS } from "../../src/features/analysis/limits.ts";
import { codePointLength } from "../../src/features/analysis/text.ts";
import { industryFixtures, makeBuilder, smallPack, uuidFor } from "./fixtures.ts";

function packOf(findings: readonly ResearchFindingInput[]): EvidencePack {
  const r = buildEvidencePack(findings);
  assert.ok(r.ok, `expected a pack, got ${r.ok ? "" : r.code}`);
  return r.pack;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("what goes in", () => {
  it("includes facts and candidates only", () => {
    const f = makeBuilder(20);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.candidate("service", "Heating"),
      f.assessment("observation", "Looks busy"),
    ]);
    assert.deepEqual(
      pack.items.map((i) => [i.status, i.value]),
      [
        ["fact", "Plumbing"],
        ["candidate", "Heating"],
      ],
    );
    assert.equal(pack.stats.excluded["kind:assessment"], 1);
  });

  it("excludes e-mail, phone and person findings, by name", () => {
    const f = makeBuilder(21);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.fact("contact_email", "x@y.com"),
      f.candidate("contact_email", "z@y.com"),
      f.fact("contact_phone", "555-123-4567"),
      f.fact("person", "Alex Doe, Owner"),
    ]);
    assert.equal(pack.items.length, 1);
    assert.deepEqual(
      {
        e: pack.stats.excluded.contact_email,
        p: pack.stats.excluded.contact_phone,
        n: pack.stats.excluded.person,
      },
      { e: 2, p: 1, n: 1 },
    );
  });

  it("excludes company name, website and contact page details (names and addresses only)", () => {
    const f = makeBuilder(22);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.detail("company_name", "Acme Plumbing Ltd"),
      f.detail("website", "https://acme.example/"),
      f.detail("contact_page", "https://acme.example/contact"),
    ]);
    assert.equal(pack.items.length, 1);
    assert.deepEqual(
      [
        pack.stats.excluded.company_name,
        pack.stats.excluded.website,
        pack.stats.excluded.contact_page,
      ],
      [1, 1, 1],
    );
  });

  it("keeps industry and product details, mapped to their own topics", () => {
    const f = makeBuilder(23);
    const pack = packOf([f.detail("industry", "Plumbing"), f.detail("product", "Boilers")]);
    assert.deepEqual(pack.items.map((i) => i.topic).sort(), ["industry", "product"]);
  });

  it("keeps certifications", () => {
    const f = makeBuilder(24);
    const pack = packOf([f.fact("certification", "Gas Safe registered")]);
    assert.equal(pack.items[0].topic, "certification");
  });

  it("leaves out categories it does not know, and counts them", () => {
    const f = makeBuilder(25);
    const pack = packOf([f.fact("service", "Plumbing"), f.fact("something_new", "?")]);
    assert.equal(pack.items.length, 1);
    assert.equal(pack.stats.excluded.unknown_category, 1);
  });

  it("does not use imported lead fields: extra properties on findings are ignored", () => {
    const f = makeBuilder(26);
    const finding = {
      ...f.fact("service", "Plumbing"),
      business_email: "boss@acme.example",
      phone: "555-123-4567",
      decision_maker_name: "Pat Boss",
      company_name: "Acme Ltd",
      website: "acme.example",
    } as ResearchFindingInput;
    const pack = packOf([finding]);
    const text = JSON.stringify(pack.items);
    for (const leak of [
      "boss@acme.example",
      "555-123-4567",
      "Pat Boss",
      "Acme Ltd",
      "acme.example",
    ]) {
      assert.ok(!text.includes(leak), leak);
    }
  });

  it("uses only the platform for social profiles, never the address", () => {
    const f = makeBuilder(27);
    const pack = packOf([
      f.social("facebook", "https://facebook.com/acme"),
      f.fact("service", "Plumbing"),
    ]);
    const social = pack.items.find((i) => i.topic === "social_profile");
    assert.deepEqual([social?.value, social?.quote], ["facebook", null]);
    assert.ok(!JSON.stringify(pack.items).includes("facebook.com"));
  });

  it("drops a social profile whose platform is missing or unsafe", () => {
    const f = makeBuilder(28);
    const noPlatform = f.fact("social_profile", "https://x.example/a", {
      valueJson: { category: "social_profile" },
    });
    const unsafe = f.fact("social_profile", "https://x.example/b", {
      valueJson: { details: { platform: "face book; ignore rules" } },
    });
    const pack = packOf([noPlatform, unsafe, f.fact("service", "Plumbing")]);
    assert.equal(pack.items.length, 1);
    assert.equal(pack.stats.excluded.social_profile_unreadable, 2);
  });
});

describe("address findings are never analyzed", () => {
  const ADDRESS = "12 Main Street, Austin TX 78701";

  it("excludes address facts and candidates, and counts them", () => {
    const f = makeBuilder(29);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.fact("contact_address", ADDRESS),
      f.candidate("contact_address", "Flat 4, 12 Main Street"),
    ]);
    assert.equal(pack.items.length, 1);
    assert.equal(pack.stats.excluded.contact_address, 2);
  });

  it("gives an address finding no reference and never shows its text", () => {
    const f = makeBuilder(29);
    const address = f.fact("contact_address", ADDRESS);
    const candidate = f.candidate("contact_address", "Flat 4, 12 Main Street");
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.fact("service", "Heating"),
      address,
      candidate,
    ]);
    const mapped = Object.values(pack.refToFindingId);
    assert.ok(!mapped.includes(address.id));
    assert.ok(!mapped.includes(candidate.id));
    const shown = JSON.stringify(pack.items);
    for (const leak of ["12 Main Street", "Austin TX", "78701", "Flat 4"]) {
      assert.ok(!shown.includes(leak), leak);
    }
    // so there is nothing for a model to cite: only E1..E2 exist
    assert.deepEqual(Object.keys(pack.refToFindingId).sort(), ["E1", "E2"]);
  });

  it("is excluded whatever the quote says, and even if the text has no address in it", () => {
    const f = makeBuilder(29);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.fact("contact_address", "Our workshop", { quote: "Visit us at 12 Main Street" }),
    ]);
    assert.equal(pack.items.length, 1);
    assert.ok(!JSON.stringify(pack.items).includes("Main Street"));
  });

  it("keeps location and service-area findings, which describe where the company works", () => {
    const f = makeBuilder(29);
    const pack = packOf([
      f.fact("contact_address", ADDRESS),
      f.fact("location", "Austin, TX"),
      f.fact("service_area", "Greater Austin"),
    ]);
    assert.deepEqual(pack.items.map((i) => i.topic).sort(), ["location", "service_area"]);
  });

  it("a run with only address findings has nothing usable", () => {
    const f = makeBuilder(29);
    const r = buildEvidencePack([
      f.fact("contact_address", ADDRESS),
      f.candidate("contact_address", "Flat 4"),
    ]);
    assert.ok(!r.ok);
    assert.equal(r.code, "no_usable_findings");
    assert.equal(r.stats.excluded.contact_address, 2);
  });

  it("an address stored under another category cannot become a topic", () => {
    const f = makeBuilder(29);
    const disguised = f.fact("company_detail", ADDRESS, {
      fieldKey: "address:home",
      valueJson: { category: "contact_address", method: "page-text" },
    });
    const pack = packOf([f.fact("service", "Plumbing"), disguised]);
    assert.equal(pack.items.length, 1);
    assert.equal(pack.stats.excluded.unknown_category, 1);
  });

  it("is not one of the topics the model is told about", () => {
    assert.ok(!(EVIDENCE_TOPICS as readonly string[]).includes("contact_address"));
  });

  it("does not change the hash when an address changes", () => {
    const f = makeBuilder(29);
    const base = f.fact("service", "Plumbing");
    const a = packOf([base, f.fact("contact_address", "1 First Street")]).inputHash;
    const b = packOf([
      base,
      f.fact("contact_address", "99 Other Road"),
      f.candidate("contact_address", "x"),
    ]).inputHash;
    assert.equal(a, b);
  });

  it("never reaches the pack for any of the six industries", () => {
    for (const fixture of industryFixtures()) {
      const addresses = fixture.findings.filter((x) => x.category === "contact_address");
      assert.ok(addresses.length >= 1, `${fixture.name} has no address fixture`);
      const pack = packOf(fixture.findings);
      const mapped = new Set(Object.values(pack.refToFindingId));
      for (const a of addresses) {
        assert.ok(!mapped.has(a.id), `${fixture.name}: ${a.id}`);
        assert.ok(
          !JSON.stringify(pack.items).includes(a.value_text),
          `${fixture.name}: ${a.value_text}`,
        );
      }
    }
  });
});

describe("redaction", () => {
  it("removes e-mail addresses, web addresses and phone numbers from values and quotes", () => {
    const f = makeBuilder(30);
    const pack = packOf([
      f.fact(
        "business_description",
        "Call 555-123-4567 or mail owner@acme.example or visit www.acme.example",
        {
          quote: "Phone: +1 (555) 987-6543 | https://acme.example/contact",
        },
      ),
    ]);
    const [item] = pack.items;
    const all = `${item.value} ${item.quote}`;
    for (const leak of ["555", "@", "acme.example", "https"]) assert.ok(!all.includes(leak), leak);
    assert.match(item.value, /\[phone removed\]/);
    assert.match(item.value, /\[email removed\]/);
    assert.match(item.value, /\[link removed\]/);
  });

  it("counts what it removed", () => {
    const f = makeBuilder(31);
    const pack = packOf([
      f.fact("business_description", "a@b.com and c@d.com, 555-123-4567, https://x.example", {
        quote: null,
      }),
      f.fact("service", "Booking at 555.222.3333", { quote: "Booking at 555.222.3333" }),
    ]);
    assert.deepEqual(pack.stats.redactions, { emails: 2, urls: 1, phones: 3 });
  });

  it("counts redactions only for items that reach the pack", () => {
    const f = makeBuilder(32);
    const dup = "Call 555-123-4567 for a quote";
    const pack = packOf([
      f.fact("service", dup),
      f.fact("service", dup, { quote: null }),
      f.fact("service", "Plain"),
    ]);
    assert.equal(pack.stats.deduplicated, 1);
    assert.equal(pack.stats.redactions.phones, 2); // value + quote of the one kept item
  });

  it("drops an item that is nothing but contact data", () => {
    const f = makeBuilder(33);
    const pack = packOf([f.fact("service", "owner@acme.example"), f.fact("service", "Plumbing")]);
    assert.equal(pack.items.length, 1);
    assert.equal(pack.stats.droppedEmpty, 1);
  });

  it("keeps the quote out when it only repeats the value", () => {
    const f = makeBuilder(34);
    const pack = packOf([
      f.fact("service", "Plumbing", { quote: "plumbing" }),
      f.fact("service", "Heating", { quote: "We fit heating systems." }),
    ]);
    const quoteOf = (value: string) => pack.items.find((i) => i.value === value)?.quote;
    assert.equal(quoteOf("Plumbing"), null);
    assert.equal(quoteOf("Heating"), "We fit heating systems.");
  });
});

describe("text cleaning", () => {
  it("removes hidden characters from untrusted text", () => {
    const f = makeBuilder(35);
    const hidden = String.fromCodePoint(0xe0049, 0xe0067);
    const pack = packOf([f.fact("service", `Plumb​ing${hidden}‮ repairs`)]);
    assert.equal(pack.items[0].value, "Plumbing repairs");
  });

  it("flattens line breaks so a value is one line", () => {
    const f = makeBuilder(36);
    const pack = packOf([f.fact("service", "Line one\nLine two\r\nLine three")]);
    assert.equal(pack.items[0].value, "Line one Line two Line three");
  });
});

describe("ordering, references and the private map", () => {
  it("gives dense references E1..En, facts before candidates", () => {
    const { findings } = smallPack();
    const pack = packOf(findings);
    assert.deepEqual(
      pack.items.map((i) => i.ref),
      ["E1", "E2", "E3", "E4", "E5"],
    );
    const statuses = pack.items.map((i) => i.status);
    assert.deepEqual(
      statuses,
      [...statuses].sort((a, b) => (a === b ? 0 : a === "fact" ? -1 : 1)),
    );
    assert.equal(pack.items.at(-1)?.status, "candidate");
  });

  it("maps every reference to the right finding id, privately", () => {
    const f = makeBuilder(40);
    const a = f.fact("service", "Alpha");
    const b = f.candidate("service", "Beta");
    const pack = packOf([b, a]);
    assert.equal(pack.refToFindingId.E1, a.id);
    assert.equal(pack.refToFindingId.E2, b.id);
    assert.equal(Object.keys(pack.refToFindingId).length, pack.items.length);
  });

  it("never shows the model a finding id", () => {
    for (const fixture of industryFixtures()) {
      const pack = packOf(fixture.findings);
      assert.ok(!UUID.test(JSON.stringify(pack.items)), fixture.name);
    }
  });

  it("labels candidates as candidates", () => {
    const f = makeBuilder(41);
    const pack = packOf([f.candidate("service", "Maybe this")]);
    assert.equal(pack.items[0].status, "candidate");
  });

  it("is deterministic whatever the input order", () => {
    const { findings } = smallPack();
    const forward = packOf(findings);
    const backward = packOf([...findings].reverse());
    const shuffled = packOf([findings[2], findings[4], findings[0], findings[3], findings[1]]);
    assert.deepEqual(backward.items, forward.items);
    assert.deepEqual(shuffled.items, forward.items);
    assert.equal(backward.inputHash, forward.inputHash);
    assert.deepEqual(backward.refToFindingId, forward.refToFindingId);
  });

  it("orders topics in a fixed order within a status", () => {
    const f = makeBuilder(42);
    const pack = packOf([
      f.fact("location", "Leeds"),
      f.fact("service", "Plumbing"),
      f.fact("business_description", "A plumber"),
      f.detail("industry", "Trades"),
    ]);
    assert.deepEqual(
      pack.items.map((i) => i.topic),
      ["business_description", "industry", "service", "location"],
    );
  });

  it("breaks ties between identical text by finding id, so the map is stable", () => {
    const f = makeBuilder(43);
    const first = f.fact("service", "Same", { id: uuidFor(1) });
    const second = f.fact("service", "Same", { id: uuidFor(2), quote: "A different quote" });
    const forward = packOf([first, second]);
    const backward = packOf([second, first]);
    assert.deepEqual(forward.refToFindingId, backward.refToFindingId);
  });
});

describe("caps", () => {
  it("de-duplicates the same fact stated twice", () => {
    const f = makeBuilder(50);
    const pack = packOf([
      f.fact("service", "Plumbing"),
      f.fact("service", "  plumbing  "),
      f.candidate("service", "Plumbing"),
    ]);
    assert.equal(pack.items.length, 2); // the fact once, plus the candidate (different status)
    assert.equal(pack.stats.deduplicated, 1);
  });

  it("limits each topic so one cannot crowd out the rest", () => {
    const f = makeBuilder(51);
    const services = Array.from({ length: 40 }, (_, i) =>
      f.fact("service", `Service ${String(i).padStart(2, "0")}`),
    );
    const pack = packOf([...services, f.fact("location", "Leeds")]);
    assert.equal(pack.items.filter((i) => i.topic === "service").length, PACK_LIMITS.maxPerTopic);
    assert.equal(pack.items.filter((i) => i.topic === "location").length, 1);
    assert.equal(pack.stats.droppedByCap, 40 - PACK_LIMITS.maxPerTopic);
  });

  it("limits the number of items", () => {
    const f = makeBuilder(52);
    const topics = ["service", "product", "location", "service_area", "business_description"];
    const many = topics.flatMap((t) =>
      Array.from({ length: 25 }, (_, i) =>
        t === "product" ? f.detail("product", `P${i}`) : f.fact(t, `${t} ${i}`),
      ),
    );
    const pack = packOf(many);
    assert.ok(pack.items.length <= PACK_LIMITS.maxItems);
    assert.equal(pack.stats.included, pack.items.length);
  });

  it("limits the total size", () => {
    const f = makeBuilder(53);
    const long = "word ".repeat(80).trim(); // ~400 chars, cut to 300
    const findings = [
      "service",
      "product",
      "location",
      "service_area",
      "business_description",
    ].flatMap((t, ti) =>
      Array.from({ length: 25 }, (_, i) =>
        f.fact(t === "product" ? "service" : t, `${long} ${ti}-${i}`, {
          quote: `${long} q${ti}-${i}`,
        }),
      ),
    );
    const pack = packOf(findings);
    const size = pack.items.reduce((n, i) => n + i.value.length + (i.quote?.length ?? 0) + 40, 0);
    assert.ok(size <= PACK_LIMITS.maxPackChars, String(size));
  });

  it("shortens long values and quotes, Unicode-safely", () => {
    const f = makeBuilder(54);
    const pack = packOf([f.fact("service", "x😀".repeat(300), { quote: "é😀".repeat(250) })]);
    const [item] = pack.items;
    assert.equal(codePointLength(item.value), PACK_LIMITS.maxValueChars);
    assert.equal(codePointLength(item.quote ?? ""), PACK_LIMITS.maxQuoteChars);
    assert.equal(item.value.isWellFormed(), true);
    assert.ok(item.value.endsWith("…"));
    assert.equal(pack.stats.truncated, 2);
  });

  it("does not shorten text within the limit", () => {
    const f = makeBuilder(55);
    const pack = packOf([
      f.fact("service", "x".repeat(PACK_LIMITS.maxValueChars), { quote: null }),
    ]);
    assert.equal(pack.items[0].value.length, PACK_LIMITS.maxValueChars);
    assert.equal(pack.stats.truncated, 0);
  });
});

describe("nothing usable", () => {
  const code = (findings: readonly ResearchFindingInput[]) => {
    const r = buildEvidencePack(findings);
    return r.ok ? "ok" : r.code;
  };

  it("an empty run", () => assert.equal(code([]), "no_usable_findings"));

  it("only contact findings", () => {
    const f = makeBuilder(60);
    assert.equal(
      code([
        f.fact("contact_email", "a@b.com"),
        f.fact("contact_phone", "555-123-4567"),
        f.fact("person", "A B"),
      ]),
      "no_usable_findings",
    );
  });

  it("only assessments", () => {
    const f = makeBuilder(61);
    assert.equal(
      code([f.assessment("observation", "x"), f.assessment("challenge", "y")]),
      "no_usable_findings",
    );
  });

  it("only text that redacts to nothing", () => {
    const f = makeBuilder(62);
    assert.equal(
      code([f.fact("service", "info@acme.example"), f.fact("service", "www.acme.example")]),
      "no_usable_findings",
    );
  });

  it("reports why in the stats", () => {
    const f = makeBuilder(63);
    const r = buildEvidencePack([
      f.fact("contact_email", "a@b.com"),
      f.assessment("observation", "x"),
    ]);
    assert.ok(!r.ok);
    assert.deepEqual(
      [
        r.stats.considered,
        r.stats.included,
        r.stats.excluded.contact_email,
        r.stats.excluded["kind:assessment"],
      ],
      [2, 0, 1, 1],
    );
  });

  it("findings from more than one research run are not one analysis", () => {
    const f = makeBuilder(64);
    assert.equal(
      code([
        f.fact("service", "A", { runId: "run-a" }),
        f.fact("service", "B", { runId: "run-b" }),
      ]),
      "research_not_usable",
    );
  });

  it("accepts findings of one run, with or without run ids", () => {
    const f = makeBuilder(65);
    assert.equal(
      code([
        f.fact("service", "A", { runId: "run-a" }),
        f.fact("service", "B", { runId: "run-a" }),
      ]),
      "ok",
    );
    const noRun = (x: ResearchFindingInput): ResearchFindingInput => ({ ...x, run_id: undefined });
    assert.equal(code([noRun(f.fact("service", "A")), noRun(f.fact("service", "B"))]), "ok");
  });
});

describe("input hash", () => {
  it("is a SHA-256 in hex", () => {
    assert.match(packOf(smallPack().findings).inputHash, /^[0-9a-f]{64}$/);
  });

  it("is the same for the same evidence, run after run", () => {
    const { findings } = smallPack();
    assert.equal(packOf(findings).inputHash, packOf(findings).inputHash);
  });

  it("does not depend on finding ids", () => {
    const f1 = makeBuilder(70);
    const f2 = makeBuilder(71);
    const a = packOf([f1.fact("service", "Plumbing"), f1.candidate("service", "Heating")]);
    const b = packOf([f2.fact("service", "Plumbing"), f2.candidate("service", "Heating")]);
    assert.equal(a.inputHash, b.inputHash);
  });

  it("changes when a value changes", () => {
    const f = makeBuilder(72);
    const a = packOf([f.fact("service", "Plumbing")]).inputHash;
    const b = packOf([f.fact("service", "Plumbing!")]).inputHash;
    assert.notEqual(a, b);
  });

  it("changes when a candidate becomes a fact", () => {
    const f = makeBuilder(73);
    const a = packOf([f.candidate("service", "Plumbing")]).inputHash;
    const b = packOf([f.fact("service", "Plumbing")]).inputHash;
    assert.notEqual(a, b);
  });

  it("changes when an item is added or removed", () => {
    const f = makeBuilder(74);
    const one = packOf([f.fact("service", "Plumbing")]).inputHash;
    const two = packOf([f.fact("service", "Plumbing"), f.fact("service", "Heating")]).inputHash;
    assert.notEqual(one, two);
  });

  it("changes when a quote changes", () => {
    const f = makeBuilder(75);
    const a = packOf([f.fact("service", "Plumbing", { quote: "We do plumbing" })]).inputHash;
    const b = packOf([f.fact("service", "Plumbing", { quote: "We do plumbing well" })]).inputHash;
    assert.notEqual(a, b);
  });

  it("does not change when only excluded findings change", () => {
    const f = makeBuilder(76);
    const base = f.fact("service", "Plumbing");
    const a = packOf([base, f.fact("contact_email", "a@b.com")]).inputHash;
    const b = packOf([
      base,
      f.fact("contact_email", "different@b.com"),
      f.assessment("observation", "new"),
    ]).inputHash;
    assert.equal(a, b);
  });

  it("hashPackItems agrees with the pack's own hash", () => {
    const pack = packOf(smallPack().findings);
    assert.equal(hashPackItems(pack.items), pack.inputHash);
  });
});

describe("six industries", () => {
  for (const fixture of industryFixtures()) {
    it(`${fixture.name}: forbidden findings and text never reach the pack`, () => {
      const pack = packOf(fixture.findings);
      const mapped = new Set(Object.values(pack.refToFindingId));
      for (const id of fixture.forbiddenIds) assert.ok(!mapped.has(id), id);
      const text = JSON.stringify(pack.items);
      for (const leak of fixture.forbiddenText) assert.ok(!text.includes(leak), leak);
      assert.ok(pack.items.length >= 5, `only ${pack.items.length} items`);
    });
  }
});
