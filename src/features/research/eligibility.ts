import { nonCompanySite } from "./engine/net/non-company-sites.ts";
import { parseTargetUrl } from "./engine/net/target-url.ts";
import { safeExternalUrl } from "./links.ts";

/**
 * Whether a company may be queued for research. The website must at least LOOK valid, because a
 * run's history is permanent: a run that fails only because the website value is junk would stay
 * in the company's history forever.
 *
 * Uses the project's own conventions, with no DNS lookup and no network request:
 *  - `safeExternalUrl` (the dashboard's link rule: http(s), a dotted public-looking host, no
 *    credentials), then
 *  - `parseTargetUrl` (the Phase 3A fetcher's own URL policy: standard ports, no IP literals,
 *    no reserved or internal names).
 *
 * Server-side only: `parseTargetUrl` pulls in Node's `net` module, so client components must
 * receive the result as a prop and never import this file.
 */

export type Eligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason: "suppressed" | "no_website" | "invalid_website" | "not_company_website";
      message: string;
    };

export const NEEDS_WEBSITE_MESSAGE =
  "This company has no website. Research needs a valid website address, such as example.com.";

export const INVALID_WEBSITE_MESSAGE =
  "This company's website value doesn't look like a valid public website address. Research needs an address such as example.com (not an email address, IP address or internal host).";

export const NOT_COMPANY_WEBSITE_MESSAGE =
  "This website value looks like a social media, review, search or map page, not the company's own website. Research only reads a company's own website, so replace it with the company's own web address, such as example.com.";

export const SUPPRESSED_MESSAGE = "Suppressed companies can't be researched.";

export function researchEligibility(lead: {
  website: string | null | undefined;
  suppressed: boolean;
}): Eligibility {
  if (lead.suppressed) {
    return { eligible: false, reason: "suppressed", message: SUPPRESSED_MESSAGE };
  }
  if (!lead.website?.trim()) {
    return { eligible: false, reason: "no_website", message: NEEDS_WEBSITE_MESSAGE };
  }

  const href = safeExternalUrl(lead.website);
  if (href) {
    let target: URL | undefined;
    try {
      target = parseTargetUrl(href); // throws ResearchFetchError for anything the fetcher would refuse
    } catch {
      // fall through
    }
    if (target) {
      if (nonCompanySite(target)) {
        return {
          eligible: false,
          reason: "not_company_website",
          message: NOT_COMPANY_WEBSITE_MESSAGE,
        };
      }
      return { eligible: true };
    }
  }
  return { eligible: false, reason: "invalid_website", message: INVALID_WEBSITE_MESSAGE };
}
