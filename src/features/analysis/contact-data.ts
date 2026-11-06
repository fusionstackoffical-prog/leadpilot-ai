/**
 * Detecting and removing contact data (e-mail addresses, web addresses, phone-like numbers). Pure.
 *
 * Used in both directions:
 *  - evidence going TO the model is redacted, so personal contact data is never sent;
 *  - text coming BACK from the model is checked, so a model that repeats (or is tricked into
 *    printing) contact data is refused.
 *
 * Detection is deliberately conservative about what a phone number looks like, so that years,
 * year ranges ("2005-2010"), prices ("$1,234,567") and times are NOT treated as phone numbers.
 * Vanity numbers written with letters ("1-800-FLOWERS") are a known gap.
 */

export const EMAIL_PLACEHOLDER = "[email removed]";
export const URL_PLACEHOLDER = "[link removed]";
export const PHONE_PLACEHOLDER = "[phone removed]";

export type ContactCounts = { emails: number; urls: number; phones: number };

// local-part@domain.tld, and the common spelled-out disguise "name [at] domain [dot] com".
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const EMAIL_OBFUSCATED =
  /[\w.+-]+\s*[[(]\s*at\s*[\])]\s*[\w-]+(?:\s*[[(]\s*dot\s*[\])]\s*[\w-]+)+/gi;

// Addresses with a scheme, with www., and bare domains on a conservative list of common TLDs.
const URL_SCHEME = /\b(?:https?|ftp):\/\/[^\s"'<>)\]]+/gi;
const URL_WWW = /\bwww\.[^\s"'<>)\]]+/gi;
const URL_BARE =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|co|ai|app|dev|info|biz|us|uk|ca|au|ae|de|fr|in|pk|edu|gov|shop|store|online|site|xyz|me|tv)\b(?:\/[^\s"'<>]*)?/gi;

// Phone-like numbers. Each pattern is specific enough to leave years and prices alone; a match is
// kept only if it holds 7 to 15 digits.
const PHONE_PATTERNS: readonly RegExp[] = [
  // +1 555 123 4567, +44 (0)20 7946 0958
  /\+\d[\d\s().-]{5,18}\d/g,
  // (555) 123-4567
  /\(\d{2,4}\)[\s.-]?\d[\d\s.-]{4,}\d/g,
  // 555-123-4567, 555.123.4567, 0300 123 4567, 021 555 1234
  /\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?\b/g,
  // 0300 1234567, 021-5551234
  /\b\d{3,5}[\s.-]\d{6,8}\b/g,
  // 5551234567, 923001234567
  /\b\d{10,15}\b/g,
];

function digitCount(text: string): number {
  let n = 0;
  for (const ch of text) if (ch >= "0" && ch <= "9") n++;
  return n;
}

function isPhoneLike(match: string): boolean {
  const digits = digitCount(match);
  return digits >= 7 && digits <= 15;
}

function replaceCounting(
  text: string,
  pattern: RegExp,
  placeholder: string,
  accept: (match: string) => boolean = () => true,
): { text: string; count: number } {
  let count = 0;
  const out = text.replace(pattern, (match) => {
    if (!accept(match)) return match;
    count++;
    return placeholder;
  });
  return { text: out, count };
}

/** Replaces every e-mail address, web address and phone-like number, and counts them. */
export function redactContactData(input: string): { text: string } & ContactCounts {
  let text = input;
  let emails = 0;
  let urls = 0;
  let phones = 0;

  for (const pattern of [EMAIL, EMAIL_OBFUSCATED]) {
    const r = replaceCounting(text, pattern, EMAIL_PLACEHOLDER);
    text = r.text;
    emails += r.count;
  }
  for (const pattern of [URL_SCHEME, URL_WWW, URL_BARE]) {
    const r = replaceCounting(text, pattern, URL_PLACEHOLDER);
    text = r.text;
    urls += r.count;
  }
  for (const pattern of PHONE_PATTERNS) {
    const r = replaceCounting(text, pattern, PHONE_PLACEHOLDER, isPhoneLike);
    text = r.text;
    phones += r.count;
  }
  return { text, emails, urls, phones };
}

/** How much contact data is in the text (without changing it). */
export function findContactData(text: string): ContactCounts {
  const r = redactContactData(text);
  return { emails: r.emails, urls: r.urls, phones: r.phones };
}

export function containsContactData(text: string): boolean {
  const c = findContactData(text);
  return c.emails + c.urls + c.phones > 0;
}

/** True when nothing but placeholders, spaces and punctuation is left after redaction. */
export function isOnlyPlaceholders(text: string): boolean {
  const rest = text
    .split(EMAIL_PLACEHOLDER)
    .join("")
    .split(URL_PLACEHOLDER)
    .join("")
    .split(PHONE_PLACEHOLDER)
    .join("");
  return !/[\p{L}\p{N}]/u.test(rest);
}
