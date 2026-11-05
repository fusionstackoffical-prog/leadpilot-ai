import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadResearchFetchConfig, ResearchConfigError } from "../engine/config.ts";
import { createResearchFetcher } from "../engine/net/fetcher.ts";
import { systemClock } from "../engine/net/host-limiter.ts";
import { systemResolver } from "../engine/net/resolve.ts";
import { nodeTransport } from "../engine/net/transport.ts";
import { loadWorkerSecret } from "./auth.ts";
import { createWorkerHandler } from "./handler.ts";
import { consoleLogger } from "./log.ts";
import { runResearchBatch } from "./process-batch.ts";
import { createSupabaseRepository } from "./supabase-repository.ts";

/**
 * The only place the service-role key is used for research. server-only keeps this module (and
 * therefore the key) out of any client bundle.
 *
 * Wires the real dependencies into the dependency-injected worker: system DNS, Node's http/https
 * transport, the real clock and the service-role Supabase client.
 */
export function createProductionWorkerHandler() {
  return createWorkerHandler({
    getSecret: () => loadWorkerSecret(),
    log: consoleLogger,
    runBatch: () =>
      runResearchBatch({
        log: consoleLogger,
        loadConfig: () => loadResearchFetchConfig(),
        createFetcher: (config) =>
          createResearchFetcher({
            config,
            resolver: systemResolver,
            transport: nodeTransport,
            clock: systemClock,
          }),
        createRepository: () => {
          try {
            return createSupabaseRepository(createAdminClient());
          } catch {
            // Missing/invalid Supabase variables: a configuration problem, reported generically.
            throw new ResearchConfigError("Server-side Supabase credentials are not configured.");
          }
        },
        newWorkerId: () => `worker-${randomUUID()}`,
      }),
  });
}
