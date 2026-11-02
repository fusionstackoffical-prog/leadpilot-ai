import type { Metadata } from "next";
import { ResearchList } from "@/features/research/components/research-list";
import { listResearchCompanies } from "@/features/research/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Company Research" };

export default async function ResearchPage({ searchParams }: PageProps<"/research">) {
  const { workspace } = await requireWorkspaceContext();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const result = await listResearchCompanies(workspace.id, { q, page });

  return <ResearchList {...result} q={q} page={page} />;
}
