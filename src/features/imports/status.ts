import type { BadgeTone } from "@/components/ui/badge";

export const IMPORT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  uploading: { label: "Uploading", tone: "info" },
  uploaded: { label: "Uploaded", tone: "info" },
  parsed: { label: "Awaiting review", tone: "warning" },
  importing: { label: "Importing", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_errors: { label: "Completed with errors", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const ROW_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  valid: { label: "Accepted", tone: "success" },
  invalid: { label: "Invalid", tone: "danger" },
  duplicate: { label: "Duplicate", tone: "warning" },
  imported: { label: "Imported", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export const FINISHED = new Set(["completed", "completed_with_errors"]);

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(iso: string | null, timezone: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}
