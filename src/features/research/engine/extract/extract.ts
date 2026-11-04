import type { ResearchFetcher } from "../net/fetcher.ts";
import { crawlCompanyWebsite, type CrawlOptions } from "./crawl.ts";
import {
  compareNames,
  extractCompany,
  extractContact,
  extractLocation,
  extractOfferings,
  extractSocial,
} from "./extractors.ts";
import { FindingCollector } from "./findings.ts";
import type { ExtractionResult, ExtractionWarning, FindingCategory, ParsedPage } from "./types.ts";
import { ALL_CATEGORIES } from "./types.ts";

const PARKED =
  /(this domain (is|may be) for sale|buy this domain|domain (is )?parked|parked (free|domain)|hugedomains|sedo\.com|dan\.com|afternic)/i;

/**
 * Industry-neutral extraction over already-fetched pages of one company website. Produces only
 * facts and candidates backed by verified quotes from those pages; categories with nothing found
 * are reported as missing, never filled in.
 */
export function extractFromPages(
  pages: ParsedPage[],
  context: { companyName?: string | null } = {},
  initialWarnings: ExtractionWarning[] = [],
): ExtractionResult {
  const warnings = [...initialWarnings];
  if (pages.length === 0) {
    return {
      website: null,
      findings: [],
      missing: ALL_CATEGORIES.filter((c) => c !== "website"),
      warnings,
      nameMatch: "unknown",
    };
  }

  const collector = new FindingCollector(warnings);
  extractCompany(pages, collector);
  extractOfferings(pages, collector);
  extractContact(pages, collector);
  extractLocation(pages, collector);
  extractSocial(pages, collector);
  const findings = collector.list();

  const home = pages[0];
  const homeText = [home.title ?? "", ...home.blocks.slice(0, 50).map((b) => b.text)].join(" ");
  if (PARKED.test(homeText)) {
    warnings.push({
      code: "parked_domain",
      message: "The website looks like a parked or for-sale domain, not the company's site",
      url: home.url,
    });
  }

  const siteNames = findings.filter((f) => f.category === "company_name").map((f) => f.value);
  const nameMatch = compareNames(context.companyName, siteNames);
  if (nameMatch === "mismatch") {
    warnings.push({
      code: "name_mismatch",
      message:
        "The website's name does not match the imported company name; check that this is the right website",
      url: home.url,
    });
  }

  const found = new Set<FindingCategory>(findings.map((f) => f.category));
  return {
    website: home.url,
    findings,
    missing: ALL_CATEGORIES.filter((c) => !found.has(c)),
    warnings,
    nameMatch,
  };
}

/** Crawls the company's website through the Phase 3A fetcher, then extracts from it. */
export async function researchCompanyWebsite(
  website: string,
  fetcher: Pick<ResearchFetcher, "fetchPage">,
  context: { companyName?: string | null } = {},
  options: CrawlOptions = {},
) {
  const crawl = await crawlCompanyWebsite(website, fetcher, options);
  return { pages: crawl.pages, extraction: extractFromPages(crawl.pages, context, crawl.warnings) };
}
