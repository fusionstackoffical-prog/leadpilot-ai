/**
 * Research fetch settings. The bot's contact URL is required and is never defaulted: every
 * request identifies LeadPilot and tells site owners where to learn about the bot.
 */

export const BOT_TOKEN = "LeadPilotResearchBot";
export const BOT_VERSION = "1.0";

export type ResearchFetchConfig = {
  contactUrl: string;
  userAgent: string;
  timeoutMs: number;
  connectTimeoutMs: number;
  maxPageBytes: number;
  maxRedirects: number;
  minHostIntervalMs: number;
  maxCrawlDelayMs: number;
};

export const DEFAULT_FETCH_LIMITS = {
  timeoutMs: 15_000,
  connectTimeoutMs: 5_000,
  maxPageBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  minHostIntervalMs: 2_000,
  maxCrawlDelayMs: 10_000,
} as const;

export class ResearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConfigError";
  }
}

/**
 * Reads the server-side configuration. Throws ResearchConfigError when
 * RESEARCH_BOT_CONTACT_URL is missing or is not a public https URL, so the worker refuses to
 * fetch anything until it is set in .env.local (see .env.example).
 */
export function loadResearchFetchConfig(
  env: Record<string, string | undefined> = process.env,
): ResearchFetchConfig {
  const raw = env.RESEARCH_BOT_CONTACT_URL?.trim();
  if (!raw) {
    throw new ResearchConfigError(
      "RESEARCH_BOT_CONTACT_URL is not set. Add a public https page about LeadPilot's research bot to .env.local before running the research worker.",
    );
  }
  // Checked on the raw value: the URL parser would silently encode a space as %20.
  if (/[()\s]/.test(raw)) {
    throw new ResearchConfigError(
      "RESEARCH_BOT_CONTACT_URL must not contain spaces or parentheses.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ResearchConfigError("RESEARCH_BOT_CONTACT_URL is not a valid URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/\.[a-z]{2,}$/i.test(url.hostname)
  ) {
    throw new ResearchConfigError("RESEARCH_BOT_CONTACT_URL must be a public https URL.");
  }
  return {
    contactUrl: url.href,
    userAgent: `${BOT_TOKEN}/${BOT_VERSION} (+${url.href})`,
    ...DEFAULT_FETCH_LIMITS,
  };
}
