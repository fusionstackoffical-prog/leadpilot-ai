import { BOT_TOKEN, loadResearchFetchConfig, type ResearchFetchConfig } from "../config.ts";
import { ResearchFetchError } from "./errors.ts";
import { HostRateLimiter, type Clock } from "./host-limiter.ts";
import type { Resolver } from "./resolve.ts";
import { ROBOTS_MAX_BYTES, RobotsCache } from "./robots.ts";
import { safeFetch, type SafeFetchResult } from "./safe-fetch.ts";
import type { Transport } from "./transport.ts";

export type ResearchFetcher = {
  /** Fetches a page, obeying robots.txt and per-host rate limits on every hop. */
  fetchPage: (url: string | URL, options?: { signal?: AbortSignal }) => Promise<SafeFetchResult>;
  robots: RobotsCache;
  limiter: HostRateLimiter;
};

export type ResearchFetcherDeps = {
  config: ResearchFetchConfig;
  /** Test seams: production always uses system DNS and Node's http/https. */
  resolver?: Resolver;
  transport?: Transport;
  clock?: Clock;
};

export function createResearchFetcher({
  config,
  resolver,
  transport,
  clock,
}: ResearchFetcherDeps): ResearchFetcher {
  const limiter = new HostRateLimiter({
    minIntervalMs: config.minHostIntervalMs,
    maxIntervalMs: config.maxCrawlDelayMs,
    clock,
  });
  const common = {
    userAgent: config.userAgent,
    resolver,
    transport,
    timeoutMs: config.timeoutMs,
    connectTimeoutMs: config.connectTimeoutMs,
    maxRedirects: config.maxRedirects,
  };

  const robots = new RobotsCache({
    userAgentToken: BOT_TOKEN,
    maxCrawlDelayMs: config.maxCrawlDelayMs,
    now: clock?.now,
    fetchRobots: (robotsUrl) =>
      limiter.run(robotsUrl.host, () =>
        safeFetch(robotsUrl, {
          ...common,
          allowedContentTypes: null,
          maxBytes: ROBOTS_MAX_BYTES,
          oversize: "truncate",
          accept: "text/plain,*/*;q=0.1",
        }),
      ),
  });

  async function fetchPage(url: string | URL, options: { signal?: AbortSignal } = {}) {
    return safeFetch(url, {
      ...common,
      maxBytes: config.maxPageBytes,
      signal: options.signal,
      hop: async (target, run) => {
        const decision = await robots.check(target);
        if (!decision.allowed) {
          if (decision.reason === "unavailable") {
            throw new ResearchFetchError(
              "robots_unavailable",
              `robots.txt for ${target.host} could not be read, so the site was not crawled`,
              {
                url: target.href,
                retryAfterMs: decision.error?.retryAfterMs,
              },
            );
          }
          throw new ResearchFetchError(
            "robots_disallowed",
            `robots.txt does not allow ${target.href}`,
            { url: target.href },
          );
        }
        return limiter.run(target.host, run, decision.crawlDelayMs);
      },
    });
  }

  return { fetchPage, robots, limiter };
}

/** The fetcher the worker uses: real DNS and network, configuration from the environment. */
export function createProductionFetcher(env?: Record<string, string | undefined>) {
  return createResearchFetcher({ config: loadResearchFetchConfig(env) });
}
