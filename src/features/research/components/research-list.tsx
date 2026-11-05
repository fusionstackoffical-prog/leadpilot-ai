import { ChevronLeft, ChevronRight, Microscope, Search } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/features/imports/status";
import { cn, formatCount } from "@/lib/utils";
import { displayHost, safeExternalUrl } from "../links";
import { RESEARCH_PAGE_SIZE, type ResearchCompany } from "../queries";
import { NOT_RESEARCHED, type CompanyResearchState } from "../status";
import { RunStatusPoller } from "./run-status-poller";
import { CompanyStatusBadge } from "./status-badge";

export function ResearchList({
  companies,
  total,
  q,
  page,
  states,
  setupMissing,
  timezone,
}: {
  companies: ResearchCompany[];
  total: number;
  q: string;
  page: number;
  /** Real research status per company id (companies with no runs are "not researched"). */
  states: Record<string, CompanyResearchState>;
  /** What research still needs on the server (names only), or null when it is set up. */
  setupMissing: string[] | null;
  timezone: string;
}) {
  const pages = Math.max(1, Math.ceil(total / RESEARCH_PAGE_SIZE));
  const href = (p: number) =>
    `/research?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  const anyActive = companies.some((c) => states[c.id]?.active);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      {/* Refreshes every 8 s while any listed company is queued or running, and only then. */}
      <RunStatusPoller active={anyActive} />
      {setupMissing ? (
        <div
          role="status"
          className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info"
        >
          <p>
            Research isn&apos;t set up on this server yet, so it can&apos;t be started. Statuses
            below are real, but nothing has been researched until it is configured and the worker is
            run. Missing: {setupMissing.join("; ")}. See docs/SETUP.md, &ldquo;Company research
            worker&rdquo;.
          </p>
        </div>
      ) : (
        <p
          role="status"
          className="rounded-md border border-line bg-elevated/40 px-3 py-2 text-xs text-fg-secondary"
        >
          Open a company to start research on its own website. In this phase the research worker is
          started manually, so queued research runs only when it is.
        </p>
      )}
      <Card>
        <CardHeader
          title="Company Research"
          description={`${formatCount(total)} ${q ? "matching " : ""}${total === 1 ? "company" : "companies"} in this workspace`}
          icon={<Microscope className="size-4" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <form action="/research" className="flex max-w-md gap-2" role="search">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
                aria-hidden
              />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search company, website, email, city, phone"
                aria-label="Search companies"
                className="h-9 pl-9"
              />
            </div>
            <button type="submit" className={buttonClasses({ size: "md" })}>
              Search
            </button>
          </form>

          {companies.length === 0 ? (
            <EmptyState
              icon={Microscope}
              title={q ? "No companies match your search" : "No companies yet"}
              description={
                q
                  ? "Try a different company, website or city."
                  : "Companies appear here once an Excel or CSV import adds leads."
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
                className="w-full min-w-[860px] text-left text-xs"
                data-testid="research-table"
              >
                <thead className="bg-elevated text-fg-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Website</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Research status</th>
                    <th className="px-3 py-2 font-medium">Last researched</th>
                    <th className="px-3 py-2 font-medium">Lead score</th>
                    <th className="px-3 py-2 font-medium">Proposal</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => {
                    const site = safeExternalUrl(company.website);
                    const state = states[company.id] ?? NOT_RESEARCHED;
                    return (
                      <tr
                        key={company.id}
                        className="border-t border-line align-top hover:bg-hover"
                      >
                        <td className="max-w-64 truncate px-3 py-2 font-medium">
                          <Link
                            href={`/research/${company.id}`}
                            className="text-fg hover:text-accent hover:underline"
                          >
                            {company.company_name}
                          </Link>
                        </td>
                        <td className="max-w-48 truncate px-3 py-2 text-fg-secondary">
                          {site ? (
                            <a
                              href={site}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="hover:text-accent hover:underline"
                            >
                              {displayHost(company.website)}
                            </a>
                          ) : (
                            (company.website ?? "—")
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                          {[company.city, company.state].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <CompanyStatusBadge status={state.status} />
                          {state.hasEarlierResult &&
                          (state.status === "failed" || state.status === "cancelled") ? (
                            <span className="mt-0.5 block text-[11px] text-fg-muted">
                              Earlier results available
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-fg-muted">
                          {state.lastResearchedAt
                            ? formatDateTime(state.lastResearchedAt, timezone)
                            : "Never"}
                        </td>
                        <td className="tabular px-3 py-2 text-fg-secondary">
                          {company.lead_score ?? "Not scored"}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          <span title="Proposals module not built yet">—</span>
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
        </CardBody>
      </Card>
    </div>
  );
}
