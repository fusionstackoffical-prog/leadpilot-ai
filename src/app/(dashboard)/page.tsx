import type { Metadata } from "next";
import { OverviewView } from "@/features/overview/components/overview-view";
import { getOverviewData } from "@/features/overview/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";
import { parseDateRange } from "@/lib/metrics/definitions";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { workspace } = await requireWorkspaceContext();
  const range = parseDateRange((await searchParams).range);
  const data = await getOverviewData(workspace, range);

  return <OverviewView data={data} workspace={workspace} />;
}
