/**
 * Import workflow against Supabase, always as the signed-in user (RLS applies;
 * no service-role key). The client is injected so the same code runs in the
 * browser and in integration tests.
 *
 * Retry safety relies on migration 005:
 *  - excel_imports  unique (workspace_id, idempotency_key)  -> createImport is idempotent
 *  - excel_import_sheets unique (import_id, sheet_index)    -> saveSheets is idempotent
 *  - import_rows unique (sheet_id, row_number)              -> stageRows can be re-run
 *  - complete_excel_import() returns a finished import unchanged
 * Counters and duplicate flags are computed only by the database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { buildImportStoragePath, type ImportFileType } from "./file-rules.ts";
import { randomId } from "./hashing.ts";
import type { StagedRow } from "./validate.ts";

type Client = SupabaseClient<Database>;
export type ImportRecord = Tables<"excel_imports">;
export type ImportStatus = ImportRecord["status"];

export const IMPORTS_BUCKET = "imports";
export const STAGE_BATCH_SIZE = 500;

export class ImportError extends Error {
  readonly step: string;

  constructor(message: string, step: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ImportError";
    this.step = step;
  }
}

const fail = (step: string, message: string, cause?: unknown): never => {
  throw new ImportError(message, step, cause);
};

export { sha256Hex } from "./hashing.ts";

/** Create the import record, or return the existing one for the same idempotency key. */
export async function createImport(
  supabase: Client,
  input: {
    workspaceId: string;
    idempotencyKey: string;
    fileName: string;
    fileType: ImportFileType;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  },
): Promise<ImportRecord> {
  const id = randomId();
  const { error } = await supabase.from("excel_imports").upsert(
    {
      id,
      workspace_id: input.workspaceId,
      idempotency_key: input.idempotencyKey,
      file_name: input.fileName.slice(0, 255),
      file_type: input.fileType,
      mime_type: input.contentType,
      file_size_bytes: input.sizeBytes,
      file_sha256: input.sha256,
      storage_path: buildImportStoragePath(input.workspaceId, id, input.fileName),
    },
    { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
  );
  if (error) fail("create", "Couldn't create the import record.", error);

  const { data, error: readError } = await supabase
    .from("excel_imports")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("idempotency_key", input.idempotencyKey)
    .single();
  if (readError || !data) return fail("create", "Couldn't load the import record.", readError);
  return data;
}

/** Upload the original file. A retry after a successful upload is treated as success. */
export async function uploadImportFile(
  supabase: Client,
  record: ImportRecord,
  file: Blob,
  contentType: string,
) {
  if (!record.storage_path) fail("upload", "This import has no storage path.");
  const { error } = await supabase.storage
    .from(IMPORTS_BUCKET)
    // supabase-js sends a Blob's own type and ignores `contentType`; browsers often
    // report spreadsheets as "" or application/octet-stream, which the bucket
    // rejects. Re-wrap with the validated type.
    .upload(record.storage_path!, new Blob([file], { type: contentType }), {
      contentType,
      upsert: false,
      cacheControl: "0",
    });
  if (!error) return;
  const status = String((error as { statusCode?: string | number }).statusCode ?? "");
  if (status === "409" || /already exists|duplicate/i.test(error.message)) return;
  if (status === "413" || /too large|maximum allowed size/i.test(error.message)) {
    fail("upload", "The file is larger than the 25 MiB limit.", error);
  }
  if (status === "415" || /mime/i.test(error.message))
    fail("upload", "This file type isn't allowed.", error);
  fail("upload", "The file upload failed. Check your connection and try again.", error);
}

/**
 * Move an import to `to` if it is in one of `from`. Idempotent: if it is already
 * in `to` the current row is returned.
 */
export async function setStatus(
  supabase: Client,
  importId: string,
  from: ImportStatus[],
  to: ImportStatus,
  extra: { error_summary?: string | null } = {},
): Promise<ImportRecord> {
  const { data, error } = await supabase
    .from("excel_imports")
    .update({ status: to, ...extra })
    .eq("id", importId)
    .in("status", from)
    .select("*")
    .maybeSingle();
  if (error) return fail("status", `Couldn't update the import status to "${to}".`, error);
  if (data) return data;
  const current = await getImport(supabase, importId);
  if (current.status === to) return current;
  return fail("status", `The import is "${current.status}" and can't move to "${to}".`);
}

export async function getImport(supabase: Client, importId: string): Promise<ImportRecord> {
  const { data, error } = await supabase
    .from("excel_imports")
    .select("*")
    .eq("id", importId)
    .maybeSingle();
  if (error || !data) return fail("load", "Import not found.", error);
  return data;
}

export type SheetInput = {
  index: number;
  name: string;
  headerRowNumber: number | null;
  headers: string[];
};

/** Record every worksheet found (worksheet_count is computed from these). Returns index → sheet id. */
export async function saveSheets(
  supabase: Client,
  record: ImportRecord,
  sheets: SheetInput[],
): Promise<Map<number, string>> {
  const { error } = await supabase.from("excel_import_sheets").upsert(
    sheets.map((sheet) => ({
      workspace_id: record.workspace_id,
      import_id: record.id,
      sheet_index: sheet.index,
      sheet_name: sheet.name.slice(0, 255) || `Sheet ${sheet.index + 1}`,
      header_row_number: sheet.headerRowNumber ?? 1,
      column_headers: sheet.headers,
      selected: false,
    })),
    { onConflict: "import_id,sheet_index", ignoreDuplicates: true },
  );
  if (error) fail("sheets", "Couldn't save the worksheet list.", error);
  const { data, error: readError } = await supabase
    .from("excel_import_sheets")
    .select("id, sheet_index")
    .eq("import_id", record.id);
  if (readError || !data) return fail("sheets", "Couldn't load the worksheet list.", readError);
  return new Map(data.map((row) => [row.sheet_index, row.id]));
}

/** Exactly one worksheet is imported: mark it selected and the others not. */
export async function selectSheet(supabase: Client, importId: string, sheetIndex: number) {
  const off = await supabase
    .from("excel_import_sheets")
    .update({ selected: false })
    .eq("import_id", importId)
    .neq("sheet_index", sheetIndex);
  if (off.error) fail("sheets", "Couldn't update the selected worksheet.", off.error);
  const on = await supabase
    .from("excel_import_sheets")
    .update({ selected: true })
    .eq("import_id", importId)
    .eq("sheet_index", sheetIndex);
  if (on.error) fail("sheets", "Couldn't update the selected worksheet.", on.error);
}

export async function saveMapping(
  supabase: Client,
  importId: string,
  mapping: { sheetIndex: number; headerRowNumber: number | null; columns: Record<string, string> },
) {
  const { error } = await supabase
    .from("excel_imports")
    .update({ column_mapping: mapping })
    .eq("id", importId);
  if (error) fail("mapping", "Couldn't save the column mapping.", error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Insert rows in batches (a few in parallel). Rows already stored (same sheet +
 * row number) are skipped, so a retry after a partial failure only adds what's
 * missing. Each batch is retried with backoff; afterwards the stored count is
 * verified, so success is never reported for rows that weren't saved.
 */
export async function stageRows(
  supabase: Client,
  target: { workspaceId: string; importId: string; sheetId: string },
  rows: StagedRow[],
  options: {
    batchSize?: number;
    attempts?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
) {
  const batchSize = options.batchSize ?? STAGE_BATCH_SIZE;
  const attempts = options.attempts ?? 3;
  const starts = Array.from(
    { length: Math.ceil(rows.length / batchSize) },
    (_, i) => i * batchSize,
  );
  let next = 0;
  let done = 0;
  let failure: { start: number; error: unknown } | null = null;

  async function sendBatch(start: number) {
    const batch = rows.slice(start, start + batchSize).map((row) => ({
      workspace_id: target.workspaceId,
      import_id: target.importId,
      sheet_id: target.sheetId,
      row_number: row.rowNumber,
      raw_data: row.raw,
      mapped_data: row.mapped,
      status: row.status,
      issues: row.issues,
    }));
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const { error } = await supabase
        .from("import_rows")
        .upsert(batch, { onConflict: "sheet_id,row_number", ignoreDuplicates: true });
      if (!error) {
        done += batch.length;
        options.onProgress?.(done, rows.length);
        return;
      }
      // Permission and constraint errors won't fix themselves.
      if (
        ["42501", "23514", "23503", "22023", "P0001"].includes(error.code ?? "") ||
        attempt === attempts
      ) {
        failure ??= { start, error };
        return;
      }
      await sleep(300 * 2 ** (attempt - 1));
    }
  }

  const lanes = Math.max(1, Math.min(options.concurrency ?? 3, starts.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (!failure && next < starts.length) await sendBatch(starts[next++]);
    }),
  );
  if (failure) {
    const { start, error } = failure;
    fail(
      "stage",
      `Saving rows failed at row ${rows[start]?.rowNumber ?? "?"}. Already-saved rows are kept; retry to continue.`,
      error,
    );
  }

  const { count, error } = await supabase
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("sheet_id", target.sheetId);
  if (error) fail("stage", "Couldn't verify the saved rows.", error);
  if (count !== rows.length) {
    fail("stage", `Expected ${rows.length} saved rows but found ${count ?? 0}. Retry to continue.`);
  }
}

/** Database-side duplicate detection and counters. */
export async function refreshImport(supabase: Client, importId: string): Promise<ImportRecord> {
  const { data, error } = await supabase.rpc("refresh_excel_import", { p_import_id: importId });
  if (error || !data) return fail("check", "Duplicate checking failed. Try again.", error);
  return data as ImportRecord;
}

/** Commit: parsed -> importing -> completed / completed_with_errors. Safe to repeat. */
export async function completeImport(supabase: Client, importId: string): Promise<ImportRecord> {
  const current = await getImport(supabase, importId);
  if (current.status === "completed" || current.status === "completed_with_errors") return current;
  if (current.status === "failed")
    await setStatus(supabase, importId, ["failed"], "parsed", { error_summary: null });
  await setStatus(supabase, importId, ["parsed"], "importing");
  const { data, error } = await supabase.rpc("complete_excel_import", { p_import_id: importId });
  if (error || !data) {
    await markFailed(supabase, importId, "Completing the import failed.").catch(() => undefined);
    return fail("complete", "Completing the import failed. You can retry it.", error);
  }
  // With the lead database (migration 008) a trigger creates/links leads after the
  // status change and updates new_records; re-read so the caller sees final counts.
  return getImport(supabase, importId).catch(() => data as ImportRecord);
}

export async function markFailed(supabase: Client, importId: string, message: string) {
  return setStatus(supabase, importId, ["uploading", "uploaded", "parsed", "importing"], "failed", {
    error_summary: message.slice(0, 2000),
  });
}

export async function cancelImport(supabase: Client, importId: string) {
  return setStatus(supabase, importId, ["uploading", "uploaded", "parsed", "failed"], "cancelled");
}

/** Delete the stored file first (the database refuses otherwise), then the record. */
export async function deleteImport(
  supabase: Client,
  record: Pick<ImportRecord, "id" | "storage_path">,
) {
  if (record.storage_path) {
    const { error } = await supabase.storage.from(IMPORTS_BUCKET).remove([record.storage_path]);
    if (error) fail("delete", "Couldn't delete the uploaded file.", error);
  }
  const { data, error } = await supabase
    .from("excel_imports")
    .delete()
    .eq("id", record.id)
    .select("id");
  if (error) fail("delete", "Couldn't delete the import.", error);
  if (!data?.length)
    fail("delete", "You don't have permission to delete this import, or it is still importing.");
}

/** Rows a finished import accepted: valid and not duplicates or failures. */
export function acceptedRows(
  record: Pick<ImportRecord, "rows_read" | "invalid_rows" | "duplicate_rows" | "failed_rows">,
) {
  return Math.max(
    0,
    record.rows_read - record.invalid_rows - record.duplicate_rows - record.failed_rows,
  );
}

export function canDeleteImport(
  record: Pick<ImportRecord, "created_by" | "status">,
  user: { id: string; role: string },
) {
  return (
    record.status !== "importing" &&
    (record.created_by === user.id || user.role === "owner" || user.role === "admin")
  );
}
