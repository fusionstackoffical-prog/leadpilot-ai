import type { Metadata } from "next";
import { ImportHistory } from "@/features/imports/components/import-history";
import { ImportWizard } from "@/features/imports/components/import-wizard";
import { listImports } from "@/features/imports/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Excel Imports" };

export default async function ImportsPage({ searchParams }: PageProps<"/imports">) {
  const { workspace } = await requireWorkspaceContext();
  const page = Math.max(1, Number.parseInt(String((await searchParams).page ?? "1"), 10) || 1);
  const { imports, total } = await listImports(workspace.id, page);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <ImportWizard workspaceId={workspace.id} />
      <ImportHistory imports={imports} total={total} page={page} timezone={workspace.timezone} />
    </div>
  );
}
