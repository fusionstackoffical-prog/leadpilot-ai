import { DomUtils, ElementType, parseDocument } from "htmlparser2";
import type { SafeFetchResult } from "../net/safe-fetch.ts";
import { buildEvidence, MAX_LINKS } from "./evidence.ts";
import { extractJsonLd } from "./jsonld.ts";
import { clip, normalizeText } from "./text.ts";
import type { PageLink, PageType, ParsedPage, Region, TextBlock, TextContext } from "./types.ts";

type HtmlDocument = ReturnType<typeof parseDocument>;
type HtmlNode = HtmlDocument["children"][number];
type HtmlElement = Parameters<typeof DomUtils.getAttributeValue>[0];

/** A text node (comments and processing instructions also carry `data` but are not text). */
function isTextNode(node: HtmlNode): node is Extract<HtmlNode, { data: string }> {
  return node.type === ElementType.Text && "data" in node;
}

/** An element: <tag>, <script> or <style>. */
function isElement(node: HtmlNode): node is HtmlElement {
  return "attribs" in node && "name" in node;
}

const MAX_BLOCKS = 3_000;
const MAX_BLOCK_CHARS = 2_000;
/** Elements nested deeper than this are ignored (real pages stay far below it). */
export const MAX_DEPTH = 256;
/** Nodes visited per page before the walk stops. */
export const MAX_NODES = 200_000;

/** Never content: code, media, forms and other non-text elements. */
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "canvas",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "picture",
  "select",
  "option",
  "button",
  "input",
  "textarea",
  "head",
  "map",
  "dialog",
]);

/** Elements that start a new text block. */
const BLOCK_TAGS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "dd",
  "dt",
  "blockquote",
  "address",
  "figcaption",
  "caption",
  "pre",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "ul",
  "ol",
  "dl",
  "table",
  "tr",
  "form",
  "label",
  "summary",
  "details",
  "fieldset",
  "legend",
  "body",
]);

const REGION_BY_TAG: Record<string, Region> = {
  main: "main",
  header: "header",
  footer: "footer",
  nav: "nav",
  aside: "aside",
};
const REGION_BY_ROLE: Record<string, Region> = {
  main: "main",
  banner: "header",
  contentinfo: "footer",
  navigation: "nav",
  complementary: "aside",
};

/** Cookie/consent banners, pop-ups and screen-reader duplicates: never business content. */
const NOISE =
  /(^|[\s_-])(cookie|cookies|consent|gdpr|ccpa|onetrust|cookiebot|cmp|popup|pop-up|modal|newsletter-popup|sr-only|screen-reader|screen-reader-text|visually-hidden|visuallyhidden|skip-link)([\s_-]|$)/i;

/** Class names that common CSS frameworks use to hide an element on every screen size. */
const HIDDEN_CLASSES = new Set([
  "hidden",
  "is-hidden",
  "d-none",
  "invisible",
  "hide",
  "display-none",
  "u-hidden",
  "u-hide",
  "js-hidden",
]);

/**
 * Third-party or quoted material inside the site: testimonials, reviews, comments and lists of
 * blog/news posts. Text and links in it are never the company's own contact details.
 */
const CONTENT_MARKER =
  /(^|[\s_-])(testimonial|testimonials|review|reviews|comment|comments|blog|news|latest-posts|post-list|related-posts|guestbook)([\s_-]|$)/i;

function attr(el: HtmlElement, name: string) {
  return DomUtils.getAttributeValue(el, name);
}

function isHidden(el: HtmlElement) {
  if (attr(el, "hidden") !== undefined || attr(el, "inert") !== undefined) return true;
  if (attr(el, "aria-hidden") === "true") return true;
  const style = (attr(el, "style") ?? "").replace(/\s+/g, "").toLowerCase();
  if (
    /(^|;)display:none/.test(style) ||
    /(^|;)visibility:hidden/.test(style) ||
    /(^|;)opacity:0(\.0+)?(;|$|!)/.test(style) ||
    /(^|;)font-size:0(px|em|rem|%)?(;|$|!)/.test(style)
  ) {
    return true;
  }
  const classes = (attr(el, "class") ?? "").toLowerCase().split(/\s+/);
  if (classes.some((c) => HIDDEN_CLASSES.has(c))) return true;
  return NOISE.test(`${attr(el, "id") ?? ""} ${attr(el, "class") ?? ""}`);
}

/** Decodes an HTML response, honouring the header charset or a <meta charset> declaration. */
export function decodeHtml(result: Pick<SafeFetchResult, "body" | "charset">) {
  let label = result.charset;
  if (!label) {
    const head = result.body.subarray(0, 2048).toString("latin1");
    const m =
      /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(head) ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset=([A-Za-z0-9._:-]+)/i.exec(head);
    label = m ? m[1].toLowerCase() : null;
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(result.body);
  } catch {
    return new TextDecoder("utf-8").decode(result.body);
  }
}

function absolute(href: string, base: string) {
  try {
    const url = new URL(href.trim(), base);
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Visits every element of a subtree without recursion (so nesting depth cannot overflow the
 * call stack), stopping below `maxDepth` and after `maxNodes`. Returns whether a limit was hit.
 */
function walkElements(
  roots: HtmlNode[],
  visit: (el: HtmlElement) => boolean | void,
  { maxDepth = MAX_DEPTH, maxNodes = MAX_NODES } = {},
) {
  const stack: { nodes: HtmlNode[]; i: number; depth: number }[] = [
    { nodes: roots, i: 0, depth: 0 },
  ];
  let seen = 0;
  let limited = false;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.nodes.length) {
      stack.pop();
      continue;
    }
    const node = frame.nodes[frame.i++];
    if (++seen > maxNodes) return true;
    if (!isElement(node)) continue;
    if (visit(node) === false) continue; // do not descend
    if (frame.depth + 1 > maxDepth) {
      limited = true;
      continue;
    }
    stack.push({ nodes: node.children, i: 0, depth: frame.depth + 1 });
  }
  return limited;
}

/** Text of an element's subtree without recursion, skipping non-content elements. */
function textOf(el: HtmlElement, max = MAX_BLOCK_CHARS) {
  let text = "";
  const stack: HtmlNode[][] = [el.children];
  const index: number[] = [0];
  let seen = 0;
  while (stack.length > 0 && text.length < max * 2 && seen < 10_000) {
    const top = stack.length - 1;
    if (index[top] >= stack[top].length || stack.length > 64) {
      stack.pop();
      index.pop();
      continue;
    }
    const node = stack[top][index[top]++];
    seen += 1;
    if (isTextNode(node)) text += node.data;
    else if (isElement(node) && !SKIP_TAGS.has(node.name) && !isHidden(node)) {
      stack.push(node.children);
      index.push(0);
    }
  }
  return clip(normalizeText(text), max);
}

type Meta = { tag: string; region: Region; context: TextContext; level?: number };

/**
 * Parses an HTML (or plain-text) page into text blocks, links, metadata and JSON-LD, and builds
 * its evidence document. Scripts never run: the HTML is only tokenized. All traversal is
 * iterative and bounded (MAX_DEPTH, MAX_NODES), so hostile markup cannot crash the parser;
 * content beyond the limits is ignored and `parseLimited` is set.
 */
export function parsePage(
  input: { html: string; contentType: string; requestedUrl: string; url: string; status: number },
  pageType: PageType,
  retrievedAt: string,
): ParsedPage {
  const base = {
    requestedUrl: input.requestedUrl,
    url: input.url,
    pageType,
    status: input.status,
    contentType: input.contentType,
    retrievedAt,
  };

  if (input.contentType === "text/plain") {
    const blocks = input.html
      .split(/\n\s*\n/)
      .map((t) => clip(normalizeText(t), MAX_BLOCK_CHARS))
      .filter(Boolean)
      .slice(0, MAX_BLOCKS)
      .map((text): TextBlock => ({ text, tag: "p", region: "main", context: "site" }));
    const page = {
      ...base,
      lang: null,
      title: null,
      metaDescription: null,
      ogSiteName: null,
      ogTitle: null,
      ogDescription: null,
      ogType: null,
      blocks,
      links: [],
      jsonLd: [],
      needsJavaScript: false,
      parseLimited: false,
    };
    return { ...page, evidence: buildEvidence(page) };
  }

  const doc = parseDocument(input.html, { lowerCaseTags: true, lowerCaseAttributeNames: true });

  // One bounded pre-pass for metadata and structure.
  let title: string | null = null;
  let lang: string | null = null;
  let articles = 0;
  const metas: HtmlElement[] = [];
  const scripts: HtmlElement[] = [];
  const noscripts: HtmlElement[] = [];
  let parseLimited = walkElements(doc.children, (el) => {
    if (el.name === "title" && title === null) title = clip(textOf(el, 500), 500) || null;
    else if (el.name === "html" && lang === null) lang = attr(el, "lang") ?? null;
    else if (el.name === "meta") metas.push(el);
    else if (el.name === "script") scripts.push(el);
    else if (el.name === "noscript") noscripts.push(el);
    else if (el.name === "article") articles += 1;
  });

  const metaContent = (key: "name" | "property", value: string) => {
    const el = metas.find((e) => (attr(e, key) ?? "").toLowerCase() === value);
    const content = el ? normalizeText(attr(el, "content") ?? "") : "";
    return content ? clip(content, MAX_BLOCK_CHARS) : null;
  };
  const jsonLd = extractJsonLd(
    scripts
      .filter((s) => (attr(s, "type") ?? "").toLowerCase().trim() === "application/ld+json")
      .map((s) => s.children.map((c) => (isTextNode(c) ? c.data : "")).join("")),
  );

  // Main walk: visible text blocks and links, with an explicit stack.
  const blocks: TextBlock[] = [];
  const links: PageLink[] = [];
  let buffer = "";
  const rootMeta: Meta = { tag: "body", region: "main", context: "site" };
  const blockMetas: Meta[] = [rootMeta];

  const flush = () => {
    const text = clip(normalizeText(buffer), MAX_BLOCK_CHARS);
    buffer = "";
    if (text && blocks.length < MAX_BLOCKS)
      blocks.push({ text, ...blockMetas[blockMetas.length - 1] });
  };

  type Frame = {
    nodes: HtmlNode[];
    i: number;
    depth: number;
    region: Region;
    context: TextContext;
    block: boolean;
  };
  const stack: Frame[] = [
    { nodes: doc.children, i: 0, depth: 0, region: "main", context: "site", block: false },
  ];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.nodes.length) {
      stack.pop();
      if (frame.block) {
        flush();
        blockMetas.pop();
      }
      continue;
    }
    const node = frame.nodes[frame.i++];
    if (++visited > MAX_NODES) {
      parseLimited = true;
      break;
    }
    if (isTextNode(node)) {
      buffer += node.data;
      continue;
    }
    if (!isElement(node)) continue;
    const name = node.name;
    if (SKIP_TAGS.has(name) || isHidden(node)) continue;
    if (name === "br") {
      buffer += " ";
      continue;
    }
    if (frame.depth + 1 > MAX_DEPTH) {
      parseLimited = true;
      continue;
    }
    const role = (attr(node, "role") ?? "").toLowerCase();
    const region = REGION_BY_TAG[name] ?? REGION_BY_ROLE[role] ?? frame.region;
    const marker = `${attr(node, "id") ?? ""} ${attr(node, "class") ?? ""}`;
    const context: TextContext =
      frame.context === "content" ||
      name === "blockquote" ||
      (name === "article" && articles > 1) ||
      CONTENT_MARKER.test(marker)
        ? "content"
        : "site";

    if (name === "a" && links.length < MAX_LINKS) {
      const href = attr(node, "href");
      const abs = href ? absolute(href, input.url) : null;
      if (abs) links.push({ href: abs, text: textOf(node, 300), region, context });
    }

    const isBlock = BLOCK_TAGS.has(name);
    if (isBlock) {
      flush();
      const heading = /^h([1-6])$/.exec(name);
      blockMetas.push({
        tag: name,
        region,
        context,
        ...(heading ? { level: Number(heading[1]) } : {}),
      });
    }
    stack.push({
      nodes: node.children,
      i: 0,
      depth: frame.depth + 1,
      region,
      context,
      block: isBlock,
    });
  }
  flush();

  const mainChars = blocks
    .filter((b) => b.region === "main")
    .reduce((n, b) => n + b.text.length, 0);
  const noscriptText = noscripts.map((e) => textOf(e)).join(" ");
  const needsJavaScript =
    mainChars < 200 &&
    (scripts.length >= 3 || /enable javascript|requires javascript/i.test(noscriptText));

  const page = {
    ...base,
    lang,
    title,
    metaDescription: metaContent("name", "description"),
    ogSiteName: metaContent("property", "og:site_name"),
    ogTitle: metaContent("property", "og:title"),
    ogDescription: metaContent("property", "og:description"),
    ogType: metaContent("property", "og:type"),
    blocks,
    links,
    jsonLd,
    needsJavaScript,
    parseLimited,
  };
  return { ...page, evidence: buildEvidence(page) };
}
