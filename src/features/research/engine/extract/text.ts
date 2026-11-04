import { createHash } from "node:crypto";

/** The quote-check method recorded with every fact (research_findings.quote_check). */
export const QUOTE_CHECK = "normalized_exact_v1";

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/**
 * normalized_exact_v1: Unicode NFC, soft hyphens and zero-width characters removed, every run
 * of whitespace (incl. non-breaking spaces and newlines) collapsed to one space, trimmed.
 * Used both for the stored evidence text and for quotes, so a quote verifies only if it
 * appears in the page text exactly, apart from whitespace.
 *
 * Unpaired UTF-16 surrogates (e.g. from a JSON-LD "\ud83d" escape) are replaced with U+FFFD
 * first, so every normalized string is well-formed Unicode and safe to store as JSON.
 */
export function normalizeText(value: string) {
  return value.toWellFormed().normalize("NFC").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
}

/** True when the quote appears in the evidence text (normalized_exact_v1). */
export function quoteIn(evidenceText: string, quote: string) {
  const q = normalizeText(quote);
  return q.length >= 3 && normalizeText(evidenceText).includes(q);
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A short, stable key segment: lowercase letters, digits and dashes. */
export function slug(value: string, max = 80) {
  const s = normalizeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s || sha256Hex(value).slice(0, 12);
  return `${s.slice(0, max - 13)}-${sha256Hex(value).slice(0, 12)}`;
}

/**
 * At most `max` UTF-16 code units, never splitting a surrogate pair: if the cut would fall
 * between the two halves of an emoji or other supplementary character, it is dropped whole.
 */
export function clip(value: string, max: number) {
  if (value.length <= max) return value;
  const end = max > 0 && isHighSurrogate(value.charCodeAt(max - 1)) ? max - 1 : max;
  return value.slice(0, end);
}

/** At most `max` Unicode code points (characters), never splitting one. */
export function clipCodePoints(value: string, max: number) {
  let count = 0;
  let index = 0;
  for (const ch of value) {
    if (count === max) return value.slice(0, index);
    count += 1;
    index += ch.length;
  }
  return value;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Lowercase word tokens (letters/digits, any script) for loose name comparison. */
export function tokens(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** Letters and digits only, lowercased and without accents: for "is X stated in Y" checks. */
export function squash(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * True when `part` is stated in the evidence: its letters and digits appear, in order, within
 * one of the quotes (case, punctuation and spacing ignored). Used to make sure a fact's value
 * is fully supported by its verified quotes, not just that the quotes are on the page.
 */
export function supports(quotes: string[], part: string) {
  const needle = squash(part);
  return needle.length > 0 && quotes.some((q) => squash(q).includes(needle));
}
