import { reportOnce, type WorkerLogger } from "./log.ts";
import { WORKER_DEFAULTS, type ResearchWorkerRepository } from "./types.ts";

export type MaintenanceResult = {
  /** Source texts deleted from storage and marked purged. */
  purged: number;
  /** Unreferenced uploads removed (from failed, cancelled or superseded attempts). */
  orphansRemoved: number;
  /** Maintenance steps that failed; they are retried on the next call. */
  errors: number;
};

/**
 * Housekeeping that uses only the migration 009 functions, so the database decides what is
 * eligible; the worker never picks objects itself:
 *  - Text of a run superseded by a newer successful run more than 90 days ago is deleted from
 *    storage first, then marked purged (an interrupted purge is simply repeated).
 *  - Uploads that no source row references and that can no longer become referenced are removed.
 *
 * Never throws: housekeeping must not affect research.
 */
export async function runMaintenance(
  repo: ResearchWorkerRepository,
  limit: number = WORKER_DEFAULTS.maintenanceLimit,
  log?: WorkerLogger,
): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { purged: 0, orphansRemoved: 0, errors: 0 };

  try {
    const due = await repo.listPurgeCandidates(limit);
    if (due.length > 0) {
      await repo.removeSources(due.map((d) => d.storagePath));
      result.purged = await repo.markPurged(due.map((d) => d.sourceId));
    }
  } catch (error) {
    result.errors++;
    reportOnce(log, "maintenance_purge_failed", error);
  }

  try {
    const orphans = await repo.listOrphanPaths(limit);
    if (orphans.length > 0) {
      await repo.removeSources(orphans);
      result.orphansRemoved = orphans.length;
    }
  } catch (error) {
    result.errors++;
    reportOnce(log, "maintenance_orphan_sweep_failed", error);
  }

  return result;
}
