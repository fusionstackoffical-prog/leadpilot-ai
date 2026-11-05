import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, Database } from "../../../types/database.ts";
import { STORAGE_BUCKET } from "../engine/extract/payload.ts";
import {
  RepositoryError,
  type ClaimedRun,
  type CompletionStatus,
  type FailureStatus,
  type ResearchWorkerRepository,
  type RunStatus,
} from "./types.ts";

/**
 * Adapter between the worker and Supabase: the migration 009 worker functions, the leads and
 * workspace_members tables, and the private research-sources bucket. It must be given the
 * SERVICE-ROLE client (see production.ts); every worker function is executable by that role only.
 *
 * Errors are translated to RepositoryError with fixed messages. Database and storage error text
 * (which can contain table names, values or hints) never leaves this file.
 */

const RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

/** Maps a PostgREST/Postgres error to a RepositoryError by SQLSTATE only. */
export function databaseError(error: { code?: string | null }): RepositoryError {
  const code = error.code ?? "";
  if (code === "55000") {
    return new RepositoryError("lease_lost", "The run is not held by this worker.");
  }
  if (code === "P0002") {
    return new RepositoryError("not_found", "The research run was not found.");
  }
  // Data exceptions (class 22), integrity violations (class 23) and "limit exceeded" (54000)
  // mean the results themselves were rejected; repeating the call cannot succeed.
  if (code === "54000" || code.startsWith("22") || code.startsWith("23")) {
    return new RepositoryError("invalid_result", "The database rejected the research results.");
  }
  return new RepositoryError("transient", "The database request failed.");
}

/** Maps a Storage error to a RepositoryError: a refused object is permanent, the rest retries. */
export function storageError(error: {
  status?: number | string;
  statusCode?: number | string;
}): RepositoryError {
  const status = Number(error.status ?? error.statusCode);
  if ([400, 413, 415, 422].includes(status)) {
    return new RepositoryError("storage_rejected", "Storage refused the object.");
  }
  return new RepositoryError("storage_transient", "Storage request failed.");
}

/** Turns a thrown error (network failure, unexpected exception) into a transient error. */
async function guarded<T>(call: PromiseLike<T>, make: () => RepositoryError): Promise<T> {
  try {
    return await call;
  } catch {
    throw make();
  }
}

const dbUnavailable = () => new RepositoryError("transient", "The database request failed.");
const storageUnavailable = () =>
  new RepositoryError("storage_transient", "Storage request failed.");

export function createSupabaseRepository(
  client: SupabaseClient<Database>,
): ResearchWorkerRepository {
  const bucket = () => client.storage.from(STORAGE_BUCKET);

  return {
    async claimRuns(workerId, limit, leaseSeconds) {
      const { data, error } = await guarded(
        client.rpc("worker_claim_research_runs", {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return (data ?? []).map((row): ClaimedRun => ({
        id: row.id,
        workspaceId: row.workspace_id,
        leadId: row.lead_id,
        requestedBy: row.requested_by,
        // An unknown value is treated as a person-requested run (the stricter rule).
        triggerSource:
          row.trigger_source === "scheduled" || row.trigger_source === "bulk"
            ? row.trigger_source
            : "manual",
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        cancelRequested: row.cancel_requested_at !== null,
      }));
    },

    async heartbeat(runId, workerId, leaseSeconds) {
      const { data, error } = await guarded(
        client.rpc("worker_heartbeat_research_run", {
          p_run_id: runId,
          p_worker_id: workerId,
          p_lease_seconds: leaseSeconds,
        }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return data === true;
    },

    async completeRun(runId, workerId, payload) {
      const { data, error } = await guarded(
        client.rpc("worker_complete_research_run", {
          p_run_id: runId,
          p_worker_id: workerId,
          p_result: payload as unknown as Json,
        }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      if (data !== "completed" && data !== "completed_with_warnings" && data !== "cancelled") {
        throw dbUnavailable(); // unknown answer: the caller re-reads the run to find out
      }
      return data as CompletionStatus;
    },

    async failRun(runId, workerId, failure) {
      const { data, error } = await guarded(
        client.rpc("worker_fail_research_run", {
          p_run_id: runId,
          p_worker_id: workerId,
          p_error_code: failure.code,
          p_error_message: failure.message,
          p_retryable: failure.retryable,
        }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      if (data !== "queued" && data !== "failed" && data !== "cancelled") throw dbUnavailable();
      return data as FailureStatus;
    },

    async getRunSnapshot(run) {
      const { data, error } = await guarded(
        client
          .from("research_runs")
          .select("status, locked_by, cancel_requested_at")
          .eq("workspace_id", run.workspaceId)
          .eq("id", run.id)
          .maybeSingle(),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      if (!data) return null;
      if (!RUN_STATUSES.includes(data.status as RunStatus)) throw dbUnavailable();
      return {
        status: data.status as RunStatus,
        lockedBy: data.locked_by,
        cancelRequested: data.cancel_requested_at !== null,
      };
    },

    async getLead(workspaceId, leadId) {
      const { data, error } = await guarded(
        client
          .from("leads")
          .select("id, workspace_id, company_name, website, suppressed")
          .eq("workspace_id", workspaceId)
          .eq("id", leadId)
          .maybeSingle(),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      if (!data) return null;
      return {
        id: data.id,
        workspaceId: data.workspace_id,
        companyName: data.company_name,
        website: data.website,
        suppressed: data.suppressed,
      };
    },

    async isWorkspaceMember(workspaceId, userId) {
      const { data, error } = await guarded(
        client
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle(),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return data !== null;
    },

    async uploadSource(path, body) {
      const { error } = await guarded(
        bucket().upload(path, body, { contentType: "application/gzip", upsert: true }),
        storageUnavailable,
      );
      if (error) throw storageError(error as { status?: number; statusCode?: string });
    },

    async removeSources(paths) {
      if (paths.length === 0) return;
      const { error } = await guarded(bucket().remove(paths), storageUnavailable);
      if (error) throw storageError(error as { status?: number; statusCode?: string });
    },

    async listPurgeCandidates(limit) {
      const { data, error } = await guarded(
        client.rpc("worker_research_text_due_for_purge", { p_limit: limit }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return (data ?? []).map((row) => ({
        sourceId: row.source_id,
        storagePath: row.storage_path,
      }));
    },

    async markPurged(sourceIds) {
      if (sourceIds.length === 0) return 0;
      const { data, error } = await guarded(
        client.rpc("worker_mark_research_text_purged", { p_source_ids: sourceIds }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return data ?? 0;
    },

    async listOrphanPaths(limit) {
      const { data, error } = await guarded(
        client.rpc("worker_research_orphan_objects", { p_limit: limit }),
        dbUnavailable,
      );
      if (error) throw databaseError(error);
      return (data ?? []).map((row) => row.storage_path);
    },
  };
}
