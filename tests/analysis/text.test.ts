// Cleaning and shortening untrusted text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codePointLength,
  sanitizeText,
  truncateCodePoints,
} from "../../src/features/analysis/text.ts";

describe("sanitizeText", () => {
  it("collapses whitespace and line breaks into single spaces", () => {
    assert.equal(sanitizeText("  a \n\t b\r\n\r\nc  "), "a b c");
  });

  it("turns control characters into spaces", () => {
    assert.equal(sanitizeText("a\u0000b\u0007c\u007fd\u0085e"), "a b c d e");
  });

  it("removes zero-width, bidirectional and invisible characters", () => {
    assert.equal(sanitizeText("ig​nore‌ all‍﻿"), "ignore all");
    assert.equal(sanitizeText("abc‮def‬"), "abcdef");
    assert.equal(sanitizeText("a⁦b⁩c؜d­e"), "abcde");
  });

  it("removes Unicode tag characters (hidden instructions)", () => {
    const hidden = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e, 0xe006f, 0xe0072, 0xe0065);
    assert.equal(sanitizeText(`Hello${hidden} world`), "Hello world");
  });

  it("repairs lone surrogates so the text is well-formed", () => {
    const cleaned = sanitizeText("a\ud800b");
    assert.equal(cleaned.isWellFormed(), true);
    assert.equal(cleaned, "a�b");
  });

  it("normalizes to NFC", () => {
    assert.equal(sanitizeText("é"), "é");
  });

  it("keeps ordinary international text", () => {
    assert.equal(sanitizeText("مطعم الشرق — 東京 ✓"), "مطعم الشرق — 東京 ✓");
  });

  it("returns an empty string for nothing but invisible characters", () => {
    assert.equal(sanitizeText("​‌ \n\t"), "");
  });
});

describe("truncateCodePoints", () => {
  it("leaves short text unchanged", () => {
    assert.deepEqual(truncateCodePoints("hello", 5), { text: "hello", truncated: false });
    assert.deepEqual(truncateCodePoints("", 5), { text: "", truncated: false });
  });

  it("cuts to the limit including the ellipsis", () => {
    const r = truncateCodePoints("abcdefghij", 6);
    assert.equal(r.truncated, true);
    assert.equal(r.text, "abcde…");
    assert.equal(codePointLength(r.text), 6);
  });

  it("never splits a surrogate pair", () => {
    const text = "ab😀😀😀😀";
    for (let max = 1; max <= 7; max++) {
      const r = truncateCodePoints(text, max);
      assert.equal(r.text.isWellFormed(), true, `max ${max}`);
      assert.ok(codePointLength(r.text) <= max, `max ${max}`);
    }
    assert.equal(truncateCodePoints("😀😀😀😀", 3).text, "😀😀…");
  });

  it("counts characters, not UTF-16 units", () => {
    assert.equal(codePointLength("😀😀😀"), 3);
    assert.equal(truncateCodePoints("😀😀😀", 3).truncated, false);
  });

  it("drops trailing spaces before the ellipsis", () => {
    // the 7 kept characters are "hello  " (two spaces); the trailing spaces are trimmed
    assert.equal(truncateCodePoints("hello  world", 8).text, "hello…");
  });

  it("handles a limit of zero or less", () => {
    assert.deepEqual(truncateCodePoints("abc", 0), { text: "", truncated: true });
    assert.deepEqual(truncateCodePoints("", 0), { text: "", truncated: false });
  });
});
