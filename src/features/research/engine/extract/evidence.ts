import { jsonLdLines } from "./jsonld.ts";
import { normalizeText, sha256Hex } from "./text.ts";
import type { EvidenceDocument, ParsedPage } from "./types.ts";

/** research_findings / lead_sources limits (migration 009): at most 200,000 characters. */
export const MAX_EVIDENCE_CHARS = 200_000;
/** Keeps the gzip upload well under the 256 KiB bucket limit even for non-Latin text. */
export const MAX_EVIDENCE_BYTES = 600_000;
/**
 * Links kept per page. The parser keeps at most this many and the evidence document lists all
 * of them, so every link an extractor can look at is also quotable evidence.
 */
export const MAX_LINKS = 1_000;

/**
 * Builds the page's evidence document: the exact text stored (gzip) in private Storage and the
 * only text a quote may come from. Sections, in priority order (later ones are cut first when
 * the page is very large):
 *   URL / TITLE / META DESCRIPTION / OG ...
 *   JSON-LD          one "@type: ..." line per entity, then "path: value" lines
 *   LINKS            "<absolute href> <link text>"
 *   TEXT             visible text blocks, one per line
 * Every line is normalized (normalized_exact_v1), so quotes taken from these lines verify.
 */
export function buildEvidence(page: Omit<ParsedPage, "evidence">): EvidenceDocument {
  const header = [
    `URL: ${page.url}`,
    page.title && `TITLE: ${page.title}`,
    page.metaDescription && `META DESCRIPTION: ${page.metaDescription}`,
    page.ogSiteName && `OG SITE NAME: ${page.ogSiteName}`,
    page.ogTitle && `OG TITLE: ${page.ogTitle}`,
    page.ogDescription && `OG DESCRIPTION: ${page.ogDescription}`,
    page.ogType && `OG TYPE: ${page.ogType}`,
  ].filter((l): l is string => Boolean(l));

  const jsonLd = page.jsonLd.flatMap((e) => jsonLdLines(e));
  const links = [
    ...new Set(
      page.links.slice(0, MAX_LINKS).map((l) => (l.text ? `${l.href} ${l.text}` : l.href)),
    ),
  ];
  const text: string[] = [];
  for (const block of page.blocks) {
    if (text.at(-1) !== block.text) text.push(block.text);
  }

  const sections: [string, string[]][] = [
    ["", header],
    ["JSON-LD:", jsonLd],
    ["LINKS:", links],
    ["TEXT:", text],
  ];

  const out: string[] = [];
  let chars = 0;
  let bytes = 0;
  let truncated = false;
  const add = (line: string) => {
    const clean = normalizeText(line);
    if (!clean) return true;
    const lineBytes = Buffer.byteLength(clean, "utf8") + 1;
    if (chars + clean.length + 1 > MAX_EVIDENCE_CHARS || bytes + lineBytes > MAX_EVIDENCE_BYTES) {
      truncated = true;
      return false;
    }
    out.push(clean);
    chars += clean.length + 1;
    bytes += lineBytes;
    return true;
  };

  outer: for (const [title, lines] of sections) {
    if (lines.length === 0) continue;
    if (title && !add(title)) break;
    for (const line of lines) if (!add(line)) break outer;
  }

  const documentText = out.join("\n");
  return {
    text: documentText,
    sha256: sha256Hex(documentText),
    chars: [...documentText].length,
    truncated,
  };
}

/**
 * normalizeText(evidence.text), computed once per document. Every line of an evidence document
 * is already normalized and non-empty, so normalizing the whole document only turns the line
 * breaks into spaces; caching it keeps each quote check from re-normalizing up to 200,000
 * characters while giving exactly the same answer as quoteIn().
 */
const normalizedCache = new WeakMap<EvidenceDocument, string>();

function normalizedEvidence(evidence: EvidenceDocument) {
  let text = normalizedCache.get(evidence);
  if (text === undefined) {
    text = normalizeText(evidence.text);
    normalizedCache.set(evidence, text);
  }
  return text;
}

/** True when the quote is present in this page's stored evidence text (normalized_exact_v1). */
export function verifyQuote(page: Pick<ParsedPage, "evidence">, quote: string) {
  const q = normalizeText(quote);
  return q.length >= 3 && normalizedEvidence(page.evidence).includes(q);
}
