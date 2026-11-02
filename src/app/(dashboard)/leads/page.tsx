import type { Metadata } from "next";
import { LeadTable } from "@/features/leads/components/lead-table";
import { listLeads } from "@/features/leads/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Lead Database" };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const { workspace } = await requireWorkspaceContext();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const result = await listLeads(workspace.id, { q, page });

  return <LeadTable {...result} q={q} page={page} timezone={workspace.timezone} />;
}
