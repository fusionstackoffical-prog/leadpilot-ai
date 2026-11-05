/** The worker endpoint. It is the only route that skips the login redirect (see the proxy). */
export const WORKER_ENDPOINT_PATH = "/api/research/worker";

/**
 * Exact match on purpose: no prefix, no trailing slash, no case folding. Anything else, such as
 * "/api/research/worker/x" or "/api/research/workers", stays behind the normal login redirect.
 */
export function isWorkerEndpoint(pathname: string): boolean {
  return pathname === WORKER_ENDPOINT_PATH;
}
