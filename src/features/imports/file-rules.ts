/**
 * Upload rules for Excel/CSV imports. Pure functions, safe on client and server.
 * The same limits are enforced by the database (excel_imports CHECKs) and by the
 * private `imports` storage bucket (migration 005); keep the three in sync.
 */

/** 25 MiB — matches storage.buckets.file_size_limit and excel_imports.file_size_bytes. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

export const IMPORT_FILE_TYPES = ["xlsx", "xls", "csv"] as const;
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number];

/** MIME types the bucket accepts. Browsers report CSV inconsistently, hence the extras. */
export const IMPORT_MIME_TYPES: Record<ImportFileType, readonly string[]> = {
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: ["application/vnd.ms-excel"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
};

export type ImportFileCheck =
  { ok: true; fileType: ImportFileType; contentType: string } | { ok: false; error: string };

export function validateImportFile(file: {
  name: string;
  size: number;
  type: string;
}): ImportFileCheck {
  const name = file.name.trim();
  if (!name || name.length > 255) {
    return { ok: false, error: "File name must be 1–255 characters." };
  }
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!(IMPORT_FILE_TYPES as readonly string[]).includes(extension)) {
    return { ok: false, error: "Upload an .xlsx, .xls or .csv file." };
  }
  const fileType = extension as ImportFileType;
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "Files must be 25 MiB or smaller." };
  }
  // An empty type is common for CSV on some systems; fall back to the canonical one.
  const type = file.type.toLowerCase();
  if (type && !IMPORT_MIME_TYPES[fileType].includes(type)) {
    return { ok: false, error: "The file contents don't match its extension." };
  }
  return { ok: true, fileType, contentType: type || IMPORT_MIME_TYPES[fileType][0] };
}

/**
 * Storage object name: {workspace_id}/{import_id}/{safe file name}. Must equal
 * excel_imports.storage_path, which the database pins to this prefix.
 */
export function buildImportStoragePath(workspaceId: string, importId: string, fileName: string) {
  const safe =
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^[._]+/, "")
      .slice(-120) || "upload";
  return `${workspaceId}/${importId}/${safe}`;
}
