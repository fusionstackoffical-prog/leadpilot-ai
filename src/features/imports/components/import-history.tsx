import { ChevronLeft, ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { cn, formatCount } from "@/lib/utils";
import { HISTORY_PAGE_SIZE, type ImportListItem } from "../queries";
import { acceptedRows } from "../service";
import { FINISHED, formatDateTime, IMPORT_STATUS } from "../status";

export function ImportHistory({
  imports,
  total,
  page,
  timezone,
}: {
  imports: ImportListItem[];
  total: number;
  page: number;
  timezone: string;
}) {
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  return (
    <Card>
      <CardHeader
        title="Import history"
        description={
          total
            ? `${formatCount(total)} ${total === 1 ? "import" : "imports"} in this workspace`
            : "Every file imported into this workspace"
        }
        icon={<History className="size-4" aria-hidden />}
      />
      <CardBody>
        {imports.length === 0 ? (
          <EmptyState
            icon={History}
            title="No imports yet"
            description="Files you import appear here with their row counts, duplicates and any problems found."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table
                className="w-full min-w-[760px] text-left text-xs"
                data-testid="import-history"
              >
                <thead className="bg-elevated text-fg-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">File</th>
                    <th className="px-3 py-2 font-medium">Uploaded</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Total rows</th>
                    <th className="px-3 py-2 text-right font-medium">Accepted</th>
                    <th className="px-3 py-2 text-right font-medium">Invalid</th>
                    <th className="px-3 py-2 text-right font-medium">Duplicates</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((item) => {
                    const status = IMPORT_STATUS[item.status] ?? {
                      label: item.status,
                      tone: "neutral" as const,
                    };
                    const finished = FINISHED.has(item.status);
                    return (
                      <tr key={item.id} className="border-t border-line hover:bg-hover">
                        <td className="max-w-72 px-3 py-2">
                          <Link
                            href={`/imports/${item.id}`}
                            className="block truncate font-medium text-fg hover:text-accent"
                            title={item.file_name}
                          >
                            {item.file_name}
                          </Link>
                          <span className="text-[11px] text-fg-muted uppercase">
                            {item.file_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                          {formatDateTime(item.created_at, timezone)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td className="tabular px-3 py-2 text-right text-fg">
                          {formatCount(item.rows_read)}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-success">
                          {finished ? formatCount(acceptedRows(item)) : "—"}
                        </td>
                        <td
                          className={cn(
                            "tabular px-3 py-2 text-right",
                            item.invalid_rows ? "text-danger" : "text-fg-muted",
                          )}
                        >
                          {formatCount(item.invalid_rows)}
                        </td>
                        <td
                          className={cn(
                            "tabular px-3 py-2 text-right",
                            item.duplicate_rows ? "text-warning" : "text-fg-muted",
                          )}
                        >
                          {formatCount(item.duplicate_rows)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 ? (
              <nav
                className="mt-3 flex items-center justify-between text-xs text-fg-secondary"
                aria-label="Pagination"
              >
                <span>
                  Page {page} of {pages}
                </span>
                <span className="flex gap-2">
                  <Link
                    href={`/imports?page=${page - 1}`}
                    aria-disabled={page <= 1}
                    className={buttonClasses({
                      size: "sm",
                      className: cn(page <= 1 && "pointer-events-none opacity-50"),
                    })}
                  >
                    <ChevronLeft className="size-3.5" aria-hidden />
                    Previous
                  </Link>
                  <Link
                    href={`/imports?page=${page + 1}`}
                    aria-disabled={page >= pages}
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
          </>
        )}
      </CardBody>
    </Card>
  );
}
