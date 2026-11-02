import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type ImportListItem = Pick<
  Tables<"excel_imports">,
  | "id"
  | "file_name"
  | "file_type"
  | "file_size_bytes"
  | "status"
  | "created_at"
  | "completed_at"
  | "created_by"
  | "worksheet_count"
  | "rows_read"
  | "invalid_rows"
  | "duplicate_rows"
  | "failed_rows"
  | "storage_path"
  | "duplicate_of_import_id"
>;

const LIST_COLUMNS =
  "id, file_name, file_type, file_size_bytes, status, created_at, completed_at, created_by, worksheet_count, rows_read, invalid_rows, duplicate_rows, failed_rows, storage_path, duplicate_of_import_id";

export const HISTORY_PAGE_SIZE = 20;

/** Import history for the workspace, newest first. RLS limits rows to the caller's workspaces. */
export async function listImports(workspaceId: string, page = 1) {
  const supabase = await createClient();
  const from = (page - 1) * HISTORY_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("excel_imports")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load imports: ${error.message}`);
  return { imports: (data ?? []) as ImportListItem[], total: count ?? 0 };
}

export type ImportRowFilter = "all" | "valid" | "invalid" | "duplicate" | "failed";
export const ROWS_PAGE_SIZE = 50;

export async function getImportDetail(workspaceId: string, importId: string) {
  const supabase = await createClient();
  const { data: record, error } = await supabase
    .from("excel_imports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", importId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the import: ${error.message}`);
  if (!record) return null;

  const [{ data: sheets }, { data: uploader }] = await Promise.all([
    supabase
      .from("excel_import_sheets")
      .select(
        "id, sheet_index, sheet_name, selected, header_row_number, rows_read, duplicate_rows, invalid_rows",
      )
      .eq("import_id", importId)
      .order("sheet_index"),
    record.created_by
      ? supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", record.created_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { record, sheets: sheets ?? [], uploader: uploader ?? null };
}

export async function getImportRows(importId: string, filter: ImportRowFilter, page: number) {
  const supabase = await createClient();
  const from = (page - 1) * ROWS_PAGE_SIZE;
  let query = supabase
    .from("import_rows")
    .select(
      "id, row_number, status, issues, mapped_data, error_message, sheet_id, duplicate_of:duplicate_of_row_id ( row_number, sheet_id )",
      { count: "exact" },
    )
    .eq("import_id", importId);
  // Accepted rows become "imported" once migration 008 turns them into leads.
  if (filter === "valid") query = query.in("status", ["valid", "imported"]);
  else if (filter !== "all") query = query.eq("status", filter);
  const { data, error, count } = await query
    .order("sheet_id")
    .order("row_number")
    .range(from, from + ROWS_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load rows: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0 };
}
