import { verifyWorkerSecret } from "./auth.ts";
import { reportOnce, type WorkerLogger } from "./log.ts";
import type { BatchResult } from "./process-batch.ts";

export type WorkerHandlerDeps = {
  /** The configured secret, or null when it is missing or too short. */
  getSecret: () => string | null;
  runBatch: () => Promise<BatchResult>;
  /**
   * Receives a fixed message when a batch fails unexpectedly (see log.ts). Rejected requests
   * (wrong secret, wrong method, busy) are never logged, so callers cannot flood the log.
   */
  log?: WorkerLogger;
};

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/**
 * The worker's HTTP behaviour, free of any framework so it can be tested with plain Requests.
 *
 * Responses never contain secrets, error text, company data or run identifiers: only fixed error
 * names and counts. The request body is never read. Only one batch runs at a time per process.
 */
export function createWorkerHandler(deps: WorkerHandlerDeps) {
  let running = false;

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    }

    const secret = deps.getSecret();
    if (!secret) return json({ error: "worker_not_configured" }, 503);
    if (!verifyWorkerSecret(request.headers.get("authorization"), secret)) {
      return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    if (running) return json({ error: "worker_busy" }, 409);
    running = true;
    try {
      const result = await deps.runBatch();
      if (result.status === "not_configured") {
        return json({ error: "research_not_configured" }, 503);
      }
      const o = result.outcomes;
      return json(
        {
          status: "ok",
          claimed: result.claimed,
          completed: o.completed + o.completed_with_warnings,
          cancelled: o.cancelled,
          retry_scheduled: o.retry_scheduled,
          failed: o.failed,
          lease_lost: o.lease_lost,
          unresolved: o.unresolved,
          errors: o.error,
          maintenance: {
            purged: result.maintenance.purged,
            orphans_removed: result.maintenance.orphansRemoved,
            errors: result.maintenance.errors,
          },
        },
        200,
      );
    } catch (error) {
      // Only a fixed message is logged; the HTTP response stays generic.
      reportOnce(deps.log, "batch_failed", error);
      return json({ error: "worker_error" }, 500);
    } finally {
      running = false;
    }
  };
}
