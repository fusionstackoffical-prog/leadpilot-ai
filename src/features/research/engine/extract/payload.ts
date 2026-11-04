import { gzipSync } from "node:zlib";
import { verifyQuote } from "./evidence.ts";
import { MAX_QUOTE_CHARS } from "./findings.ts";
import { clip, clipCodePoints, QUOTE_CHECK } from "./text.ts";
import type { ExtractedFinding, ExtractionResult, FindingCategory, ParsedPage } from "./types.ts";

/**
 * Builds the input of public.worker_complete_research_run (migration 009) from an extraction:
 * one source per fetched page (with its gzip evidence text to upload to the private
 * `research-sources` bucket first) and one finding per fact/candidate.
 *
 * Phase 3B only builds this; the worker that uploads and saves it is Phase 3C.
 *
 * Migration 009 has no "product", "industry", "company_name", "website" or "contact_page"
 * finding category, so those are stored as category "company_detail" with a typed field_key
 * ("product:...", "industry:...", ...) and the original category in value_json. A later
 * migration may add dedicated categories; see the Phase 3B report.
 */

export const STORAGE_BUCKET = "research-sources";
const MAX_GZIP_BYTES = 262_144; // bucket and lead_sources.text_bytes limit
const MAX_SOURCES = 25;
const MAX_FINDINGS = 300;

type DbCategory =
  | "business_description"
  | "service"
  | "service_area"
  | "location"
  | "contact_email"
  | "contact_phone"
  | "contact_address"
  | "social_profile"
  | "company_detail";

const DB_CATEGORY: Record<FindingCategory, DbCategory> = {
  company_name: "company_detail",
  website: "company_detail",
  business_description: "business_description",
  industry: "company_detail",
  service: "service",
  product: "company_detail",
  contact_email: "contact_email",
  contact_phone: "contact_phone",
  contact_page: "company_detail",
  contact_address: "contact_address",
  location: "location",
  service_area: "service_area",
  social_profile: "social_profile",
};

export type CompletionPayload = {
  pipeline_version: string;
  warnings: { code: string; message: string; url?: string }[];
  usage: { pages_fetched: number };
  sources: {
    ref: string;
    source_type: "company_website";
    source_name: string;
    url: string;
    final_url: string;
    http_status: number;
    content_type: string;
    title: string | null;
    retrieved_at: string;
    text: { sha256: string; chars: number; bytes: number };
  }[];
  findings: {
    ref: string;
    category: DbCategory;
    kind: "fact" | "candidate";
    field_key: string;
    value_text: string;
    value_json: Record<string, unknown>;
    source_ref: string;
    evidence_quote: string;
    quote_check?: typeof QUOTE_CHECK;
  }[];
};

export type EvidenceUpload = { sha256: string; body: Buffer; contentType: "application/gzip" };

/** {workspace}/{lead}/{run}/{sha256}.txt.gz — the path migration 009 derives for each source. */
export function evidenceStoragePath(
  ids: { workspaceId: string; leadId: string; runId: string },
  sha256: string,
) {
  return `${ids.workspaceId}/${ids.leadId}/${ids.runId}/${sha256}.txt.gz`;
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

export function buildCompletionPayload(
  pages: ParsedPage[],
  extraction: ExtractionResult,
  options: { pipelineVersion?: string } = {},
): { payload: CompletionPayload; uploads: EvidenceUpload[] } {
  const used = pages.slice(0, MAX_SOURCES);
  const refByUrl = new Map<string, string>();
  const uploads = new Map<string, EvidenceUpload>();

  const sources = used.map((page, i) => {
    const ref = `s${i + 1}`;
    refByUrl.set(page.url, ref);
    const body = gzipSync(Buffer.from(page.evidence.text, "utf8"));
    if (body.length > MAX_GZIP_BYTES) {
      throw new PayloadError(
        `Evidence text for ${page.url} is too large to store (${body.length} bytes compressed)`,
      );
    }
    uploads.set(page.evidence.sha256, {
      sha256: page.evidence.sha256,
      body,
      contentType: "application/gzip",
    });
    return {
      ref,
      source_type: "company_website" as const,
      source_name: "Company website",
      url: page.requestedUrl,
      final_url: page.url,
      http_status: page.status,
      content_type: page.contentType,
      title: page.title ? clip(page.title, 500) : null,
      retrieved_at: page.retrievedAt,
      text: { sha256: page.evidence.sha256, chars: page.evidence.chars, bytes: body.length },
    };
  });

  const pageByUrl = new Map(used.map((p) => [p.url, p]));
  const findings: CompletionPayload["findings"] = [];
  extraction.findings.slice(0, MAX_FINDINGS).forEach((f: ExtractedFinding, i) => {
    const page = pageByUrl.get(f.sourceUrl);
    const ref = refByUrl.get(f.sourceUrl);
    if (!page || !ref) return; // finding from a page beyond the source limit
    // Defence in depth: nothing reaches the database without verified quotes.
    if (![f.quote, ...(f.evidence ?? [])].every((q) => verifyQuote(page, q)))
      throw new PayloadError(`Unverified evidence for ${f.category} "${f.value}"`);
    findings.push({
      ref: `f${i + 1}`,
      category: DB_CATEGORY[f.category],
      kind: f.kind,
      field_key: f.key.slice(0, 200),
      value_text: f.value,
      value_json: {
        category: f.category,
        method: f.method,
        ...(f.details ? { details: f.details } : {}),
        ...(f.evidence ? { evidence: f.evidence } : {}),
      },
      source_ref: ref,
      evidence_quote: clipCodePoints(f.quote, MAX_QUOTE_CHARS),
      ...(f.kind === "fact" ? { quote_check: QUOTE_CHECK } : {}),
    });
  });

  const payload: CompletionPayload = {
    pipeline_version: options.pipelineVersion ?? "research-v1",
    warnings: extraction.warnings
      .slice(0, 50)
      .map((w) => ({ code: w.code, message: w.message, ...(w.url ? { url: w.url } : {}) })),
    usage: { pages_fetched: pages.length },
    sources,
    findings,
  };
  // PostgreSQL rejects JSON containing unpaired UTF-16 surrogates; never send one.
  assertWellFormed(payload);
  return { payload, uploads: [...uploads.values()] };
}

function assertWellFormed(value: unknown, path = "payload"): void {
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new PayloadError(`${path} is not well-formed Unicode`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertWellFormed(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertWellFormed(v, `${path}.${k}`);
  }
}
