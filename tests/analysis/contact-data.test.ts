// Contact-data detection and redaction: what counts as an e-mail, web address or phone number, and
// what deliberately does not (years, ranges, prices, times).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsContactData,
  EMAIL_PLACEHOLDER,
  findContactData,
  isOnlyPlaceholders,
  PHONE_PLACEHOLDER,
  redactContactData,
  URL_PLACEHOLDER,
} from "../../src/features/analysis/contact-data.ts";

describe("e-mail addresses", () => {
  for (const email of [
    "owner@example.com",
    "first.last+tag@sub.example.co.uk",
    "o'brien@example.org",
    "SALES@EXAMPLE.COM",
    "a_b-c@x1.example.io",
  ]) {
    it(`redacts ${email}`, () => {
      const r = redactContactData(`Write to ${email} today`);
      assert.equal(r.text, `Write to ${EMAIL_PLACEHOLDER} today`);
      assert.equal(r.emails, 1);
    });
  }

  it("redacts spelled-out addresses", () => {
    for (const text of [
      "info [at] example [dot] com",
      "info (at) example (dot) com",
      "info [AT] example [DOT] co [dot] uk",
    ]) {
      const r = redactContactData(text);
      assert.equal(r.emails, 1, text);
      assert.ok(!/example/.test(r.text), text);
    }
  });

  it("counts several addresses", () => {
    const r = redactContactData("a@x.com, b@y.org and c@z.net");
    assert.equal(r.emails, 3);
    assert.equal(r.text, `${EMAIL_PLACEHOLDER}, ${EMAIL_PLACEHOLDER} and ${EMAIL_PLACEHOLDER}`);
  });

  it("leaves text with an @ sign but no address alone", () => {
    assert.equal(redactContactData("Follow us @brand on social").emails, 0);
    assert.equal(redactContactData("Meet @ 5pm").emails, 0);
  });
});

describe("web addresses", () => {
  for (const url of [
    "https://example.com/booking",
    "http://shop.example.co.uk/a?b=1#c",
    "ftp://files.example.org/x",
    "www.example.com",
    "www.example.com/menu",
    "example.com",
    "booking.example.io/slots",
    "my-shop.example.ae",
  ]) {
    it(`redacts ${url}`, () => {
      const r = redactContactData(`See ${url} for details`);
      assert.equal(r.text, `See ${URL_PLACEHOLDER} for details`);
      assert.equal(r.urls, 1);
    });
  }

  it("does not mistake ordinary abbreviations for addresses", () => {
    for (const text of [
      "e.g. a dentist",
      "Dr.Smith",
      "St. Louis",
      "p.m. only",
      "No.1 choice",
      "approx. 5km",
    ]) {
      assert.equal(redactContactData(text).urls, 0, text);
    }
  });
});

describe("phone-like numbers", () => {
  for (const phone of [
    "+1 555 123 4567",
    "+44 20 7946 0958",
    "+44 (0)20 7946 0958",
    "(555) 123-4567",
    "(0207) 946 0958",
    "555-123-4567",
    "555.123.4567",
    "0300 123 4567",
    "021 555 1234",
    "0300 1234567",
    "021-5551234",
    "5551234567",
    "923001234567",
    "+971 4 555 0100",
  ]) {
    it(`redacts ${phone}`, () => {
      const r = redactContactData(`Call ${phone} now`);
      assert.equal(r.text, `Call ${PHONE_PLACEHOLDER} now`);
      assert.equal(r.phones, 1);
    });
  }

  it("leaves years, ranges, prices, times, dates and small numbers alone", () => {
    for (const text of [
      "Serving you since 1998",
      "Open 2005-2010",
      "Price $1,234,567",
      "Opens 10:30 to 18:45",
      "Founded 2019-11-05",
      "24/7 support",
      "5 stars from 1200 reviews",
      "ZIP 78701",
      "Suite 400, 12 Main Street",
      "Room 101",
      "Version 2.5.1",
      "3 locations and 120 staff",
    ]) {
      assert.deepEqual(findContactData(text), { emails: 0, urls: 0, phones: 0 }, text);
    }
  });

  it("does not redact numbers with too few or too many digits", () => {
    assert.equal(redactContactData("12-345").phones, 0);
    assert.equal(redactContactData("1234567890123456789").phones, 0);
  });

  it("applies the 7-to-15 digit rule to + numbers too, in both directions", () => {
    // 4 digits: matches the + pattern's shape but is far too short to be a phone number
    assert.equal(redactContactData("Code +1 (2) 3 4 today").phones, 0);
    // 19 unbroken digits after a +: only the + pattern can match, and it is longer than any phone number
    assert.equal(redactContactData("Ref +1234567890123456789 end").phones, 0);
    // exactly 7 and exactly 15 digits are phone-like
    assert.equal(redactContactData("Call +1234567 now").phones, 1);
    assert.equal(redactContactData("Call +123456789012345 now").phones, 1);
    assert.equal(redactContactData("Call +123 456 789 012 345 now").phones, 1);
    // one digit over: 16 unbroken digits after a + is not a phone number
    assert.equal(redactContactData("Ref +1234567890123456 end").phones, 0);
  });

  it("long chains of digits are redacted conservatively, in pieces", () => {
    const r = redactContactData("Ref +1 234 567 890 123 456 789 end");
    assert.ok(r.phones >= 1);
    assert.match(r.text, /\[phone removed\]/);
  });
});

describe("combined and counting", () => {
  it("redacts every kind in one string and counts each", () => {
    const r = redactContactData(
      "Email a@b.com, visit https://b.com/x, call +1 555 123 4567 or (555) 987-6543, www.c.org",
    );
    assert.equal(r.emails, 1);
    assert.equal(r.urls, 2);
    assert.equal(r.phones, 2);
    assert.ok(!/@|https|www|555/.test(r.text), r.text);
  });

  it("does not redact the domain of an e-mail address twice", () => {
    const r = redactContactData("owner@example.com");
    assert.deepEqual({ emails: r.emails, urls: r.urls }, { emails: 1, urls: 0 });
  });

  it("is idempotent: redacted text has nothing left to redact", () => {
    const once = redactContactData("a@b.com https://c.com +1 555 123 4567").text;
    assert.equal(containsContactData(once), false);
    assert.equal(redactContactData(once).text, once);
  });

  it("findContactData does not modify anything and agrees with containsContactData", () => {
    assert.equal(containsContactData("nothing here"), false);
    assert.equal(containsContactData("x@y.com"), true);
    assert.equal(containsContactData("see example.com"), true);
    assert.equal(containsContactData("call 555-123-4567"), true);
  });

  it("recognizes text that is only placeholders", () => {
    assert.equal(isOnlyPlaceholders(`${EMAIL_PLACEHOLDER}`), true);
    assert.equal(isOnlyPlaceholders(`${PHONE_PLACEHOLDER} / ${URL_PLACEHOLDER}`), true);
    assert.equal(isOnlyPlaceholders(`Call ${PHONE_PLACEHOLDER}`), false);
    assert.equal(isOnlyPlaceholders(""), true);
  });
});
