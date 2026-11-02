"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getSessionUser } from "./queries";

// Submitted values are echoed back so fields survive React's automatic form reset.
export type CreateWorkspaceState = {
  status: "idle" | "error";
  message?: string;
  name?: string;
  timezone?: string;
};

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(80, "Use 80 characters or fewer."),
  timezone: z.string().min(1).max(64),
});

export async function createWorkspace(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (await getActiveWorkspace()) redirect("/");

  const submitted = {
    name: String(formData.get("name") ?? "").slice(0, 80),
    timezone: String(formData.get("timezone") ?? "").slice(0, 64),
  };
  const parsed = createWorkspaceSchema.safeParse(submitted);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message, ...submitted };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_workspace", {
    workspace_name: parsed.data.name,
    workspace_timezone: parsed.data.timezone,
  });

  if (error) {
    return {
      status: "error",
      ...submitted,
      message:
        error.code === "22023"
          ? "That timezone isn't recognized."
          : "Could not create the workspace. Check that the database migrations have been applied.",
    };
  }

  redirect("/");
}
