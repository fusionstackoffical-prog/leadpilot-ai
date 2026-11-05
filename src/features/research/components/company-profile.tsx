import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  FileSearch,
  Gauge,
  Globe,
  History,
  Lightbulb,
  ListChecks,
  MapPin,
  Microscope,
  Package,
  Phone,
  Send,
  Share2,
  Target,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatRow } from "@/components/data/stat-row";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/features/imports/status";
import { QUALIFICATION, VERIFICATION } from "@/features/leads/status";
import { displayHost, safeExternalUrl } from "../links";
import { emptyResultsText, emptySections } from "../presenter";
import type { CompanyProfileLead, ImportProvenance } from "../queries";
import type { ResearchOverview } from "../results-queries";
import { describeCompanyState, describeRun, RUN_STATUS } from "../status";
import { ResearchControls } from "./research-controls";
import { ResearchHistory } from "./research-history";
import { AssessmentList, FindingList, PagesResearched, ResearchNotes } from "./research-results";
import { Section } from "./section";
import { CompanyStatusBadge } from "./status-badge";
import { RunStatusPoller } from "./run-status-poller";

function NotBuilt({ module }: { module: string }) {
  return (
    <EmptyState
      compact
      title="No records"
      description={`The ${module} module isn't built yet. Records will appear here once it is.`}
    />
  );
}

/** A labelled group inside a section. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

const dash = (value: string | null) => value?.trim() || "—";

/** Everything the research parts of the profile need, prepared on the server. */
export type ResearchProfileData = {
  overview: ResearchOverview;
  /** What research still needs on the server (names only), or null when it is set up. */
  setupMissing: string[] | null;
  /** Why this company can't be researched, or null when it can. */
  ineligibleReason: string | null;
  /** Idempotency key for this page render. */
  requestKey: string;
};

export function CompanyProfile({
  lead,
  provenance,
  timezone,
  research,
}: {
  lead: CompanyProfileLead;
  provenance: ImportProvenance[];
  timezone: string;
  research: ResearchProfileData;
}) {
  const site = safeExternalUrl(lead.website);
  const verification = VERIFICATION[lead.verification_status] ?? VERIFICATION.unverified;
  const location = [lead.city, lead.state].filter(Boolean).join(", ");

  const { overview, setupMissing, ineligibleReason, requestKey } = research;
  const { state, selected, runs, activeRun } = overview;
  const status = describeCompanyState(state);
  const sections = selected?.sections ?? emptySections();
  const empty = emptyResultsText({ runStatus: selected?.run.status ?? null, active: state.active });
  const showsFindings =
    selected !== null && ["completed", "completed_with_warnings"].includes(selected.run.status);
  const latestFinished = runs.find((r) => r.id === state.latestFinishedRunId) ?? null;
  const latestInfo =
    latestFinished && (state.status === "failed" || state.status === "cancelled")
      ? describeRun({
          status: latestFinished.status,
          attempts: latestFinished.attempts,
          max_attempts: latestFinished.maxAttempts,
          error_code: latestFinished.errorCode,
        })
      : null;
  const activeInfo = activeRun
    ? describeRun({
        status: activeRun.status,
        attempts: activeRun.attempts,
        max_attempts: activeRun.maxAttempts,
        error_code: activeRun.errorCode,
      })
    : null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      {/* Refreshes the page every 8 s while a run is queued or running, and only then. */}
      <RunStatusPoller active={state.active} />

      <Link href="/research" className={buttonClasses({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="size-3.5" aria-hidden />
        All companies
      </Link>

      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4 pt-5">
          <div className="min-w-0">
            {/* The top bar renders the page's h1 ("Company Research"). */}
            <h2 className="truncate text-xl font-semibold text-fg" data-testid="company-name">
              {lead.company_name}
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              {location || "Location unknown"}
              {lead.website ? (
                <>
                  {" · "}
                  {site ? (
                    <a
                      href={site}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent hover:underline"
                    >
                      {displayHost(lead.website)}
                    </a>
                  ) : (
                    lead.website
                  )}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CompanyStatusBadge status={state.status} />
            <Badge tone={verification.tone}>{verification.label}</Badge>
            <Badge tone="neutral">
              {QUALIFICATION[lead.qualification_status] ?? lead.qualification_status}
            </Badge>
            {lead.suppressed ? <Badge tone="danger">Suppressed</Badge> : null}
          </div>
        </CardBody>
      </Card>

      <Card data-testid="research-status-card">
        <CardHeader
          title="Research"
          description="Status of research on this company's own website"
          icon={<Microscope className="size-4" aria-hidden />}
        />
        <CardBody className="space-y-4">
          {/* One shrinkable column on narrow screens; from lg the controls column is as wide as its
              content, but never wider than 20rem, so a long explanation wraps instead of taking over. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_fit-content(20rem)]">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg" data-testid="research-headline">
                {status.headline}
              </p>
              <p className="mt-0.5 max-w-2xl text-xs text-fg-secondary">{status.detail}</p>
              <dl className="mt-3 max-w-md divide-y divide-line">
                <StatRow
                  label="Last researched"
                  value={
                    state.lastResearchedAt
                      ? formatDateTime(state.lastResearchedAt, timezone)
                      : "Never"
                  }
                />
                {activeRun ? (
                  <StatRow
                    label="Current run"
                    value={
                      <Badge tone={RUN_STATUS[activeRun.status].tone}>
                        {RUN_STATUS[activeRun.status].label}
                      </Badge>
                    }
                  />
                ) : null}
                {selected && !state.active ? (
                  <StatRow label="Pages researched" value={`${selected.run.pagesFetched}`} />
                ) : null}
                {selected && showsFindings ? (
                  <StatRow
                    label="Findings"
                    value={`${selected.counts.confirmed} confirmed · ${selected.counts.unconfirmed} unconfirmed`}
                  />
                ) : null}
              </dl>
              {activeInfo?.detail ? (
                <p className="mt-2 text-xs text-fg-muted">
                  {activeInfo.detail}
                  {activeRun?.status === "queued" &&
                  activeRun.attempts > 0 &&
                  activeRun.nextAttemptAt
                    ? ` Next attempt after ${formatDateTime(activeRun.nextAttemptAt, timezone)}.`
                    : ""}
                </p>
              ) : null}
            </div>

            <ResearchControls
              leadId={lead.id}
              requestKey={requestKey}
              status={state.status}
              hasResult={state.hasEarlierResult}
              active={state.active}
              cancellableRunId={activeRun?.canCancel ? activeRun.id : null}
              setupMissing={setupMissing}
              ineligibleReason={ineligibleReason}
            />
          </div>

          {latestInfo && latestFinished ? (
            <div
              className="rounded-md border border-line bg-elevated/40 px-3 py-2 text-xs"
              data-testid="latest-attempt"
            >
              <p className="font-medium text-fg">
                Latest attempt (
                {formatDateTime(latestFinished.finishedAt ?? latestFinished.queuedAt, timezone)}):{" "}
                {latestInfo.label}
              </p>
              {latestInfo.detail ? (
                <p className="mt-0.5 text-fg-secondary">{latestInfo.detail}</p>
              ) : null}
              {latestFinished.status === "failed" && latestFinished.errorMessage ? (
                <p className="mt-0.5 break-words text-danger">{latestFinished.errorMessage}</p>
              ) : null}
              {latestInfo.retry ? (
                <p className="mt-0.5 text-fg-muted">
                  Retry {latestInfo.retry.permitted ? "permitted" : "not permitted"}:{" "}
                  {latestInfo.retry.text}
                </p>
              ) : null}
            </div>
          ) : null}

          {overview.requestedRunNotFound ? (
            <p
              role="status"
              className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info"
            >
              That research run wasn&apos;t found for this company, so the latest results are shown
              instead.
            </p>
          ) : null}

          {selected && !selected.isDefault ? (
            <p
              role="status"
              className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info"
            >
              You&apos;re viewing the run from{" "}
              {formatDateTime(selected.run.finishedAt ?? selected.run.queuedAt, timezone)}, not the
              latest results.{" "}
              <Link href={`/research/${lead.id}`} className="font-medium underline">
                Show the latest results
              </Link>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <Section
          title="Company overview"
          description="As provided in the imported file"
          icon={Building2}
          kind="imported"
        >
          <dl className="divide-y divide-line">
            <StatRow label="Company name" value={lead.company_name} />
            <StatRow label="Address" value={dash(lead.address)} />
            <StatRow label="City" value={dash(lead.city)} />
            <StatRow label="State" value={dash(lead.state)} />
            <StatRow label="Postal code" value={dash(lead.postal_code)} />
            <StatRow label="Country" value={dash(lead.country)} />
            <StatRow label="Source" value={dash(lead.source_name)} />
            <StatRow label="Added" value={formatDateTime(lead.discovered_at, timezone)} />
          </dl>
          {lead.notes ? (
            <p className="mt-3 text-xs whitespace-pre-wrap text-fg-secondary">{lead.notes}</p>
          ) : null}
        </Section>

        <Section
          title="Public business contact information"
          description="Imported values, and what the company's website says"
          icon={Phone}
        >
          <Group title="Imported · unverified">
            <dl className="divide-y divide-line">
              <StatRow label="Business email" value={dash(lead.business_email)} />
              <StatRow label="Phone" value={dash(lead.phone)} />
              <StatRow
                label="Decision-maker"
                value={
                  lead.decision_maker_name
                    ? [lead.decision_maker_name, lead.decision_maker_title]
                        .filter(Boolean)
                        .join(", ")
                    : "—"
                }
              />
              <StatRow
                label="Verification"
                value={<Badge tone={verification.tone}>{verification.label}</Badge>}
              />
            </dl>
          </Group>
          <Group title="Business email on the website">
            <FindingList items={sections.emails} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Phone on the website">
            <FindingList items={sections.phones} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Contact page">
            <FindingList items={sections.contactPages} empty={empty} timezone={timezone} />
          </Group>
        </Section>

        <Section
          title="Website and business description"
          description="Confirmed only when quoted from the company's own site"
          icon={Globe}
          kind="confirmed"
        >
          <dl className="divide-y divide-line">
            <StatRow
              label="Website (imported)"
              value={
                site ? (
                  <a
                    href={site}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-accent hover:underline"
                  >
                    {displayHost(lead.website)}
                  </a>
                ) : (
                  dash(lead.website)
                )
              }
            />
          </dl>
          <Group title="Business description">
            <FindingList items={sections.descriptions} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Company name on the website">
            <FindingList items={sections.companyNames} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Industry">
            <FindingList items={sections.industries} empty={empty} timezone={timezone} />
          </Group>
          {sections.websites.length > 0 ? (
            <Group title="Website address">
              <FindingList items={sections.websites} empty={empty} timezone={timezone} />
            </Group>
          ) : null}
        </Section>

        <Section
          title="Services offered"
          description="Imported services, and services found on the website"
          icon={Wrench}
        >
          <Group title="Imported">
            <p className="text-sm whitespace-pre-wrap text-fg-secondary">
              {lead.services?.trim() || "No services in the imported file."}
            </p>
          </Group>
          <Group title="Found on the website">
            <FindingList items={sections.services} empty={empty} timezone={timezone} />
          </Group>
        </Section>

        <Section
          title="Products"
          description="Products, listings or menu items found on the website"
          icon={Package}
          kind="confirmed"
        >
          <FindingList items={sections.products} empty={empty} timezone={timezone} />
        </Section>

        <Section
          title="Address, locations and service areas"
          description="Where the company says it is and where it works"
          icon={MapPin}
          kind="confirmed"
        >
          <Group title="Address">
            <FindingList items={sections.addresses} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Locations">
            <FindingList items={sections.locations} empty={empty} timezone={timezone} />
          </Group>
          <Group title="Service areas">
            <FindingList items={sections.serviceAreas} empty={empty} timezone={timezone} />
          </Group>
        </Section>

        <Section
          title="Public social profiles"
          description="Confirmed only when linked from the company's own website"
          icon={Share2}
          kind="confirmed"
        >
          <FindingList items={sections.socialProfiles} empty={empty} timezone={timezone} />
        </Section>

        <Section title="Lead qualification and scoring" icon={Gauge}>
          <dl className="divide-y divide-line">
            <StatRow
              label="Qualification"
              value={QUALIFICATION[lead.qualification_status] ?? lead.qualification_status}
            />
            <StatRow label="Lead score" value={lead.lead_score ?? "Not scored"} />
          </dl>
          {lead.lead_score_reason ? (
            <p className="mt-3 text-xs whitespace-pre-wrap text-fg-secondary">
              {lead.lead_score_reason}
            </p>
          ) : null}
        </Section>

        <Section title="Business observations and insights" icon={Lightbulb} kind="ai">
          <AssessmentList
            items={[...sections.summary, ...sections.observations]}
            empty="AI analysis isn't available yet, so no assessment has been made."
          />
        </Section>

        <Section title="Potential challenges and opportunities" icon={Target} kind="ai">
          <AssessmentList
            items={[...sections.challenges, ...sections.opportunities]}
            empty="AI analysis isn't available yet, so no assessment has been made."
          />
        </Section>
      </div>

      {sections.other.length > 0 ? (
        <Section
          title="Other findings"
          description="Stored findings this page has no dedicated section for"
          icon={FileSearch}
        >
          <FindingList items={sections.other} empty={empty} timezone={timezone} />
        </Section>
      ) : null}

      {selected ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
          <Section
            title="Warnings and missing information"
            description="What the research couldn't read or didn't find"
            icon={ListChecks}
          >
            <ResearchNotes
              warnings={selected.warnings}
              missing={selected.missing}
              showMissing={showsFindings}
              notFoundText={emptyResultsText({ runStatus: selected.run.status, active: false })}
            />
          </Section>
          <Section
            title="Pages researched"
            description="The pages this run read. Their stored text is private and is not shown."
            icon={FileText}
          >
            {selected.sources.length > 0 ? (
              <PagesResearched sources={selected.sources} timezone={timezone} />
            ) : (
              <p className="text-xs text-fg-muted">No pages were saved for this run.</p>
            )}
          </Section>
        </div>
      ) : null}

      <Section
        title="Source evidence"
        description="The import rows this company came from"
        icon={FileSpreadsheet}
      >
        {provenance.length === 0 ? (
          <EmptyState compact title="No import rows linked to this company" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table
              className="w-full min-w-[560px] text-left text-xs"
              data-testid="provenance-table"
            >
              <thead className="bg-elevated text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Worksheet</th>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Imported</th>
                </tr>
              </thead>
              <tbody>
                {provenance.map((p) => (
                  <tr key={p.rowId} className="border-t border-line">
                    <td className="max-w-72 truncate px-3 py-2">
                      <Link href={`/imports/${p.importId}`} className="text-accent hover:underline">
                        {p.fileName ?? "Import"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{p.sheetName ?? "—"}</td>
                    <td className="tabular px-3 py-2 text-fg-secondary">{p.rowNumber}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                      {formatDateTime(p.importedAt, timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Research history"
        description="Every research run is kept as a dated snapshot"
        icon={History}
      >
        <ResearchHistory
          runs={runs}
          selectedRunId={selected?.run.id ?? null}
          leadId={lead.id}
          timezone={timezone}
        />
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <Section title="Proposal history" icon={FileText}>
          <NotBuilt module="proposals" />
        </Section>
        <Section title="Outreach and communication history" icon={Send}>
          <NotBuilt module="outreach" />
        </Section>
        <Section title="Meeting history" icon={CalendarCheck}>
          <NotBuilt module="meetings" />
        </Section>
        <Section title="Meeting preparation" icon={ClipboardList} kind="ai">
          <NotBuilt module="meeting preparation" />
        </Section>
      </div>
    </div>
  );
}
