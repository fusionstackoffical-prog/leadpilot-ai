import { createProductionWorkerHandler } from "@/features/research/worker/production";

// Node.js runtime: the worker uses node:http, node:dns and node:crypto.
export const runtime = "nodejs";
// A batch crawls a few websites politely (per-host delays), so allow it time on platforms that
// enforce a limit. Ignored by `next dev` and `next start`.
export const maxDuration = 300;

const handle = createProductionWorkerHandler();

/**
 * Runs one research batch. POST only (Next.js answers 405 to other methods), protected by the
 * RESEARCH_WORKER_SECRET bearer token inside the handler; the proxy lets exactly this path
 * through its login redirect. Not cached: POST route handlers never are.
 */
export async function POST(request: Request) {
  return handle(request);
}
