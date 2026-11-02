import type { Enums } from "@/types/database";

export type WorkspaceRole = Enums<"workspace_role">;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  timezone: string;
  role: WorkspaceRole;
};
