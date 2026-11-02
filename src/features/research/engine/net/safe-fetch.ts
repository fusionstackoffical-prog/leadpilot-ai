import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { ResearchFetchError, statusError, toFetchError } from "./errors.ts";
import { resolvePublicAddress, systemResolver, type Resolver } from "./resolve.ts";
import { parseTargetUrl } from "./target-url.ts";
import { nodeTransport, type Transport, type TransportResponse } from "./transport.ts";

export const PAGE_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export type SafeFetchOptions = {
  userAgent: string;
  resolver?: Resolver;
  transport?: Transport;
  /** Per request (each redirect hop has its own budget). */
  timeoutMs?: number;
  connectTimeoutMs?: number;
  /** Maximum decoded body size. */
  maxBytes?: number;
  /** What to do when the body exceeds maxBytes: fail, or keep the first maxBytes. */
  oversize?: "error" | "truncate";
  maxRedirects?: number;
  /** Allowed media types; null accepts any (used for robots.txt). */
  allowedContentTypes?: string[] | null;
  accept?: string;
  /**
   * Wraps every request, including each redirect hop: robots.txt checks and per-host rate
   * limiting are applied here so a redirect cannot skip them.
   */
  hop?: <T>(url: URL, run: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
};

export type SafeFetchResult = {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  charset: string | null;
  body: Buffer;
  truncated: boolean;
  /** Each URL redirected to, in order. */
  redirects: string[];
  remoteAddress: string;
  headers: Record<string, string>;
};

const DEFAULTS = {
  timeoutMs: 15_000,
  connectTimeoutMs: 5_000,
  maxBytes: 2 * 1024 * 1024,
  oversize: "error" as const,
  maxRedirects: 5,
  allowedContentTypes: PAGE_CONTENT_TYPES,
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const KEPT_HEADERS = [
  "content-type",
  "content-length",
  "content-language",
  "last-modified",
  "etag",
  "x-robots-tag",
];

type Settings = Required<Omit<SafeFetchOptions, "hop" | "signal" | "resolver" | "transport">> & {
  resolver: Resolver;
  transport: Transport;
  signal: AbortSignal | undefined;
};

type HopOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "final"; result: Omit<SafeFetchResult, "redirects"> };

function header(headers: TransportResponse["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function parseContentType(value: string | undefined) {
  if (!value) return { mime: "", charset: null as string | null };
  const [type, ...params] = value.split(";");
  const charsetParam = params
    .map((p) => p.trim())
    .find((p) => p.toLowerCase().startsWith("charset="));
  const charset = charsetParam
    ? charsetParam.slice(8).trim().replace(/^"|"$/g, "").toLowerCase() || null
    : null;
  return { mime: type.trim().toLowerCase(), charset };
}

/** Decodes the body with its declared charset, falling back to UTF-8. Never throws. */
export function decodeBody(result: Pick<SafeFetchResult, "body" | "charset">) {
  try {
    return new TextDecoder(result.charset ?? "utf-8").decode(result.body);
  } catch {
    return new TextDecoder("utf-8").decode(result.body);
  }
}

/**
 * Reads a (possibly compressed) body, counting decoded bytes so a small compressed response
 * cannot expand into a huge one (decompression bomb).
 */
async function readBody(
  body: Readable,
  encoding: string | undefined,
  settings: Settings,
  url: string,
) {
  const enc = (encoding ?? "").trim().toLowerCase();
  let decoder: Transform | null = null;
  if (enc === "gzip" || enc === "x-gzip") decoder = createGunzip();
  else if (enc === "deflate") decoder = createInflate();
  else if (enc === "br") decoder = createBrotliDecompress();
  else if (enc !== "" && enc !== "identity") {
    body.destroy();
    throw new ResearchFetchError("decode_error", `Unsupported content encoding "${enc}"`, { url });
  }
  if (decoder) {
    const target = decoder;
    body.on("error", (error) => target.destroy(error));
    body.pipe(target);
  }
  const stream: Readable = decoder ?? body;

  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (total + buf.length > settings.maxBytes) {
        if (settings.oversize === "error") {
          throw new ResearchFetchError(
            "response_too_large",
            `The response from ${url} is larger than ${settings.maxBytes} bytes`,
            {
              url,
            },
          );
        }
        chunks.push(buf.subarray(0, settings.maxBytes - total));
        total = settings.maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } catch (error) {
    if (error instanceof ResearchFetchError) throw error;
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    // zlib reports Z_* codes; Node's brotli decoder reports ERR__ERROR_* / ERR_BROTLI* codes.
    if (
      stream !== body &&
      (code.startsWith("Z_") || code.startsWith("ERR__") || code.includes("BROTLI"))
    ) {
      throw new ResearchFetchError(
        "decode_error",
        `The response from ${url} could not be decompressed`,
        { url, cause: error },
      );
    }
    throw error;
  } finally {
    body.destroy();
    if (stream !== body) stream.destroy();
  }
  return { body: Buffer.concat(chunks, total), truncated };
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function fetchOnce(url: URL, settings: Settings): Promise<HopOutcome> {
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort(
      new ResearchFetchError(
        "timeout",
        `No complete response from ${url.host} within ${settings.timeoutMs / 1000} s`,
        {
          url: url.href,
        },
      ),
    );
  }, settings.timeoutMs);
  const signal = settings.signal
    ? AbortSignal.any([settings.signal, timeout.signal])
    : timeout.signal;

  try {
    const target = await abortable(resolvePublicAddress(url.hostname, settings.resolver), signal);
    const res = await settings.transport({
      url,
      address: target.address,
      family: target.family,
      headers: {
        "user-agent": settings.userAgent,
        accept: settings.accept,
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en",
      },
      signal,
      connectTimeoutMs: settings.connectTimeoutMs,
    });

    if (REDIRECT_STATUSES.has(res.status)) {
      res.body.destroy();
      const location = header(res.headers, "location");
      if (!location)
        throw new ResearchFetchError("http_status", `${url.href} redirected without a location`, {
          url: url.href,
          status: res.status,
        });
      return { kind: "redirect", location };
    }
    if (res.status < 200 || res.status > 299) {
      res.body.destroy();
      throw statusError(res.status, url.href, header(res.headers, "retry-after"));
    }

    const { mime, charset } = parseContentType(header(res.headers, "content-type"));
    if (settings.allowedContentTypes && !settings.allowedContentTypes.includes(mime)) {
      res.body.destroy();
      throw new ResearchFetchError(
        "unsupported_content_type",
        `${url.href} is not a web page (${mime || "no content type"})`,
        {
          url: url.href,
        },
      );
    }
    const declared = Number(header(res.headers, "content-length"));
    const encoded = (header(res.headers, "content-encoding") ?? "").trim() !== "";
    if (
      !encoded &&
      Number.isFinite(declared) &&
      declared > settings.maxBytes &&
      settings.oversize === "error"
    ) {
      res.body.destroy();
      throw new ResearchFetchError(
        "response_too_large",
        `The response from ${url.href} is larger than ${settings.maxBytes} bytes`,
        {
          url: url.href,
        },
      );
    }

    const { body, truncated } = await readBody(
      res.body,
      header(res.headers, "content-encoding"),
      settings,
      url.href,
    );
    const headers: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = header(res.headers, name);
      if (value !== undefined) headers[name] = value;
    }
    return {
      kind: "final",
      result: {
        url: url.href,
        status: res.status,
        contentType: mime,
        charset,
        body,
        truncated,
        remoteAddress: res.remoteAddress ?? target.address,
        headers,
      },
    };
  } catch (error) {
    if (timeout.signal.aborted) throw timeout.signal.reason;
    if (settings.signal?.aborted) {
      throw new ResearchFetchError("cancelled", "The request was cancelled", { url: url.href });
    }
    throw toFetchError(error, url.href);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a public web page safely: validated URL, public pinned address, manual redirects
 * (each hop fully re-validated and passed through `hop`), no https->http downgrade, timeouts,
 * content-type allow-list and decoded size cap. Throws ResearchFetchError.
 */
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const settings: Settings = {
    userAgent: options.userAgent,
    resolver: options.resolver ?? systemResolver,
    transport: options.transport ?? nodeTransport,
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
    maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
    oversize: options.oversize ?? DEFAULTS.oversize,
    maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
    allowedContentTypes:
      options.allowedContentTypes === undefined
        ? DEFAULTS.allowedContentTypes
        : options.allowedContentTypes,
    accept: options.accept ?? DEFAULTS.accept,
    signal: options.signal,
  };
  if (!settings.userAgent) throw new Error("safeFetch requires a user agent");
  const hop = options.hop ?? (<T>(_url: URL, run: () => Promise<T>) => run());

  let current = parseTargetUrl(input);
  const seen = new Set([current.href]);
  const redirects: string[] = [];
  for (;;) {
    if (settings.signal?.aborted)
      throw new ResearchFetchError("cancelled", "The request was cancelled", { url: current.href });
    const target = current;
    const outcome = await hop(target, () => fetchOnce(target, settings));
    if (outcome.kind === "final") return { ...outcome.result, redirects };

    if (redirects.length >= settings.maxRedirects) {
      throw new ResearchFetchError(
        "too_many_redirects",
        `${input.toString()} redirected more than ${settings.maxRedirects} times`,
        {
          url: current.href,
        },
      );
    }
    let next: URL;
    try {
      next = parseTargetUrl(outcome.location, current);
    } catch (error) {
      const reason = error instanceof ResearchFetchError ? error.message : "invalid location";
      throw new ResearchFetchError(
        "redirect_blocked",
        `${current.href} redirected to a URL that is not allowed: ${reason}`,
        {
          url: current.href,
        },
      );
    }
    if (current.protocol === "https:" && next.protocol === "http:") {
      throw new ResearchFetchError(
        "redirect_blocked",
        `${current.href} redirected from HTTPS to insecure HTTP`,
        {
          url: current.href,
        },
      );
    }
    if (seen.has(next.href)) {
      throw new ResearchFetchError("too_many_redirects", `${current.href} redirects in a loop`, {
        url: current.href,
      });
    }
    seen.add(next.href);
    redirects.push(next.href);
    current = next;
  }
}
