import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gauge,
  Globe,
  History,
  Lightbulb,
  Microscope,
  Phone,
  Send,
  Share2,
  Target,
  Wrench,
  type LucideIcon,
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
import type { CompanyProfileLead, ImportProvenance } from "../queries";

/** What kind of information a value or section holds (docs/COMPANY_RESEARCH_SPEC.md §3). */
type Provenance = "imported" | "confirmed" | "ai";

const PROVENANCE: Record<Provenance, { label: string; tone: "neutral" | "success" | "info" }> = {
  imported: { label: "Imported · unverified", tone: "neutral" },
  // Describes what the section accepts, so it stays neutral: it must never read as if the
  // values currently shown (e.g. an imported website) were confirmed.
  confirmed: { label: "Source-backed facts only", tone: "neutral" },
  ai: { label: "AI assessment · not fact", tone: "info" },
};

function ProvenanceBadge({ kind }: { kind: Provenance }) {
  return <Badge tone={PROVENANCE[kind].tone}>{PROVENANCE[kind].label}</Badge>;
}

function Section({
  title,
  description,
  icon: Icon,
  kind,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  kind?: Provenance;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        description={description}
        icon={<Icon className="size-4" aria-hidden />}
        actions={kind ? <ProvenanceBadge kind={kind} /> : undefined}
      />
      <CardBody className="flex-1">{children}</CardBody>
    </Card>
  );
}

function NotResearched({ what }: { what: string }) {
  return (
    <EmptyState
      compact
      icon={Microscope}
      title="Not researched yet"
      description={`${what} will appear here after this company is researched. Nothing has been looked up or inferred.`}
    />
  );
}

function NotBuilt({ module }: { module: string }) {
  return (
    <EmptyState
      compact
      title="No records"
      description={`The ${module} module isn't built yet. Records will appear here once it is.`}
    />
  );
}

const dash = (value: string | null) => value?.trim() || "—";

export function CompanyProfile({
  lead,
  provenance,
  timezone,
}: {
  lead: CompanyProfileLead;
  provenance: ImportProvenance[];
  timezone: string;
}) {
  const site = safeExternalUrl(lead.website);
  const verification = VERIFICATION[lead.verification_status] ?? VERIFICATION.unverified;
  const location = [lead.city, lead.state].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
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
            <Badge tone="neutral">Not researched</Badge>
            <Badge tone={verification.tone}>{verification.label}</Badge>
            <Badge tone="neutral">
              {QUALIFICATION[lead.qualification_status] ?? lead.qualification_status}
            </Badge>
            {lead.suppressed ? <Badge tone="danger">Suppressed</Badge> : null}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
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
          description="Imported values; none have been verified"
          icon={Phone}
          kind="imported"
        >
          <dl className="divide-y divide-line">
            <StatRow label="Business email" value={dash(lead.business_email)} />
            <StatRow label="Phone" value={dash(lead.phone)} />
            <StatRow
              label="Decision-maker"
              value={
                lead.decision_maker_name
                  ? [lead.decision_maker_name, lead.decision_maker_title].filter(Boolean).join(", ")
                  : "—"
              }
            />
            <StatRow
              label="Verification"
              value={<Badge tone={verification.tone}>{verification.label}</Badge>}
            />
          </dl>
        </Section>

        <Section
          title="Website and business description"
          description="Description is confirmed only when quoted from the company's own site"
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
          <div className="mt-3">
            <NotResearched what="The business description" />
          </div>
        </Section>

        <Section
          title="Services offered"
          description="Imported services, and services confirmed on the website"
          icon={Wrench}
        >
          <p className="mb-1 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
            Imported
          </p>
          <p className="text-sm whitespace-pre-wrap text-fg-secondary">
            {lead.services?.trim() || "No services in the imported file."}
          </p>
          <div className="mt-3">
            <NotResearched what="Services confirmed on the website" />
          </div>
        </Section>

        <Section
          title="Public social profiles"
          description="Confirmed only when linked from the company's own website"
          icon={Share2}
          kind="confirmed"
        >
          <NotResearched what="Social profiles" />
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
          <NotResearched what="Observations" />
        </Section>

        <Section title="Potential challenges and opportunities" icon={Target} kind="ai">
          <NotResearched what="Challenges and opportunities" />
        </Section>
      </div>

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
        <EmptyState
          compact
          icon={History}
          title="No research runs yet"
          description="Automated research isn't available yet. Earlier results will never be overwritten when it is."
        />
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
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
