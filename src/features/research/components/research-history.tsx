import { History } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/features/imports/status";
import { HISTORY_LIMIT } from "../columns";
import type { RunView } from "../results-queries";
import { describeRun } from "../status";
import { RunStatusBadge } from "./status-badge";

function requester(run: RunView) {
  if (run.triggerSource === "scheduled") return "Scheduled";
  // Never an id or an email: only whether it was the signed-in user.
  return run.requestedByYou ? "You" : "Another member";
}

/**
 * Every research run for a company, newest first. Each run is a dated snapshot; picking one shows
 * the results it saved. Failure reasons are the readable text the worker stored, shown as plain
 * text.
 */
export function ResearchHistory({
  runs,
  selectedRunId,
  leadId,
  timezone,
}: {
  runs: RunView[];
  selectedRunId: string | null;
  leadId: string;
  timezone: string;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No research runs yet"
        description="Every research run is kept as a dated snapshot. Earlier results are never overwritten."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[820px] text-left text-xs" data-testid="history-table">
          <thead className="bg-elevated text-fg-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Requested</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Pages</th>
              <th className="px-3 py-2 font-medium">Findings</th>
              <th className="px-3 py-2 font-medium">Warnings</th>
              <th className="px-3 py-2 font-medium">By</th>
              <th className="px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 font-medium">Results</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const info = describeRun({
                status: run.status,
                attempts: run.attempts,
                max_attempts: run.maxAttempts,
                error_code: run.errorCode,
              });
              const selected = run.id === selectedRunId;
              return (
                <tr
                  key={run.id}
                  className={`border-t border-line align-top ${selected ? "bg-elevated/60" : ""}`}
                  aria-current={selected ? "true" : undefined}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                    {formatDateTime(run.queuedAt, timezone)}
                    {run.finishedAt ? (
                      <span className="block text-[11px] text-fg-muted">
                        finished {formatDateTime(run.finishedAt, timezone)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td className="tabular px-3 py-2 text-fg-secondary">{run.pagesFetched}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                    {run.factsCount} confirmed
                    <span className="block text-[11px] text-fg-muted">
                      {run.candidatesCount} unconfirmed
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-fg-secondary">{run.warningCount}</td>
                  <td className="px-3 py-2 text-fg-secondary">{requester(run)}</td>
                  <td className="max-w-80 px-3 py-2 text-fg-secondary">
                    {info.detail ? <p>{info.detail}</p> : null}
                    {run.status === "failed" && run.errorMessage ? (
                      <p className="mt-0.5 break-words text-danger">{run.errorMessage}</p>
                    ) : null}
                    {info.retry ? (
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        Retry{" "}
                        {info.retry.automatic
                          ? "scheduled"
                          : info.retry.permitted
                            ? "permitted"
                            : "not permitted"}
                        : {info.retry.text}
                      </p>
                    ) : null}
                    {run.status === "queued" && run.attempts > 0 && run.nextAttemptAt ? (
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        Next attempt after {formatDateTime(run.nextAttemptAt, timezone)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {selected ? (
                      <span className="text-fg-muted">Shown above</span>
                    ) : (
                      <Link
                        href={`/research/${leadId}?run=${run.id}`}
                        className="text-accent hover:underline"
                      >
                        View results
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {runs.length >= HISTORY_LIMIT ? (
        <p className="text-[11px] text-fg-muted">Showing the {HISTORY_LIMIT} most recent runs.</p>
      ) : null}
    </div>
  );
}
