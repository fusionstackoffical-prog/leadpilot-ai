import { isIP } from "node:net";
import { ResearchFetchError } from "./errors.ts";

export const MAX_URL_LENGTH = 2048;

// A public, dotted hostname with an alphabetic (or IDN "xn--") top-level domain.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// Top-level names reserved for local networks, special use or testing; never public websites.
const RESERVED_TLDS = new Set([
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "arpa",
  "onion",
  "invalid",
  "test",
]);

/**
 * Validates a URL the worker is about to request: http(s) only, no credentials, default
 * ports only, and a public domain name (never an IP literal, including disguised forms such
 * as http://2130706433/ or http://0x7f.1/, which the URL parser turns into 127.0.0.1).
 * Returns a normalized URL without the fragment.
 */
export function parseTargetUrl(input: string | URL, base?: string | URL): URL {
  const raw = typeof input === "string" ? input.trim() : input.href;
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new ResearchFetchError("invalid_url", "The URL is empty or longer than 2048 characters");
  }

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new ResearchFetchError("invalid_url", "The URL is not valid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ResearchFetchError(
      "invalid_url",
      `Only http and https URLs are allowed (got ${url.protocol})`,
    );
  }
  if (url.username || url.password) {
    throw new ResearchFetchError(
      "invalid_url",
      "URLs with a user name or password are not allowed",
    );
  }
  if (url.port !== "") {
    throw new ResearchFetchError("invalid_url", "Only the standard ports (80 and 443) are allowed");
  }

  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[(.*)\]$/, "$1"))) {
    throw new ResearchFetchError(
      "blocked_address",
      "IP-address URLs are not allowed; a domain name is required",
      {
        url: url.href,
      },
    );
  }
  if (!HOSTNAME.test(host)) {
    throw new ResearchFetchError("invalid_url", `${host} is not a public domain name`);
  }
  if (RESERVED_TLDS.has(host.slice(host.lastIndexOf(".") + 1))) {
    throw new ResearchFetchError("blocked_address", `${host} uses a reserved, non-public domain`, {
      url: url.href,
    });
  }

  url.hash = "";
  if (url.href.length > MAX_URL_LENGTH) {
    throw new ResearchFetchError("invalid_url", "The URL is longer than 2048 characters");
  }
  return url;
}
