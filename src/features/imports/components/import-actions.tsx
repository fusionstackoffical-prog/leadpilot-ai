"use client";

import { Download, FileWarning, Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { createClient } from "@/lib/supabase/client";
import { csvCell } from "../duplicates";
import { cancelImport, deleteImport, ImportError, IMPORTS_BUCKET } from "../service";

type Props = {
  importId: string;
  fileName: string;
  storagePath: string | null;
  status: string;
  canDelete: boolean;
  problemRows: number;
};

/** Per-import actions. Every call runs as the signed-in user, so RLS decides what's allowed. */
export function ImportActions({
  importId,
  fileName,
  storagePath,
  status,
  canDelete,
  problemRows,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ImportError ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadOriginal = () =>
    run("original", async () => {
      if (!storagePath) throw new ImportError("The original file isn't stored.", "download");
      const { data, error } = await supabase.storage
        .from(IMPORTS_BUCKET)
        .createSignedUrl(storagePath, 60, {
          download: fileName,
        });
      if (error || !data)
        throw new ImportError("The original file isn't available.", "download", error);
      window.location.assign(data.signedUrl);
    });

  const downloadProblems = () =>
    run("problems", async () => {
      const lines = ["Row,Status,Reasons,Original values"];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("import_rows")
          .select("row_number, status, issues, error_message, raw_data")
          .eq("import_id", importId)
          .in("status", ["invalid", "failed", "duplicate"])
          .order("row_number")
          .range(from, from + 999);
        if (error) throw new ImportError("Couldn't load the rows.", "download", error);
        for (const row of data ?? []) {
          const issues = Array.isArray(row.issues)
            ? (row.issues as { message?: string; severity?: string }[])
                .filter((i) => i.severity === "error")
                .map((i) => i.message)
            : [];
          const reasons = [
            ...issues,
            row.error_message,
            row.status === "duplicate" ? "Duplicate of an earlier row" : null,
          ]
            .filter(Boolean)
            .join("; ");
          lines.push(
            [row.row_number, row.status, reasons, JSON.stringify(row.raw_data)]
              .map(csvCell)
              .join(","),
          );
        }
        if (!data || data.length < 1000) break;
      }
      save(
        new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }),
        `${fileName.replace(/\.[^.]+$/, "")}-problem-rows.csv`,
      );
    });

  const cancel = () =>
    run("cancel", async () => {
      await cancelImport(supabase, importId);
      router.refresh();
    });

  const remove = () =>
    run("delete", async () => {
      await deleteImport(supabase, { id: importId, storage_path: storagePath });
      router.push("/imports");
      router.refresh();
    });

  const spin = (label: string) =>
    busy === label ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null;
  const unfinished = ["uploading", "uploaded", "parsed", "failed"].includes(status);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {storagePath ? (
          <Button size="sm" onClick={downloadOriginal} disabled={busy !== null}>
            {spin("original") ?? <Download className="size-3.5" aria-hidden />}
            Original file
          </Button>
        ) : null}
        {problemRows > 0 ? (
          <Button size="sm" onClick={downloadProblems} disabled={busy !== null}>
            {spin("problems") ?? <FileWarning className="size-3.5" aria-hidden />}
            Problem rows (CSV)
          </Button>
        ) : null}
        {unfinished ? (
          <Button size="sm" onClick={cancel} disabled={busy !== null}>
            {spin("cancel") ?? <X className="size-3.5" aria-hidden />}
            Cancel import
          </Button>
        ) : null}
        {canDelete && !confirmDelete ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        ) : null}
      </div>
      {confirmDelete ? (
        <div
          role="alertdialog"
          className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs"
        >
          <span className="text-fg">
            Delete this import, its rows and the uploaded file? This can&apos;t be undone.
          </span>
          <Button size="sm" variant="danger" onClick={remove} disabled={busy !== null}>
            {spin("delete")}
            Delete permanently
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(false)}
            disabled={busy !== null}
          >
            Keep it
          </Button>
        </div>
      ) : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
