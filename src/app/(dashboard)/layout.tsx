import { AppShell } from "@/components/layout/app-shell";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const { user, workspace } = await requireWorkspaceContext();

  // Nav badges (pending approvals, follow-ups due) are wired in Phase 3 when those tables exist.
  return (
    <AppShell user={user} workspace={workspace}>
      {children}
    </AppShell>
  );
}
