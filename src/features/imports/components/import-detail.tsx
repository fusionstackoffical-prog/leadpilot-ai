import { ArrowLeft, ChevronLeft, ChevronRight, FileSpreadsheet, Rows3 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import type { WorkspaceSummary } from "@/features/workspace/types";
import { cn, formatCount } from "@/lib/utils";
import type { getImportDetail, getImportRows, ImportRowFilter } from "../queries";
import { ROWS_PAGE_SIZE } from "../queries";
import { acceptedRows, canDeleteImport } from "../service";
import { FINISHED, formatBytes, formatDateTime, IMPORT_STATUS, ROW_STATUS } from "../status";
import { ImportActions } from "./import-actions";

type Detail = NonNullable<Awaited<ReturnType<typeof getImportDetail>>>;
type Rows = Awaited<ReturnType<typeof getImportRows>>;

const FILTERS: { key: ImportRowFilter; label: string }[] = [
  { key: "all", label: "All rows" },
  { key: "valid", label: "Accepted" },
  { key: "invalid", label: "Invalid" },
  { key: "duplicate", label: "Duplicates" },
  { key: "failed", label: "Failed" },
];

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-elevated px-3 py-2.5">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={cn("tabular mt-0.5 text-lg font-semibold text-fg", tone)}>{value}</p>
    </div>
  );
}

function issueText(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  return issues
    .filter((i): i is { message: string; severity: string } => typeof i?.message === "string")
    .map((i) => `${i.severity === "warning" ? "Warning: " : ""}${i.message}`);
}

export function ImportDetail({
  detail,
  rows,
  filter,
  page,
  user,
  workspace,
}: {
  detail: Detail;
  rows: Rows;
  filter: ImportRowFilter;
  page: number;
  user: { id: string };
  workspace: WorkspaceSummary;
}) {
  const { record, sheets, uploader } = detail;
  const status = IMPORT_STATUS[record.status] ?? { label: record.status, tone: "neutral" as const };
  const finished = FINISHED.has(record.status);
  const tz = workspace.timezone;
  const pages = Math.max(1, Math.ceil(rows.total / ROWS_PAGE_SIZE));
  const href = (f: ImportRowFilter, p = 1) =>
    `/imports/${record.id}?status=${f}${p > 1 ? `&page=${p}` : ""}`;
  const sheetName = new Map(sheets.map((s) => [s.id, s.sheet_name]));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <Link href="/imports" className={buttonClasses({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="size-3.5" aria-hidden />
        All imports
      </Link>

      <Card>
        <CardHeader
          title={record.file_name}
          description={`${record.file_type.toUpperCase()} · ${formatBytes(record.file_size_bytes)} · uploaded ${formatDateTime(record.created_at, tz)}${
            uploader ? ` by ${uploader.full_name || uploader.email}` : ""
          }`}
          icon={<FileSpreadsheet className="size-4" aria-hidden />}
          actions={<Badge tone={status.tone}>{status.label}</Badge>}
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Worksheets found" value={formatCount(record.worksheet_count)} />
            <Stat label="Rows read" value={formatCount(record.rows_read)} />
            <Stat
              label="Accepted"
              value={finished ? formatCount(acceptedRows(record)) : "—"}
              tone="text-success"
            />
            <Stat
              label="Invalid"
              value={formatCount(record.invalid_rows)}
              tone={record.invalid_rows ? "text-danger" : undefined}
            />
            <Stat
              label="Duplicates"
              value={formatCount(record.duplicate_rows)}
              tone={record.duplicate_rows ? "text-warning" : undefined}
            />
            <Stat
              label="Failed"
              value={formatCount(record.failed_rows)}
              tone={record.failed_rows ? "text-danger" : undefined}
            />
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-fg-muted">Started</dt>
              <dd className="text-fg-secondary">{formatDateTime(record.started_at, tz)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-muted">Finished</dt>
              <dd className="text-fg-secondary">{formatDateTime(record.completed_at, tz)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-muted">Worksheet imported</dt>
              <dd className="text-fg-secondary">
                {sheets
                  .filter((s) => s.selected)
                  .map((s) => s.sheet_name)
                  .join(", ") || "—"}
              </dd>
            </div>
            {record.duplicate_of_import_id ? (
              <div className="flex gap-2">
                <dt className="text-fg-muted">Same file as</dt>
                <dd>
                  <Link
                    href={`/imports/${record.duplicate_of_import_id}`}
                    className="text-accent hover:underline"
                  >
                    an earlier import
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
          {record.error_summary ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {record.error_summary}
            </p>
          ) : null}
          <ImportActions
            importId={record.id}
            fileName={record.file_name}
            storagePath={record.storage_path}
            status={record.status}
            canDelete={canDeleteImport(record, { id: user.id, role: workspace.role })}
            problemRows={record.invalid_rows + record.duplicate_rows + record.failed_rows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rows"
          description="Original spreadsheet row numbers, with the reason for every rejected row"
          icon={<Rows3 className="size-4" aria-hidden />}
        />
        <CardBody className="space-y-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="Filter rows">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href(f.key)}
                aria-current={filter === f.key ? "page" : undefined}
                className={buttonClasses({
                  size: "sm",
                  variant: filter === f.key ? "primary" : "secondary",
                })}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          {rows.rows.length === 0 ? (
            <EmptyState compact title="No rows in this view" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[720px] text-left text-xs" data-testid="import-rows">
                <thead className="bg-elevated text-fg-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    {sheets.length > 1 ? <th className="px-3 py-2 font-medium">Sheet</th> : null}
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Website / email / phone</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.rows.map((row) => {
                    const mapped = (row.mapped_data ?? {}) as Record<string, string>;
                    const rs = ROW_STATUS[row.status] ?? {
                      label: row.status,
                      tone: "neutral" as const,
                    };
                    const original = row.duplicate_of as unknown as { row_number: number } | null;
                    const notes = [
                      ...issueText(row.issues),
                      row.error_message,
                      original ? `Duplicate of row ${original.row_number}` : null,
                    ].filter(Boolean);
                    return (
                      <tr key={row.id} className="border-t border-line align-top">
                        <td className="tabular px-3 py-2 text-fg-muted">{row.row_number}</td>
                        {sheets.length > 1 ? (
                          <td className="px-3 py-2 text-fg-secondary">
                            {sheetName.get(row.sheet_id)}
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <Badge tone={rs.tone}>{rs.label}</Badge>
                        </td>
                        <td className="max-w-56 truncate px-3 py-2 text-fg">
                          {mapped.company_name ?? "—"}
                        </td>
                        <td className="max-w-72 px-3 py-2 text-fg-secondary">
                          {[mapped.website, mapped.business_email, mapped.phone]
                            .filter(Boolean)
                            .map((v) => (
                              <span key={v} className="block truncate">
                                {v}
                              </span>
                            ))}
                        </td>
                        <td className="px-3 py-2 text-fg-secondary">
                          {notes.map((n, i) => (
                            <span key={i} className="block">
                              {n}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 ? (
            <nav
              className="flex items-center justify-between text-xs text-fg-secondary"
              aria-label="Pagination"
            >
              <span>
                Page {page} of {pages} · {formatCount(rows.total)} rows
              </span>
              <span className="flex gap-2">
                <Link
                  href={href(filter, page - 1)}
                  className={buttonClasses({
                    size: "sm",
                    className: cn(page <= 1 && "pointer-events-none opacity-50"),
                  })}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  Previous
                </Link>
                <Link
                  href={href(filter, page + 1)}
                  className={buttonClasses({
                    size: "sm",
                    className: cn(page >= pages && "pointer-events-none opacity-50"),
                  })}
                >
                  Next
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </span>
            </nav>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
