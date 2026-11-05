import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../../types/database.ts";
import { LEAD_FOR_ACTION_COLUMNS, RUN_FOR_CANCEL_COLUMNS } from "./columns.ts";
import { researchEligibility } from "./eligibility.ts";
import type { ResearchSetup } from "./setup-core.ts";
import {
  describeCancelError,
  describeCancelResult,
  describeRequestError,
  describeRequestOutcome,
  isActiveStatus,
} from "./status.ts";

/**
 * The logic behind the Research and Cancel buttons, with its dependencies injected so every
 * security rule can be tested without a server. `actions.ts` is the thin "use server" wrapper.
 *
 * Rules enforced here, in this order, for every call:
 *  1. The user must be signed in (checked again here; Server Actions are public POST endpoints).
 *  2. The workspace comes from the server's own session, NEVER from the submitted form.
 *  3. Input is validated with Zod.
 *  4. Research must be configured; nothing is queued while it is not.
 *  5. The company must exist in the workspace and be eligible (not suppressed, valid website).
 *  6. Only then are the existing database functions called, as the signed-in user. They enforce
 *     membership, limits, idempotency and who may cancel; this layer never bypasses them.
 *
 * Results are small, plain objects shaped for the UI, never raw database records.
 */

export type ResearchActionState = {
  status: "idle" | "success" | "info" | "error" | "unauthenticated";
  message?: string;
};

export const IDLE_STATE: ResearchActionState = { status: "idle" };

type GatewayResult<T> = { ok: true; value: T } | { ok: false; code: string | null };

/** The only database access an action has. Two reads (RLS-scoped) and the two approved functions. */
export type ResearchGateway = {
  loadLead(
    workspaceId: string,
    leadId: string,
  ): Promise<GatewayResult<{ website: string | null; suppressed: boolean } | null>>;
  /** Calls request_lead_research. The value is the outcome for the requested lead. */
  requestResearch(args: {
    workspaceId: string;
    leadId: string;
    requestKey: string;
  }): Promise<GatewayResult<string | null>>;
  loadRun(
    workspaceId: string,
    runId: string,
  ): Promise<GatewayResult<{ leadId: string; status: string; requestedBy: string | null } | null>>;
  /** Calls cancel_research_run. The value is the function's answer. */
  cancelResearch(runId: string): Promise<GatewayResult<string | null>>;
};

export type ResearchActionDeps = {
  getUser: () => Promise<{ id: string } | null>;
  getWorkspace: () => Promise<{ id: string; role: string } | null>;
  getSetup: () => ResearchSetup;
  gateway: ResearchGateway;
  revalidate: (path: string) => void;
};

type FormLike = { get(name: string): FormDataEntryValue | null };

const requestSchema = z.object({
  leadId: z.uuid(),
  // Per-render key from the profile page; the database appends the lead id to it.
  requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

const cancelSchema = z.object({ runId: z.uuid(), leadId: z.uuid() });

const INVALID_REQUEST = "The request wasn't valid. Reload the page and try again.";

const fail = (message: string): ResearchActionState => ({ status: "error", message });

function pathsFor(leadId: string) {
  return ["/research", `/research/${leadId}`];
}

export async function requestResearchCore(
  form: FormLike,
  deps: ResearchActionDeps,
): Promise<ResearchActionState> {
  const user = await deps.getUser();
  if (!user) return { status: "unauthenticated" };

  const workspace = await deps.getWorkspace();
  if (!workspace) return fail("You need a workspace before you can request research.");

  const parsed = requestSchema.safeParse({
    leadId: form.get("leadId"),
    requestKey: form.get("requestKey"),
  });
  if (!parsed.success) return fail(INVALID_REQUEST);
  const { leadId, requestKey } = parsed.data;

  const setup = deps.getSetup();
  if (!setup.ready) {
    return fail(
      `Research isn't set up on this server yet, so nothing was queued. Missing: ${setup.missing.join("; ")}.`,
    );
  }

  const lead = await deps.gateway.loadLead(workspace.id, leadId);
  if (!lead.ok) return fail("The company couldn't be loaded. Please try again.");
  if (!lead.value) return fail("This company wasn't found in your workspace.");

  const eligibility = researchEligibility(lead.value);
  if (!eligibility.eligible) return fail(eligibility.message);

  const result = await deps.gateway.requestResearch({
    workspaceId: workspace.id,
    leadId,
    requestKey,
  });
  if (!result.ok) {
    const { status, message } = describeRequestError(result.code);
    return { status, message };
  }

  const { status, message } = describeRequestOutcome(result.value);
  if (status !== "error") for (const path of pathsFor(leadId)) deps.revalidate(path);
  return { status, message };
}

export async function cancelResearchCore(
  form: FormLike,
  deps: ResearchActionDeps,
): Promise<ResearchActionState> {
  const user = await deps.getUser();
  if (!user) return { status: "unauthenticated" };

  const workspace = await deps.getWorkspace();
  if (!workspace) return fail("You need a workspace before you can cancel research.");

  const parsed = cancelSchema.safeParse({
    runId: form.get("runId"),
    leadId: form.get("leadId"),
  });
  if (!parsed.success) return fail(INVALID_REQUEST);
  const { runId, leadId } = parsed.data;

  const run = await deps.gateway.loadRun(workspace.id, runId);
  if (!run.ok) return fail("The research run couldn't be loaded. Please try again.");
  if (!run.value) return fail("That research run wasn't found.");
  if (run.value.leadId !== leadId) return fail(INVALID_REQUEST);

  // Already over: nothing to cancel. (Reported without calling the database function.)
  if (!isActiveStatus(run.value.status)) {
    const { status, message } = describeCancelResult(run.value.status);
    for (const path of pathsFor(leadId)) deps.revalidate(path);
    return { status, message };
  }

  // The database function enforces this too; checking first gives the clear message without a call.
  const allowed =
    run.value.requestedBy === user.id || workspace.role === "owner" || workspace.role === "admin";
  if (!allowed) return fail(describeCancelError("42501").message);

  const result = await deps.gateway.cancelResearch(runId);
  if (!result.ok) {
    const { status, message } = describeCancelError(result.code);
    return { status, message };
  }

  const { status, message } = describeCancelResult(result.value);
  if (status !== "error") for (const path of pathsFor(leadId)) deps.revalidate(path);
  return { status, message };
}

/**
 * The gateway over the signed-in user's Supabase client. NEVER pass the service-role client:
 * user-triggered research must run as the user so the database applies their permissions.
 */
export function createResearchGateway(client: SupabaseClient<Database>): ResearchGateway {
  return {
    async loadLead(workspaceId, leadId) {
      try {
        const { data, error } = await client
          .from("leads")
          .select(LEAD_FOR_ACTION_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("id", leadId)
          .maybeSingle();
        if (error) return { ok: false, code: error.code ?? null };
        return {
          ok: true,
          value: data ? { website: data.website, suppressed: data.suppressed } : null,
        };
      } catch {
        return { ok: false, code: null };
      }
    },

    async requestResearch({ workspaceId, leadId, requestKey }) {
      try {
        const { data, error } = await client.rpc("request_lead_research", {
          p_workspace_id: workspaceId,
          p_lead_ids: [leadId],
          p_request_key: requestKey,
        });
        if (error) return { ok: false, code: error.code ?? null };
        const row = (data ?? []).find((r) => r.lead_id === leadId);
        return { ok: true, value: row?.outcome ?? null };
      } catch {
        return { ok: false, code: null };
      }
    },

    async loadRun(workspaceId, runId) {
      try {
        const { data, error } = await client
          .from("research_runs")
          .select(RUN_FOR_CANCEL_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("id", runId)
          .maybeSingle();
        if (error) return { ok: false, code: error.code ?? null };
        return {
          ok: true,
          value: data
            ? { leadId: data.lead_id, status: data.status, requestedBy: data.requested_by }
            : null,
        };
      } catch {
        return { ok: false, code: null };
      }
    },

    async cancelResearch(runId) {
      try {
        const { data, error } = await client.rpc("cancel_research_run", { p_run_id: runId });
        if (error) return { ok: false, code: error.code ?? null };
        return { ok: true, value: data ?? null };
      } catch {
        return { ok: false, code: null };
      }
    },
  };
}
