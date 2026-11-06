/**
 * Text handling for untrusted content. Pure TypeScript.
 *
 * Website text is untrusted, and hidden characters are a classic way to smuggle instructions past a
 * reader (zero-width characters, bidirectional overrides, "tag" characters). Everything that goes
 * into a prompt is cleaned here first.
 */

/** Characters that render as nothing, or reorder text, and have no place in a short business fact. */
function isInvisible(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x061c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xfff9 && code <= 0xfffb) ||
    // Unicode "tag" characters: invisible, and used to hide instructions in plain sight.
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/**
 * One line of plain text: well-formed Unicode (NFC), control characters and line breaks turned
 * into spaces, invisible and reordering characters removed, whitespace collapsed.
 */
export function sanitizeText(input: string): string {
  let out = "";
  for (const ch of input.toWellFormed().normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      out += " ";
    } else if (!isInvisible(code)) {
      out += ch;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * At most `max` Unicode code points, never splitting a surrogate pair. When text is cut, the last
 * kept position is an ellipsis, so the result is never longer than `max`.
 */
export function truncateCodePoints(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (max <= 0) return { text: "", truncated: text.length > 0 };
  const points = Array.from(text); // iterates by code point, so a surrogate pair stays whole
  if (points.length <= max) return { text, truncated: false };
  return {
    text: `${points
      .slice(0, max - 1)
      .join("")
      .trimEnd()}…`,
    truncated: true,
  };
}

/** Length in Unicode code points. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}
