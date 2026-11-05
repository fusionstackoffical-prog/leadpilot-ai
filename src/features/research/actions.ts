"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveWorkspace, getSessionUser } from "@/features/workspace/queries";
import { createClient } from "@/lib/supabase/server";
import {
  cancelResearchCore,
  createResearchGateway,
  requestResearchCore,
  type ResearchActionDeps,
  type ResearchActionState,
} from "./actions-core.ts";
import { getResearchSetup } from "./setup.ts";

/**
 * Thin Server Action wrappers. All rules live in actions-core.ts. Everything runs as the
 * signed-in user (the request-scoped Supabase client); the service-role client is never used here.
 */
async function dependencies(): Promise<ResearchActionDeps> {
  return {
    getUser: getSessionUser,
    getWorkspace: getActiveWorkspace,
    getSetup: getResearchSetup,
    gateway: createResearchGateway(await createClient()),
    revalidate: (path) => revalidatePath(path),
  };
}

export async function requestResearch(
  _previous: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const state = await requestResearchCore(formData, await dependencies());
  if (state.status === "unauthenticated") redirect("/login");
  return state;
}

export async function cancelResearch(
  _previous: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const state = await cancelResearchCore(formData, await dependencies());
  if (state.status === "unauthenticated") redirect("/login");
  return state;
}
