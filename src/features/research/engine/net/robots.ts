import robotsParser from "robots-parser";
import { ResearchFetchError, toFetchError } from "./errors.ts";
import { decodeBody, type SafeFetchResult } from "./safe-fetch.ts";

/** Google reads at most 500 KiB of robots.txt; we do the same and ignore the rest. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

type Robot = ReturnType<typeof robotsParser>;
type Rules =
  | { kind: "file"; robot: Robot }
  | { kind: "no_file" }
  | { kind: "unavailable"; error: ResearchFetchError };

export type RobotsDecision = {
  allowed: boolean;
  /** Crawl-delay requested for our bot (or for all bots), capped. */
  crawlDelayMs: number;
  reason: "allowed" | "disallowed" | "no_robots_file" | "unavailable";
  error?: ResearchFetchError;
};

export type RobotsCacheOptions = {
  /** Fetches /robots.txt (through the safe fetcher and the host rate limiter). */
  fetchRobots: (robotsUrl: URL) => Promise<SafeFetchResult>;
  /** Our product token, matched against User-agent lines. */
  userAgentToken: string;
  ttlMs?: number;
  /** How long a failed robots.txt read is remembered before trying again. */
  failureTtlMs?: number;
  maxCrawlDelayMs?: number;
  now?: () => number;
};

/**
 * robots.txt rules per origin, fetched once and cached.
 * - 2xx: rules apply (for our token, else `*`), including Crawl-delay.
 * - 4xx other than 429: no rules, everything allowed (as the robots.txt standard says).
 * - 429, 5xx or a network failure: treated as "disallow everything" for now, so we never crawl
 *   a site whose rules we could not read; the fetch is reported as retryable.
 * - The domain not existing, a blocked address or a TLS failure is rethrown: the site itself
 *   cannot be fetched, and the caller reports that reason instead.
 */
export class RobotsCache {
  readonly #options: Required<RobotsCacheOptions>;
  readonly #entries = new Map<string, { expiresAt: number; rules: Promise<Rules> }>();

  constructor(options: RobotsCacheOptions) {
    // `??` rather than spreading: callers may pass undefined for any option to mean "default".
    this.#options = {
      fetchRobots: options.fetchRobots,
      userAgentToken: options.userAgentToken,
      ttlMs: options.ttlMs ?? 24 * 60 * 60 * 1000,
      failureTtlMs: options.failureTtlMs ?? 5 * 60 * 1000,
      maxCrawlDelayMs: options.maxCrawlDelayMs ?? 10_000,
      now: options.now ?? Date.now,
    };
  }

  async check(url: URL): Promise<RobotsDecision> {
    if (url.pathname === "/robots.txt")
      return { allowed: true, crawlDelayMs: 0, reason: "allowed" };
    const rules = await this.#rules(url.origin);
    if (rules.kind === "no_file")
      return { allowed: true, crawlDelayMs: 0, reason: "no_robots_file" };
    if (rules.kind === "unavailable")
      return { allowed: false, crawlDelayMs: 0, reason: "unavailable", error: rules.error };

    const token = this.#options.userAgentToken;
    // isAllowed() returns undefined for a URL on another origin; never treat that as allowed.
    const allowed = rules.robot.isAllowed(url.href, token) === true;
    const delaySeconds = rules.robot.getCrawlDelay(token) ?? 0;
    const crawlDelayMs = Math.min(
      Math.max(Number(delaySeconds) * 1000 || 0, 0),
      this.#options.maxCrawlDelayMs,
    );
    return { allowed, crawlDelayMs, reason: allowed ? "allowed" : "disallowed" };
  }

  #rules(origin: string): Promise<Rules> {
    const now = this.#options.now();
    const cached = this.#entries.get(origin);
    if (cached && cached.expiresAt > now) return cached.rules;

    const entry = { expiresAt: now + this.#options.ttlMs, rules: this.#load(origin) };
    this.#entries.set(origin, entry);
    entry.rules.then(
      (rules) => {
        if (rules.kind === "unavailable")
          entry.expiresAt = this.#options.now() + this.#options.failureTtlMs;
      },
      () => {
        entry.expiresAt = this.#options.now() + this.#options.failureTtlMs;
      },
    );
    return entry.rules;
  }

  async #load(origin: string): Promise<Rules> {
    const robotsUrl = new URL("/robots.txt", origin);
    try {
      const result = await this.#options.fetchRobots(robotsUrl);
      return { kind: "file", robot: robotsParser(robotsUrl.href, decodeBody(result)) };
    } catch (error) {
      const e = toFetchError(error, robotsUrl.href);
      if (
        e.code === "http_status" &&
        e.status !== undefined &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429
      ) {
        return { kind: "no_file" };
      }
      if (
        ["dns_not_found", "blocked_address", "invalid_url", "tls_error", "cancelled"].includes(
          e.code,
        )
      )
        throw e;
      return { kind: "unavailable", error: e };
    }
  }
}
