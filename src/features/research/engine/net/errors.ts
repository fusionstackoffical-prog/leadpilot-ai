/**
 * Errors raised while fetching public web pages for company research, and how the worker
 * should treat them (retry later or give up). Messages are written for operators and never
 * contain secrets or request headers.
 */
import { ExtractionError, type ExtractionErrorCode } from "../extract/errors.ts";

export type FetchErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_not_found"
  | "dns_temporary"
  | "connect_timeout"
  | "timeout"
  | "connection_failed"
  | "tls_error"
  | "too_many_redirects"
  | "redirect_blocked"
  | "outside_boundary"
  | "robots_disallowed"
  | "robots_unavailable"
  | "http_status"
  | "unsupported_content_type"
  | "response_too_large"
  | "decode_error"
  | "cancelled";

/** Whether a failure is worth retrying later, when the error does not say otherwise. */
const RETRYABLE_BY_DEFAULT: Record<FetchErrorCode, boolean> = {
  invalid_url: false,
  blocked_address: false,
  dns_not_found: false,
  dns_temporary: true,
  connect_timeout: true,
  timeout: true,
  connection_failed: true,
  tls_error: false,
  too_many_redirects: false,
  redirect_blocked: false,
  outside_boundary: false,
  robots_disallowed: false,
  robots_unavailable: true,
  http_status: false,
  unsupported_content_type: false,
  response_too_large: false,
  decode_error: false,
  cancelled: false,
};

/** HTTP statuses that usually succeed on a later attempt. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Longest Retry-After we honour; anything longer is treated as one hour. */
export const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

export class ResearchFetchError extends Error {
  readonly code: FetchErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly url: string | undefined;

  constructor(
    code: FetchErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      retryAfterMs?: number;
      url?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ResearchFetchError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT[code];
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.url = options.url;
  }
}

export function isRetryableStatus(status: number) {
  return RETRYABLE_STATUS.has(status);
}

/** Parses a Retry-After header (seconds or an HTTP date) into milliseconds from `now`. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()) {
  if (!value) return undefined;
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return undefined;
    ms = at - now;
  }
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** The error for a non-success HTTP status. */
export function statusError(status: number, url: string, retryAfter?: string | null, now?: number) {
  return new ResearchFetchError("http_status", `${url} responded with HTTP ${status}`, {
    status,
    url,
    retryable: isRetryableStatus(status),
    retryAfterMs: parseRetryAfter(retryAfter, now),
  });
}

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "HOSTNAME_MISMATCH",
  "EPROTO",
]);

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
]);

function hostOf(url: string | undefined) {
  if (!url) return "the site";
  try {
    return new URL(url).host;
  } catch {
    return "the site";
  }
}

/** Converts any error thrown by DNS, sockets, TLS or streams into a ResearchFetchError. */
export function toFetchError(error: unknown, url?: string): ResearchFetchError {
  if (error instanceof ResearchFetchError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const name = error instanceof Error ? error.name : "";
  const where = hostOf(url);

  if (code === "ENOTFOUND" || code === "ENODATA") {
    return new ResearchFetchError("dns_not_found", `The domain ${where} does not exist`, {
      url,
      cause: error,
    });
  }
  if (code === "EAI_AGAIN" || code === "ESERVFAIL" || code === "ETIMEOUT") {
    return new ResearchFetchError(
      "dns_temporary",
      `The domain ${where} could not be looked up right now`,
      { url, cause: error },
    );
  }
  if (TLS_CODES.has(code) || /^(CERT_|ERR_TLS_|ERR_SSL_)/.test(code)) {
    return new ResearchFetchError(
      "tls_error",
      `The HTTPS certificate of ${where} could not be verified`,
      { url, cause: error },
    );
  }
  if (code === "ABORT_ERR" || name === "AbortError") {
    return new ResearchFetchError("cancelled", "The request was cancelled", { url, cause: error });
  }
  if (CONNECTION_CODES.has(code) || code.startsWith("HPE_")) {
    return new ResearchFetchError("connection_failed", `The connection to ${where} failed`, {
      url,
      cause: error,
    });
  }
  return new ResearchFetchError("connection_failed", `The request to ${where} failed`, {
    url,
    cause: error,
  });
}

/**
 * What the worker records for a failed research run. Extraction failures keep their own code
 * and are never retried; everything else is classified as a fetch failure.
 */
export function describeFailure(error: unknown): {
  code: FetchErrorCode | ExtractionErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs: number | undefined;
} {
  if (error instanceof ExtractionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: undefined,
    };
  }
  const e = toFetchError(error);
  return { code: e.code, message: e.message, retryable: e.retryable, retryAfterMs: e.retryAfterMs };
}
