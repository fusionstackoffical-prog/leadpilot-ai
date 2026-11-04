import { NON_BUSINESS_TYPES } from "./schema.ts";
import { clip, normalizeText } from "./text.ts";
import type { JsonLdEntity } from "./types.ts";

const MAX_SCRIPT_CHARS = 200_000;
/** Cap for ordinary entities (products, offers, nested objects ...). */
const MAX_ENTITIES = 100;
/** Extra room kept for top-level business entities, so a long product list cannot push the
 * business itself out. */
const MAX_RESERVED = 20;
const MAX_PROPS = 300;
const MAX_DEPTH = 6;
const MAX_VALUE_CHARS = 2_000;

/** "https://schema.org/Dentist" or "schema:Dentist" -> "Dentist". */
function typeName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/^https?:\/\/schema\.org\//i, "")
    .replace(/^schema:/i, "")
    .trim();
  return /^[A-Za-z][A-Za-z0-9]{0,80}$/.test(name) ? name : null;
}

function typesOf(node: Record<string, unknown>) {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(typeName).filter((t): t is string => t !== null);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Pending = {
  node: unknown;
  depth: number;
  topLevel: boolean;
  relations: string[];
  parentTypes: string[];
};

/**
 * Turns JSON-LD script contents into flat schema.org entities. Every object with an @type
 * becomes an entity (nested ones too, e.g. an Offer's itemOffered Service), with its own
 * properties flattened to "path: value" strings and a record of how it was reached
 * (`relations`), so callers can tell the business from, say, a product's manufacturer.
 *
 * Each script is walked breadth-first with an explicit queue (no recursion), so root entities
 * come before nested ones. Invalid JSON is ignored, and size, depth and count limits keep
 * hostile pages from exhausting memory.
 */
export function extractJsonLd(scripts: string[]): JsonLdEntity[] {
  const entities: JsonLdEntity[] = [];
  let reserved = 0;

  for (const script of scripts) {
    if (script.length > MAX_SCRIPT_CHARS) continue;
    let parsed: unknown;
    try {
      // Some sites wrap JSON-LD in HTML comments or CDATA; strip those wrappers only.
      parsed = JSON.parse(
        script
          .trim()
          .replace(/^<!--|-->$/g, "")
          .replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, ""),
      );
    } catch {
      continue;
    }

    const queue: Pending[] = [
      { node: parsed, depth: 0, topLevel: true, relations: [], parentTypes: [] },
    ];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.depth > MAX_DEPTH) continue;
      if (Array.isArray(item.node)) {
        for (const child of item.node) queue.push({ ...item, node: child, depth: item.depth + 1 });
        continue;
      }
      if (!isObject(item.node)) continue;
      const node = item.node;
      if (Array.isArray(node["@graph"])) {
        queue.push({ ...item, node: node["@graph"], depth: item.depth + 1 });
      }

      const types = typesOf(node);
      if (types.length > 0) {
        const businessLike = item.topLevel && types.some((t) => !NON_BUSINESS_TYPES.has(t));
        const room = entities.length < MAX_ENTITIES + reserved;
        if (room || (businessLike && reserved < MAX_RESERVED)) {
          if (!room) reserved += 1;
          const props: Record<string, string> = {};
          flatten(node, "", props, 0);
          entities.push({
            types,
            props,
            topLevel: item.topLevel,
            relations: item.relations,
            parentTypes: item.parentTypes,
          });
        }
      }

      const parentTypes = types.length > 0 ? types : item.parentTypes;
      for (const [key, value] of Object.entries(node)) {
        if (key === "@graph" || key === "@context") continue;
        if (isObject(value) || Array.isArray(value)) {
          queue.push({
            node: value,
            depth: item.depth + 1,
            topLevel: false,
            relations: [...item.relations, key],
            parentTypes,
          });
        }
      }
    }
  }
  return entities;
}

/** Flattens one entity's own properties. Depth-limited (MAX_DEPTH), so recursion is bounded. */
function flatten(value: unknown, path: string, out: Record<string, string>, depth: number) {
  if (Object.keys(out).length >= MAX_PROPS || depth > MAX_DEPTH) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = clip(normalizeText(String(value)), MAX_VALUE_CHARS);
    if (text && path) out[path] = text;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "@context" || key === "@graph") continue;
    if (key === "@type") {
      const types = typesOf(value);
      if (types.length && path) out[`${path}.@type`] = types.join(", ");
      continue;
    }
    if (!/^[@A-Za-z][A-Za-z0-9_-]{0,60}$/.test(key)) continue;
    flatten(child, path ? `${path}.${key}` : key, out, depth + 1);
  }
}

/** The evidence lines for an entity: "@type: A, B" then "path: value" lines. */
export function jsonLdLines(entity: JsonLdEntity) {
  return [
    `@type: ${entity.types.join(", ")}`,
    ...Object.entries(entity.props).map(([k, v]) => `${k}: ${v}`),
  ];
}
