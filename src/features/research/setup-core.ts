import { loadResearchFetchConfig } from "./engine/config.ts";
import { loadWorkerSecret } from "./worker/auth.ts";

/**
 * Is research set up on the server? Answers yes/no plus the NAMES of what is missing. Values are
 * never read into the result: an environment value, secret or key can't leak through this type.
 *
 * Research needs all three: the crawler contact page (sent in the bot's User-Agent), the worker
 * secret (protects the endpoint that runs research) and the server-side database key (used by
 * the worker only). See docs/SETUP.md, "Company research worker".
 */
export type ResearchSetup = { ready: true } | { ready: false; missing: string[] };

export const SETUP_LABELS = {
  contactUrl: "Crawler contact page (RESEARCH_BOT_CONTACT_URL)",
  workerSecret: "Research worker secret (RESEARCH_WORKER_SECRET)",
  serviceKey: "Server-side database key (SUPABASE_SERVICE_ROLE_KEY)",
} as const;

/** Minimum length of the service-role key, matching src/lib/env/server.ts. */
const SERVICE_KEY_MIN_LENGTH = 20;

export function evaluateResearchSetup(env: Record<string, string | undefined>): ResearchSetup {
  const missing: string[] = [];

  try {
    loadResearchFetchConfig(env); // throws unless it is a valid public https URL
  } catch {
    missing.push(SETUP_LABELS.contactUrl);
  }
  if (loadWorkerSecret(env) === null) missing.push(SETUP_LABELS.workerSecret);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < SERVICE_KEY_MIN_LENGTH) missing.push(SETUP_LABELS.serviceKey);

  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}
