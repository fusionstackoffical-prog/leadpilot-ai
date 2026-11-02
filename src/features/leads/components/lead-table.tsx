import { ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/features/imports/status";
import { cn, formatCount } from "@/lib/utils";
import { LEADS_PAGE_SIZE, type LeadRow } from "../queries";
import { QUALIFICATION, VERIFICATION } from "../status";

export function LeadTable({
  enabled,
  leads,
  total,
  q,
  page,
  timezone,
}: {
  enabled: boolean;
  leads: LeadRow[];
  total: number;
  q: string;
  page: number;
  timezone: string;
}) {
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const href = (p: number) =>
    `/leads?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <Card>
        <CardHeader
          title="Lead Database"
          description={
            enabled
              ? `${formatCount(total)} ${q ? "matching " : ""}${total === 1 ? "lead" : "leads"} in this workspace`
              : "Companies imported from Excel/CSV files"
          }
          icon={<Database className="size-4" aria-hidden />}
        />
        <CardBody className="space-y-4">
          {!enabled ? (
            <EmptyState
              icon={Database}
              title="Lead Database not enabled yet"
              description="Your imported rows are safely stored with their imports. They appear here as leads once the lead database is enabled."
              action={
                <Link href="/imports" className={buttonClasses({ size: "sm" })}>
                  View imports
                </Link>
              }
            />
          ) : (
            <>
              <form action="/leads" className="flex max-w-md gap-2" role="search">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
                    aria-hidden
                  />
                  <Input
                    name="q"
                    defaultValue={q}
                    placeholder="Search company, website, email, city, phone"
                    aria-label="Search leads"
                    className="h-9 pl-9"
                  />
                </div>
                <button type="submit" className={buttonClasses({ size: "md" })}>
                  Search
                </button>
              </form>
              {leads.length === 0 ? (
                <EmptyState
                  icon={Database}
                  title={q ? "No leads match your search" : "No leads yet"}
                  description={
                    q
                      ? "Try a different company, website or city."
                      : "Import an Excel or CSV file to add leads."
                  }
                  action={
                    q ? undefined : (
                      <Link
                        href="/imports"
                        className={buttonClasses({ size: "sm", variant: "primary" })}
                      >
                        Import a file
                      </Link>
                    )
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table
                    className="w-full min-w-[900px] text-left text-xs"
                    data-testid="lead-table"
                  >
                    <thead className="bg-elevated text-fg-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Company</th>
                        <th className="px-3 py-2 font-medium">Website</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Phone</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium">Verification</th>
                        <th className="px-3 py-2 font-medium">Qualification</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead) => {
                        const v = VERIFICATION[lead.verification_status] ?? VERIFICATION.unverified;
                        return (
                          <tr
                            key={lead.id}
                            className="border-t border-line align-top hover:bg-hover"
                          >
                            <td className="max-w-56 truncate px-3 py-2 font-medium">
                              <Link
                                href={`/research/${lead.id}`}
                                className="text-fg hover:text-accent hover:underline"
                              >
                                {lead.company_name}
                              </Link>
                            </td>
                            <td className="max-w-48 truncate px-3 py-2 text-fg-secondary">
                              {lead.website ?? "—"}
                            </td>
                            <td className="max-w-48 truncate px-3 py-2 text-fg-secondary">
                              {lead.business_email ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                              {lead.phone ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                              {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                            </td>
                            <td className="px-3 py-2">
                              <Badge tone={v.tone}>{v.label}</Badge>
                            </td>
                            <td className="px-3 py-2 text-fg-secondary">
                              {QUALIFICATION[lead.qualification_status] ??
                                lead.qualification_status}
                            </td>
                            <td className="max-w-48 truncate px-3 py-2">
                              {lead.source_import_id ? (
                                <Link
                                  href={`/imports/${lead.source_import_id}`}
                                  className="text-accent hover:underline"
                                >
                                  {lead.source_name ?? "Import"}
                                </Link>
                              ) : (
                                <span className="text-fg-secondary">{lead.source_name ?? "—"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                              {formatDateTime(lead.discovered_at, timezone)}
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
                    Page {page} of {pages}
                  </span>
                  <span className="flex gap-2">
                    <Link
                      href={href(page - 1)}
                      className={buttonClasses({
                        size: "sm",
                        className: cn(page <= 1 && "pointer-events-none opacity-50"),
                      })}
                    >
                      <ChevronLeft className="size-3.5" aria-hidden />
                      Previous
                    </Link>
                    <Link
                      href={href(page + 1)}
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
    </div>
  );
}
