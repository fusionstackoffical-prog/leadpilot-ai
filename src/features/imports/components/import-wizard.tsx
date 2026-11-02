"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage, Select } from "@/components/ui/form";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCount } from "@/lib/utils";
import { DUPLICATE_KEY_COLUMNS, duplicateReasons, type DuplicateKeys } from "../duplicates";
import {
  duplicateMappings,
  fieldLabel,
  LEAD_FIELDS,
  missingRequired,
  suggestMapping,
  type ColumnMapping,
  type LeadFieldKey,
} from "../fields";
import { MAX_IMPORT_FILE_BYTES, validateImportFile } from "../file-rules";
import { randomId } from "../hashing";
import { parseFile } from "../parse-client";
import type { ParsedSheet } from "../parse";
import {
  acceptedRows,
  cancelImport,
  completeImport,
  createImport,
  ImportError,
  markFailed,
  refreshImport,
  saveMapping,
  saveSheets,
  selectSheet,
  setStatus,
  sha256Hex,
  stageRows,
  uploadImportFile,
  type ImportRecord,
} from "../service";
import { formatBytes } from "../status";
import { validateSheet, type RowIssue } from "../validate";

const STEPS = [
  "Upload file",
  "Select worksheet",
  "Map columns",
  "Review",
  "Import",
  "Results",
] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;
type Progress = { label: string; done?: number; total?: number } | null;
type DuplicateRow = { rowNumber: number; originalRow: number | null; reasons: string[] };

/** Readable message for the user; unexpected errors keep their real text and are logged. */
function describe(error: unknown) {
  if (error instanceof ImportError) {
    if (error.cause) console.error(`Import ${error.step} failed:`, error.cause);
    return error.message;
  }
  console.error("Unexpected import error:", error);
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  return `Something went wrong${detail}. Please try again.`;
}

export function ImportWizard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(0);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetIds, setSheetIds] = useState<Map<number, string>>(new Map());
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [staged, setStaged] = useState(false);
  const [checked, setChecked] = useState<ImportRecord | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const idempotencyKey = useRef<string>("");
  const processing = useRef(false);

  const busy = progress !== null;
  const sheet = sheets[sheetIndex];

  // Warn before leaving while work is in flight.
  useEffect(() => {
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const deferredMapping = useDeferredValue(mapping);
  const validation = useMemo(
    () => (sheet && !sheet.error ? validateSheet(sheet, deferredMapping) : null),
    [sheet, deferredMapping],
  );

  function reset() {
    setStep(0);
    setFile(null);
    setSheets([]);
    setSheetIndex(0);
    setSheetIds(new Map());
    setRecord(null);
    setMapping({});
    setStaged(false);
    setChecked(null);
    setDuplicates([]);
    setProgress(null);
    setError(null);
    setNotice(null);
    idempotencyKey.current = "";
    if (inputRef.current) inputRef.current.value = "";
  }

  // ---------------------------------------------------------------- step 1
  async function handleFile(selected: File) {
    // One file at a time: ignore selections/drops while one is being processed.
    if (processing.current) return;
    processing.current = true;
    setError(null);
    setNotice(null);
    setFile(selected);
    const check = validateImportFile(selected);
    if (!check.ok) {
      setError(`${selected.name}: ${check.error}`);
      processing.current = false;
      return;
    }
    try {
      setProgress({ label: `Reading ${selected.name}…` });
      const buffer = await selected.arrayBuffer();
      const parsed = await parseFile(buffer, check.fileType);
      if (!parsed.ok) throw new ImportError(parsed.error, "parse");
      const usable = parsed.sheets.findIndex((s) => !s.error);
      if (usable === -1) {
        throw new ImportError(
          parsed.sheets.length === 1
            ? (parsed.sheets[0].error ?? "No data rows were found.")
            : "None of the worksheets contain data rows.",
          "parse",
        );
      }

      setProgress({ label: "Uploading securely…" });
      const sha256 = await sha256Hex(buffer);
      idempotencyKey.current ||= randomId();
      let created = await createImport(supabase, {
        workspaceId,
        idempotencyKey: idempotencyKey.current,
        fileName: selected.name,
        fileType: check.fileType,
        contentType: check.contentType,
        sizeBytes: selected.size,
        sha256,
      });
      if (created.status === "uploading") {
        await uploadImportFile(supabase, created, selected, check.contentType);
        created = await setStatus(supabase, created.id, ["uploading"], "uploaded");
      }
      setProgress({ label: "Saving worksheets…" });
      const ids = await saveSheets(
        supabase,
        created,
        parsed.sheets.map((s) => ({
          index: s.index,
          name: s.name,
          headerRowNumber: s.headerRowNumber,
          headers: s.headers,
        })),
      );
      created = await setStatus(supabase, created.id, ["uploaded"], "parsed");

      setSheets(parsed.sheets);
      setSheetIds(ids);
      setSheetIndex(usable);
      setRecord(created);
      if (created.duplicate_of_import_id) {
        setNotice(
          "This exact file was imported before. You can continue, and duplicate rows will be flagged.",
        );
      }
      setStep(1);
    } catch (e) {
      setError(describe(e));
    } finally {
      setProgress(null);
      processing.current = false;
    }
  }

  // ---------------------------------------------------------------- step 2
  async function confirmSheet() {
    if (!record || !sheet || sheet.error) return;
    setError(null);
    try {
      setProgress({ label: "Saving selection…" });
      await selectSheet(supabase, record.id, sheet.index);
      setMapping(suggestMapping(sheet.headers));
      setStep(2);
    } catch (e) {
      setError(describe(e));
    } finally {
      setProgress(null);
    }
  }

  // ---------------------------------------------------------------- step 4
  async function stageAndCheck() {
    if (!record || !sheet || !validation) return;
    const sheetId = sheetIds.get(sheet.index);
    if (!sheetId) return;
    setError(null);
    try {
      let current = record;
      if (current.status === "failed") {
        current = await setStatus(supabase, current.id, ["failed"], "parsed", {
          error_summary: null,
        });
      }
      await saveMapping(supabase, current.id, {
        sheetIndex: sheet.index,
        headerRowNumber: sheet.headerRowNumber,
        columns: Object.fromEntries(
          Object.entries(mapping).map(([i, field]) => [sheet.headers[Number(i)], field]),
        ),
      });
      setProgress({ label: "Saving rows…", done: 0, total: validation.rows.length });
      await stageRows(supabase, { workspaceId, importId: current.id, sheetId }, validation.rows, {
        onProgress: (done, total) => setProgress({ label: "Saving rows…", done, total }),
      });
      setStaged(true);
      setProgress({ label: "Checking for duplicates…" });
      const refreshed = await refreshImport(supabase, current.id);
      setRecord(refreshed);
      setChecked(refreshed);
      setDuplicates(await loadDuplicates(refreshed.id));
    } catch (e) {
      const message = describe(e);
      setError(message);
      if (record)
        await markFailed(supabase, record.id, message)
          .then(setRecord)
          .catch(() => undefined);
    } finally {
      setProgress(null);
    }
  }

  async function loadDuplicates(importId: string): Promise<DuplicateRow[]> {
    const { data } = await supabase
      .from("import_rows")
      .select(
        `row_number, ${DUPLICATE_KEY_COLUMNS}, original:duplicate_of_row_id ( row_number, ${DUPLICATE_KEY_COLUMNS} )`,
      )
      .eq("import_id", importId)
      .eq("status", "duplicate")
      .order("row_number")
      .limit(200);
    return (data ?? []).map((row) => {
      const original = row.original as unknown as (DuplicateKeys & { row_number: number }) | null;
      return {
        rowNumber: row.row_number,
        originalRow: original?.row_number ?? null,
        reasons: original ? duplicateReasons(row as DuplicateKeys, original) : [],
      };
    });
  }

  // ---------------------------------------------------------------- step 5
  async function commit() {
    if (!record) return;
    setError(null);
    setStep(4);
    try {
      setProgress({ label: "Finalizing import…" });
      const done = await completeImport(supabase, record.id);
      setRecord(done);
      setStep(5);
      router.refresh();
    } catch (e) {
      setError(describe(e));
      setRecord(await refreshRecord(record.id));
    } finally {
      setProgress(null);
    }
  }

  async function refreshRecord(id: string) {
    const { data } = await supabase.from("excel_imports").select("*").eq("id", id).maybeSingle();
    return data ?? record;
  }

  async function cancel() {
    if (
      record &&
      !["completed", "completed_with_errors", "cancelled", "importing"].includes(record.status)
    ) {
      try {
        await cancelImport(supabase, record.id);
      } catch {
        // The import stays visible in history and can be cancelled there.
      }
      router.refresh();
    }
    reset();
  }

  // ---------------------------------------------------------------- render
  return (
    <Card>
      <CardHeader
        title="Import leads from Excel or CSV"
        description="Upload a file, choose a worksheet, map columns and review every row before it's saved."
        icon={<FileSpreadsheet className="size-4" aria-hidden />}
        actions={
          step > 0 && step < 5 && !busy ? (
            <Button size="sm" variant="ghost" onClick={cancel}>
              <X className="size-3.5" aria-hidden />
              Cancel
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        <Stepper step={step} />

        {notice ? (
          <p
            role="status"
            className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info"
          >
            {notice}
          </p>
        ) : null}
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        {step === 0 ? (
          <UploadStep
            inputRef={inputRef}
            busy={busy}
            progress={progress}
            dragging={dragging}
            setDragging={setDragging}
            onFile={handleFile}
            fileName={file?.name ?? null}
          />
        ) : null}

        {step === 1 && sheet ? (
          <div className="space-y-4">
            <SheetPicker
              sheets={sheets}
              value={sheetIndex}
              onChange={setSheetIndex}
              disabled={busy}
            />
            <SheetPreview sheet={sheet} />
            <StepActions>
              <span />
              <Button
                variant="primary"
                onClick={confirmSheet}
                disabled={busy || Boolean(sheet.error)}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Map columns
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </StepActions>
          </div>
        ) : null}

        {step === 2 && sheet ? (
          <MappingStep
            sheet={sheet}
            mapping={mapping}
            setMapping={setMapping}
            summary={validation?.summary ?? null}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        ) : null}

        {step === 3 && validation ? (
          <ReviewStep
            validation={validation}
            staged={staged}
            checked={checked}
            duplicates={duplicates}
            progress={progress}
            failed={record?.status === "failed"}
            onBack={() => setStep(2)}
            onCheck={stageAndCheck}
            onCommit={commit}
          />
        ) : null}

        {step === 4 ? (
          <div className="space-y-3">
            {progress ? <ProgressBar progress={progress} /> : null}
            {!busy && error ? (
              <StepActions>
                <span />
                <Button variant="primary" onClick={commit}>
                  <RotateCcw className="size-4" aria-hidden />
                  Retry import
                </Button>
              </StepActions>
            ) : null}
          </div>
        ) : null}

        {step === 5 && record ? <ResultStep record={record} onAnother={reset} /> : null}
      </CardBody>
    </Card>
  );
}

// ===========================================================================

function Stepper({ step }: { step: Step }) {
  return (
    <>
      <p className="text-xs text-fg-secondary sm:hidden">
        Step {step + 1} of {STEPS.length} ·{" "}
        <span className="font-medium text-fg">{STEPS[step]}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex" aria-label="Import steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={i === step ? "step" : undefined}
          >
            <span
              className={cn(
                "tabular flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                i < step && "border-success/40 bg-success/10 text-success",
                i === step && "border-accent/50 bg-accent-soft text-accent",
                i > step && "border-line text-fg-muted",
              )}
            >
              {i < step ? <CheckCircle2 className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-xs",
                i === step ? "font-medium text-fg" : "text-fg-muted",
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" aria-hidden /> : null}
          </li>
        ))}
      </ol>
    </>
  );
}

function StepActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      {children}
    </div>
  );
}

function ProgressBar({ progress }: { progress: NonNullable<Progress> }) {
  const pct = progress.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-lg border border-line bg-elevated p-4"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2 text-fg">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
          {progress.label}
        </span>
        {pct !== null ? (
          <span className="tabular text-fg-secondary">
            {formatCount(progress.done ?? 0)} / {formatCount(progress.total ?? 0)} rows · {pct}%
          </span>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width]",
            pct === null && "w-1/3 animate-pulse",
          )}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};

function UploadStep({
  inputRef,
  busy,
  progress,
  dragging,
  setDragging,
  onFile,
  fileName,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  progress: Progress;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFile: (file: File) => void;
  fileName: string | null;
}) {
  // False in the server HTML and until React has hydrated. The native file picker
  // works without JavaScript, so never present it as ready before our handler exists.
  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const locked = busy || !ready;
  return (
    <div className="space-y-3">
      <label
        aria-busy={locked}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped && !busy) onFile(dropped);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line-strong hover:border-accent/60 hover:bg-hover",
          locked && "pointer-events-none opacity-60",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-md border border-line bg-elevated text-accent">
          <Upload className="size-5" aria-hidden />
        </span>
        <span className="text-sm font-medium text-fg">
          {ready ? "Drop a file here or click to browse" : "Preparing the uploader…"}
        </span>
        <span className="text-xs text-fg-muted">
          .xlsx, .xls or .csv · up to {formatBytes(MAX_IMPORT_FILE_BYTES)} · formulas and macros are
          never run
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="sr-only"
          disabled={locked}
          data-testid="import-file-input"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            // Clear the input so choosing the same file again (e.g. after an error) fires change.
            e.target.value = "";
            if (selected) onFile(selected);
          }}
        />
      </label>
      {!ready ? (
        <p className="text-xs text-fg-muted">
          If this doesn&apos;t finish loading, reload the page. Uploading needs JavaScript.
        </p>
      ) : null}
      {fileName && busy ? (
        <p className="truncate text-xs text-fg-secondary" data-testid="selected-file">
          Selected: {fileName}
        </p>
      ) : null}
      {progress ? <ProgressBar progress={progress} /> : null}
    </div>
  );
}

function SheetPicker({
  sheets,
  value,
  onChange,
  disabled,
}: {
  sheets: ParsedSheet[];
  value: number;
  onChange: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-medium text-fg-secondary">
        {sheets.length === 1
          ? "Worksheet"
          : `${sheets.length} worksheets found — choose one to import`}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sheets.map((s) => (
          <label
            key={s.index}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              value === s.index ? "border-accent/50 bg-accent-soft" : "border-line hover:bg-hover",
              (disabled || s.error) && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name="worksheet"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={value === s.index}
              disabled={disabled || Boolean(s.error)}
              onChange={() => onChange(s.index)}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{s.name}</span>
              <span className="block text-xs text-fg-muted">
                {s.error ?? `${formatCount(s.rows.length)} data rows · ${s.headers.length} columns`}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SheetPreview({ sheet }: { sheet: ParsedSheet }) {
  if (sheet.error) return null;
  const rows = sheet.rows.slice(0, 10);
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-secondary">
        Preview · header on row {sheet.headerRowNumber} · first {rows.length} of{" "}
        {formatCount(sheet.rows.length)} rows
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="bg-elevated text-fg-secondary">
            <tr>
              <th className="px-3 py-2 font-medium text-fg-muted">Row</th>
              {sheet.headers.map((h) => (
                <th key={h} className="max-w-56 truncate px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className="border-t border-line">
                <td className="tabular px-3 py-1.5 text-fg-muted">{row.rowNumber}</td>
                {row.cells.map((cell, i) => (
                  <td key={i} className="max-w-56 truncate px-3 py-1.5 text-fg" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MappingStep({
  sheet,
  mapping,
  setMapping,
  summary,
  onBack,
  onNext,
}: {
  sheet: ParsedSheet;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  summary: ReturnType<typeof validateSheet>["summary"] | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const missing = missingRequired(mapping);
  const repeated = duplicateMappings(mapping);
  const samples = (col: number) =>
    sheet.rows
      .map((r) => r.cells[col]?.trim())
      .filter(Boolean)
      .slice(0, 3);

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-secondary">
        We suggested a field for columns we recognised. Change any of them; unmapped columns are
        still kept with the original row.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-elevated text-fg-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Spreadsheet column</th>
              <th className="px-3 py-2 font-medium">Sample values</th>
              <th className="w-56 px-3 py-2 font-medium">LeadPilot field</th>
            </tr>
          </thead>
          <tbody>
            {sheet.headers.map((header, col) => {
              const field = mapping[col];
              return (
                <tr key={header} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-medium text-fg">{header}</td>
                  <td className="max-w-64 px-3 py-2 text-fg-muted">
                    {samples(col).map((s, i) => (
                      <span key={i} className="block truncate" title={s}>
                        {s}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      aria-label={`Field for ${header}`}
                      className={cn(
                        "h-9 text-xs",
                        field && repeated.includes(field) && "border-danger",
                      )}
                      value={field ?? ""}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value) next[col] = e.target.value as LeadFieldKey;
                        else delete next[col];
                        setMapping(next);
                      }}
                    >
                      <option value="">— Don&apos;t map —</option>
                      {LEAD_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {"required" in f && f.required ? " (required)" : ""}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {missing.length ? (
        <FormMessage tone="error">
          Map a column to {missing.map(fieldLabel).join(", ")} to continue.
        </FormMessage>
      ) : null}
      {repeated.length ? (
        <FormMessage tone="error">
          Each field can be used once: {repeated.map(fieldLabel).join(", ")}.
        </FormMessage>
      ) : null}
      {summary && !missing.length ? (
        <p className="text-xs text-fg-secondary">
          With this mapping:{" "}
          <span className="text-success">{formatCount(summary.valid)} valid</span> ·{" "}
          <span className="text-danger">{formatCount(summary.invalid)} invalid</span> of{" "}
          {formatCount(summary.total)} rows
        </p>
      ) : null}

      <StepActions>
        <Button onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <Button
          variant="primary"
          onClick={onNext}
          disabled={missing.length > 0 || repeated.length > 0}
        >
          Review rows
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </StepActions>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-elevated px-3 py-2.5">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={cn("tabular mt-0.5 text-lg font-semibold text-fg", tone)}>
        {typeof value === "number" ? formatCount(value) : value}
      </p>
    </div>
  );
}

function ReviewStep({
  validation,
  staged,
  checked,
  duplicates,
  progress,
  failed,
  onBack,
  onCheck,
  onCommit,
}: {
  validation: ReturnType<typeof validateSheet>;
  staged: boolean;
  checked: ImportRecord | null;
  duplicates: DuplicateRow[];
  progress: Progress;
  failed: boolean;
  onBack: () => void;
  onCheck: () => void;
  onCommit: () => void;
}) {
  const [show, setShow] = useState<"error" | "warning">("error");
  const [limit, setLimit] = useState(50);
  const { summary } = validation;
  const issues = useMemo(
    () =>
      validation.rows.flatMap((row) =>
        row.issues
          .filter((i) => i.severity === show)
          .map((issue: RowIssue) => ({ rowNumber: row.rowNumber, issue })),
      ),
    [validation, show],
  );
  const busy = progress !== null;
  const ready = checked ? acceptedRows(checked) : null;

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
        data-testid="review-summary"
      >
        <Stat label="Total spreadsheet rows" value={checked?.rows_read ?? summary.total} />
        <Stat
          label="Valid rows"
          value={checked ? checked.rows_read - checked.invalid_rows : summary.valid}
          tone="text-success"
        />
        <Stat
          label="Invalid rows"
          value={checked?.invalid_rows ?? summary.invalid}
          tone={summary.invalid ? "text-danger" : undefined}
        />
        <Stat
          label="Duplicate rows"
          value={checked ? checked.duplicate_rows : "Not checked"}
          tone={checked?.duplicate_rows ? "text-warning" : undefined}
        />
        <Stat label="Ready to import" value={ready ?? "—"} tone="text-accent" />
      </div>

      {!checked ? (
        <p className="text-xs text-fg-secondary">
          Invalid rows are kept for your records but never imported. Next, rows are saved to this
          import and checked for duplicates by website, email, phone, or company + city + state.
        </p>
      ) : (
        <p className="text-xs text-fg-secondary">
          Duplicates were checked in the database. The first occurrence is kept; later matches are
          skipped.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={show === "error" ? "primary" : "secondary"}
            onClick={() => setShow("error")}
          >
            Errors ({formatCount(summary.invalid)} rows)
          </Button>
          <Button
            size="sm"
            variant={show === "warning" ? "primary" : "secondary"}
            onClick={() => setShow("warning")}
          >
            Warnings ({formatCount(summary.withWarnings)} rows)
          </Button>
        </div>
        {issues.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">
            {show === "error" ? "No invalid rows." : "No warnings."}
          </p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs" data-testid="issue-table">
              <thead className="sticky top-0 bg-elevated text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody>
                {issues.slice(0, limit).map(({ rowNumber, issue }, i) => (
                  <tr key={`${rowNumber}-${i}`} className="border-t border-line">
                    <td className="tabular px-3 py-1.5 text-fg-muted">{rowNumber}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-fg-secondary">
                      {issue.field === "row" ? "Row" : fieldLabel(issue.field)}
                    </td>
                    <td className="px-3 py-1.5 text-fg">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {issues.length > limit ? (
              <div className="border-t border-line p-2 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 200)}>
                  Show more ({formatCount(issues.length - limit)} remaining)
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {checked && duplicates.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-secondary">Duplicate rows</p>
          <div className="max-h-60 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs" data-testid="duplicate-table">
              <thead className="sticky top-0 bg-elevated text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Matches row</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((d) => (
                  <tr key={d.rowNumber} className="border-t border-line">
                    <td className="tabular px-3 py-1.5 text-fg-muted">{d.rowNumber}</td>
                    <td className="tabular px-3 py-1.5 text-fg-secondary">
                      {d.originalRow ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-fg">
                      {d.reasons.join(" · ") || "Matching key"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {checked.duplicate_rows > duplicates.length ? (
            <p className="text-[11px] text-fg-muted">
              Showing the first {duplicates.length}. All are listed on the import&apos;s detail
              page.
            </p>
          ) : null}
        </div>
      ) : null}

      {progress ? <ProgressBar progress={progress} /> : null}

      <StepActions>
        <Button onClick={onBack} disabled={busy || staged}>
          <ArrowLeft className="size-4" aria-hidden />
          {staged ? "Mapping locked" : "Back"}
        </Button>
        {!checked ? (
          <Button variant="primary" onClick={onCheck} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {failed ? "Retry saving rows" : "Save rows & check duplicates"}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button variant="primary" onClick={onCommit} disabled={busy} data-testid="confirm-import">
            <CheckCircle2 className="size-4" aria-hidden />
            Confirm import of {formatCount(ready ?? 0)} rows
          </Button>
        )}
      </StepActions>
    </div>
  );
}

function ResultStep({ record, onAnother }: { record: ImportRecord; onAnother: () => void }) {
  const ok = record.status === "completed";
  const accepted = acceptedRows(record);
  return (
    <div className="space-y-4" data-testid="import-result">
      <div
        role="status"
        className={cn(
          "flex items-start gap-3 rounded-lg border p-4",
          ok ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10",
        )}
      >
        {ok ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        )}
        <div>
          <p className="text-sm font-medium text-fg">
            {ok ? "Import complete" : "Import complete, with rows that need attention"}
          </p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {record.rows_imported > 0
              ? `${formatCount(record.rows_imported)} rows added to the Lead Database: ${formatCount(record.new_records)} new ${record.new_records === 1 ? "lead" : "leads"}, ${formatCount(record.rows_imported - record.new_records)} matched existing ${record.rows_imported - record.new_records === 1 ? "lead" : "leads"}.`
              : `${formatCount(accepted)} rows accepted and stored with this import.`}
            {record.invalid_rows
              ? ` ${formatCount(record.invalid_rows)} invalid rows were not imported.`
              : ""}
            {record.duplicate_rows
              ? ` ${formatCount(record.duplicate_rows)} duplicates were skipped.`
              : ""}
            {record.rows_imported > 0
              ? ""
              : " They'll appear in the Lead Database once it's enabled."}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Rows read" value={record.rows_read} />
        <Stat label="Accepted" value={accepted} tone="text-success" />
        <Stat
          label="Invalid"
          value={record.invalid_rows}
          tone={record.invalid_rows ? "text-danger" : undefined}
        />
        <Stat
          label="Duplicates"
          value={record.duplicate_rows}
          tone={record.duplicate_rows ? "text-warning" : undefined}
        />
      </div>
      <StepActions>
        <Badge tone={ok ? "success" : "warning"}>
          {ok ? "Completed" : "Completed with errors"}
        </Badge>
        <div className="flex flex-wrap gap-2">
          <Link href={`/imports/${record.id}`} className={buttonClasses({ size: "md" })}>
            View details
          </Link>
          <Button variant="primary" onClick={onAnother}>
            <Upload className="size-4" aria-hidden />
            Import another file
          </Button>
        </div>
      </StepActions>
    </div>
  );
}
