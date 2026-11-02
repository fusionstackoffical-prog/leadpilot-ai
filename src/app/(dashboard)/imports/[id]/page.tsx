import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImportDetail } from "@/features/imports/components/import-detail";
import { getImportDetail, getImportRows, type ImportRowFilter } from "@/features/imports/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Import details" };

const FILTERS: ImportRowFilter[] = ["all", "valid", "invalid", "duplicate", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ImportDetailPage({
  params,
  searchParams,
}: PageProps<"/imports/[id]">) {
  const { user, workspace } = await requireWorkspaceContext();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const query = await searchParams;
  const filter = FILTERS.find((f) => f === query.status) ?? "all";
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);

  // RLS returns nothing for imports outside the caller's workspace, so this is a 404.
  const detail = await getImportDetail(workspace.id, id);
  if (!detail) notFound();
  const rows = await getImportRows(id, filter, page);

  return (
    <ImportDetail
      detail={detail}
      rows={rows}
      filter={filter}
      page={page}
      user={user}
      workspace={workspace}
    />
  );
}
