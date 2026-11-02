import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CreateWorkspaceForm } from "@/features/workspace/components/create-workspace-form";
import { getActiveWorkspace, getSessionUser } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (await getActiveWorkspace()) redirect("/");

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-fg">Create your workspace</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Leads, campaigns and reports belong to a workspace. You&apos;ll be its owner.
      </p>
      <div className="mt-6">
        <CreateWorkspaceForm />
      </div>
    </Card>
  );
}
