import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser, WorkspaceSummary } from "./types";

/** Verified user from the auth server (not just the cookie), or null. Deduped per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    fullName: profile?.full_name ?? null,
  };
});

/**
 * The user's workspace. Phase 0 uses the earliest membership; a workspace switcher
 * can store the active id in a cookie later without changing callers.
 */
export const getActiveWorkspace = cache(async (): Promise<WorkspaceSummary | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces ( id, name, timezone )")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load workspace: ${error.message}`);
  if (!data?.workspaces) return null;

  return {
    id: data.workspaces.id,
    name: data.workspaces.name,
    timezone: data.workspaces.timezone,
    role: data.role,
  };
});

/** Guard for authenticated pages: redirects instead of rendering without context. */
export async function requireWorkspaceContext() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspace = await getActiveWorkspace();
  if (!workspace) redirect("/onboarding");

  return { user, workspace };
}
