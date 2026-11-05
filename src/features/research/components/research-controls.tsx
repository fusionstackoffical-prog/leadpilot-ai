"use client";

import { Loader2, Microscope, Settings2, XCircle } from "lucide-react";
import { useActionState, useCallback, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cancelResearch, requestResearch } from "../actions";
import type { ResearchActionState } from "../actions-core";
import type { CompanyStatus } from "../status";

export type ResearchControlsProps = {
  leadId: string;
  /** Idempotency key, generated per page render on the server. */
  requestKey: string;
  status: CompanyStatus;
  /** Results from an earlier successful run exist. */
  hasResult: boolean;
  /** A run is queued or running. */
  active: boolean;
  /** The active run, when the signed-in user may cancel it. */
  cancellableRunId: string | null;
  /** What research still needs on the server, or null when it is set up. Names only, never values. */
  setupMissing: string[] | null;
  /** Why this company can't be researched (suppressed, no or invalid website), or null. */
  ineligibleReason: string | null;
};

const initial: ResearchActionState = { status: "idle" };

/**
 * Research and Cancel buttons for one company. Every rule is enforced again on the server (see
 * actions-core.ts); what is disabled here is only for clarity. This component imports no Node
 * module and no database client: everything it needs arrives as plain props.
 */
export function ResearchControls({
  leadId,
  requestKey,
  status,
  hasResult,
  active,
  cancellableRunId,
  setupMissing,
  ineligibleReason,
}: ResearchControlsProps) {
  const reasonId = useId();
  const [last, setLast] = useState<"request" | "cancel" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Remember which action ran last, so only its message is shown (never a stale one).
  const trackedRequest = useCallback(async (previous: ResearchActionState, formData: FormData) => {
    setLast("request");
    return requestResearch(previous, formData);
  }, []);
  const trackedCancel = useCallback(async (previous: ResearchActionState, formData: FormData) => {
    setLast("cancel");
    return cancelResearch(previous, formData);
  }, []);

  const [request, requestAction, requestPending] = useActionState(trackedRequest, initial);
  const [cancel, cancelAction, cancelPending] = useActionState(trackedCancel, initial);

  const blocked = active || setupMissing !== null || ineligibleReason !== null;
  const label = active
    ? "Research in progress"
    : hasResult || status !== "not_researched"
      ? "Research again"
      : "Research company";

  const shown = last === "request" ? request : last === "cancel" ? cancel : null;
  // A queued/started message is only true while the run is active; errors and cancellations stay.
  const message =
    shown && shown.status !== "idle" && shown.message
      ? shown.status === "error" || last === "cancel" || active
        ? shown
        : null
      : null;

  return (
    <div className="min-w-0 space-y-3" data-testid="research-controls">
      <div className="flex flex-wrap items-center gap-2">
        <form action={requestAction}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="requestKey" value={requestKey} />
          <Button
            type="submit"
            variant="primary"
            disabled={blocked || requestPending}
            aria-describedby={blocked ? reasonId : undefined}
          >
            {requestPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Microscope className="size-4" aria-hidden />
            )}
            {requestPending ? "Queueing…" : label}
          </Button>
        </form>

        {cancellableRunId ? (
          confirming === cancellableRunId ? (
            <form action={cancelAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="runId" value={cancellableRunId} />
              <input type="hidden" name="leadId" value={leadId} />
              <span className="text-xs text-fg-secondary">Cancel this research run?</span>
              <Button type="submit" variant="danger" size="sm" disabled={cancelPending}>
                {cancelPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="size-3.5" aria-hidden />
                )}
                Yes, cancel
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Keep it
              </Button>
            </form>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(cancellableRunId)}>
              <XCircle className="size-4" aria-hidden />
              Cancel research
            </Button>
          )
        ) : null}
      </div>

      {setupMissing ? (
        <div
          id={reasonId}
          role="status"
          className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs break-words text-info"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <Settings2 className="size-3.5" aria-hidden />
            Research isn&apos;t set up on this server yet, so it can&apos;t be started.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {setupMissing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-1.5">
            See docs/SETUP.md, &ldquo;Company research worker&rdquo;. Nothing is queued until all of
            this is configured.
          </p>
        </div>
      ) : ineligibleReason ? (
        <p id={reasonId} role="status" className="text-xs break-words text-warning">
          {ineligibleReason}
        </p>
      ) : active ? (
        <p id={reasonId} className="text-xs text-fg-muted">
          Research is already queued or running for this company.
          {cancellableRunId
            ? ""
            : " Only the person who requested it, or a workspace owner or admin, can cancel it."}
        </p>
      ) : null}

      {message ? (
        <FormMessage tone={message.status === "error" ? "error" : "success"}>
          {message.message}
        </FormMessage>
      ) : null}
    </div>
  );
}
