import { ResearchFetchError, toFetchError } from "../net/errors.ts";
import type { ResearchFetcher } from "../net/fetcher.ts";
import type { SafeFetchResult } from "../net/safe-fetch.ts";
import { parseTargetUrl } from "../net/target-url.ts";
import { ExtractionError } from "./errors.ts";
import { decodeHtml, parsePage } from "./html.ts";
import { sameSite, selectPages, withinBoundary } from "./pages.ts";
import type { ExtractionWarning, PageType, ParsedPage } from "./types.ts";

export type CrawlOptions = {
  /** Total pages including the home page. */
  maxPages?: number;
  maxPerType?: number;
  /** Overall time budget for the whole crawl. */
  deadlineMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
};

export type CrawlResult = {
  home: URL;
  pages: ParsedPage[];
  warnings: ExtractionWarning[];
};

export const DEFAULT_CRAWL = { maxPages: 6, maxPerType: 2, deadlineMs: 120_000 } as const;

/**
 * Turns an imported website value into the URL to start from. A bare domain ("acme.com") is
 * assumed to be https. Everything is validated by the Phase 3A URL policy.
 */
export function startUrl(website: string) {
  const raw = website.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  return parseTargetUrl(withScheme);
}

function toParsed(result: SafeFetchResult, requestedUrl: string, type: PageType, now: () => Date) {
  return parsePage(
    {
      html: decodeHtml(result),
      contentType: result.contentType,
      requestedUrl,
      url: result.url,
      status: result.status,
    },
    type,
    now().toISOString(),
  );
}

/**
 * Fetches a company's own website: the home page, then a few internal about / services /
 * products / contact / locations pages linked from it. Every request goes through the Phase 3A
 * fetcher (address policy, pinning, redirects, robots.txt, rate limits, size and time limits).
 *
 * Domain boundary: the supplied website's domain (with or without "www.", and its subdomains)
 * is the limit for the home page and every redirect it makes; discovered pages must stay on the
 * home page's own host. The boundary is passed to the fetcher, which checks it on every hop
 * before robots.txt is read or any request is made, so a redirect to another website (a new
 * owner, a social network ...) never contacts that website at all.
 *
 * A failure on the home page is thrown (fetch errors keep their Phase 3A classification;
 * extraction errors are permanent); failures on other pages become warnings. The whole crawl is
 * limited by `deadlineMs`: pages fetched before the deadline are kept.
 */
export async function crawlCompanyWebsite(
  website: string,
  fetcher: Pick<ResearchFetcher, "fetchPage">,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? DEFAULT_CRAWL.maxPages;
  const maxPerType = options.maxPerType ?? DEFAULT_CRAWL.maxPerType;
  const deadlineMs = options.deadlineMs ?? DEFAULT_CRAWL.deadlineMs;
  const start = startUrl(website);

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  timer.unref?.();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const deadlineError = () =>
    new ExtractionError(
      "crawl_deadline_exceeded",
      `The website did not finish loading within ${Math.round(deadlineMs / 1000)} s`,
      { url: start.href },
    );

  try {
    let homeResult: SafeFetchResult;
    try {
      homeResult = await fetcher.fetchPage(start, {
        signal,
        boundary: (url) => withinBoundary(url, start),
      });
    } catch (error) {
      if (deadline.signal.aborted && !options.signal?.aborted) throw deadlineError();
      const e = toFetchError(error, start.href);
      if (e.code === "outside_boundary") {
        throw new ResearchFetchError(
          "outside_boundary",
          `${start.host} redirects to ${e.url ? new URL(e.url).host : "another website"}, which is outside the company's website, so it was not researched. Check the company's website address.`,
          { url: e.url },
        );
      }
      throw e;
    }

    let homePage: ParsedPage;
    try {
      homePage = toParsed(homeResult, start.href, "home", now);
    } catch (error) {
      throw new ExtractionError("page_unparseable", "The home page could not be read", {
        url: homeResult.url,
        cause: error,
      });
    }
    const home = new URL(homePage.url);
    const pages: ParsedPage[] = [homePage];
    const warnings: ExtractionWarning[] = [];

    const note = (page: ParsedPage) => {
      if (page.needsJavaScript) {
        warnings.push({
          code: "page_needs_javascript",
          message:
            "This page shows little content without JavaScript, so some information may be missing",
          url: page.url,
        });
      }
      if (page.parseLimited) {
        warnings.push({
          code: "page_parse_limited",
          message:
            "This page's markup is unusually deeply nested or large; only part of it was read",
          url: page.url,
        });
      }
      if (page.evidence.truncated) {
        warnings.push({
          code: "evidence_truncated",
          message: "The page was very long; only its first part was kept",
          url: page.url,
        });
      }
    };
    note(homePage);

    for (const target of selectPages(homePage.links, home, { maxPages, maxPerType })) {
      if (options.signal?.aborted) {
        throw new ResearchFetchError("cancelled", "Research was cancelled");
      }
      if (deadline.signal.aborted) {
        warnings.push({
          code: "crawl_deadline",
          message: `The time limit of ${Math.round(deadlineMs / 1000)} s was reached; remaining pages were skipped`,
        });
        break;
      }
      let result: SafeFetchResult;
      try {
        result = await fetcher.fetchPage(target.url, {
          signal,
          boundary: (url) => sameSite(url, home),
        });
      } catch (error) {
        if (options.signal?.aborted) {
          throw new ResearchFetchError("cancelled", "Research was cancelled");
        }
        if (deadline.signal.aborted) {
          warnings.push({
            code: "crawl_deadline",
            message: `The time limit of ${Math.round(deadlineMs / 1000)} s was reached; remaining pages were skipped`,
            url: target.url.href,
          });
          break;
        }
        const e = toFetchError(error, target.url.href);
        warnings.push(
          e.code === "robots_disallowed"
            ? {
                code: "page_skipped_robots",
                message: "robots.txt does not allow this page",
                url: target.url.href,
              }
            : e.code === "outside_boundary"
              ? {
                  code: "page_skipped_offsite",
                  message: "This link leads to another website, which was not contacted",
                  url: target.url.href,
                }
              : { code: "page_failed", message: e.message, url: target.url.href },
        );
        continue;
      }
      if (pages.some((p) => p.url === result.url)) continue;
      try {
        const page = toParsed(result, target.url.href, target.type, now);
        note(page);
        pages.push(page);
      } catch {
        warnings.push({
          code: "page_parse_failed",
          message: "This page could not be read and was skipped",
          url: result.url,
        });
      }
    }
    return { home, pages, warnings };
  } finally {
    clearTimeout(timer);
  }
}
