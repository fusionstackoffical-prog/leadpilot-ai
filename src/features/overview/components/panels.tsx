import {
  Activity,
  ArrowRight,
  AtSign,
  BarChart3,
  CalendarClock,
  Camera,
  FileSpreadsheet,
  History,
  KanbanSquare,
  Mail,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { ScoreBandChart } from "@/components/charts/score-band-chart";
import { StatRow } from "@/components/data/stat-row";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { CHANNELS, PIPELINE_STAGES, SCORE_BANDS, type ChannelKey } from "@/lib/metrics/definitions";
import { formatCount, formatRate, formatUsd } from "@/lib/utils";
import type { ChannelTracking, OverviewData } from "../types";

function ViewLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className={buttonClasses({ variant: "ghost", size: "sm" })}>
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function formatDateTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------

export function DataInventoryPanel({
  inventory,
  timezone,
}: {
  inventory: OverviewData["inventory"];
  timezone: string;
}) {
  const n = formatCount;
  return (
    <Card>
      <CardHeader
        title="Data Inventory"
        description="How much lead data exists across all imported Excel/CSV files"
        icon={<FileSpreadsheet className="size-4" aria-hidden />}
        actions={<ViewLink href="/imports">View Excel Imports</ViewLink>}
      />
      <CardBody>
        <dl className="grid gap-x-8 divide-line sm:grid-cols-2 [&>div]:border-b [&>div]:border-line">
          <StatRow label="Files imported" value={n(inventory.filesImported)} />
          <StatRow label="Worksheets parsed" value={n(inventory.worksheets)} />
          <StatRow
            label="Total data rows"
            hint="all imports, excl. headers"
            value={n(inventory.rowsAllTime)}
            emphasis
          />
          <StatRow label="Rows in active dataset" value={n(inventory.rowsActive)} />
          <StatRow label="Distinct companies" value={n(inventory.uniqueCompanies)} emphasis />
          <StatRow label="Duplicate rows detected" value={n(inventory.duplicateRows)} />
          <StatRow label="Missing company name" value={n(inventory.missingCompanyName)} />
          <StatRow label="Missing website" value={n(inventory.missingWebsite)} />
          <StatRow label="Missing email" value={n(inventory.missingEmail)} />
          <StatRow label="Missing phone" value={n(inventory.missingPhone)} />
          <StatRow
            label="Verified business emails"
            hint="verifier ran and passed"
            value={n(inventory.verifiedEmails)}
          />
          <StatRow label="Failed / needs review" value={n(inventory.rowsNeedingReview)} />
        </dl>
        <p className="mt-3 text-[11px] text-fg-muted">
          Last successful import:{" "}
          <span className="text-fg-secondary">
            {inventory.lastImportAt ? formatDateTime(inventory.lastImportAt, timezone) : "Never"}
          </span>
        </p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const CHANNEL_ICONS: Record<ChannelKey, LucideIcon> = {
  email: Mail,
  linkedin: AtSign,
  instagram: Camera,
};

const TRACKING_LABEL: Record<
  ChannelTracking,
  { label: string; tone: "info" | "neutral" | "success" }
> = {
  api: { label: "Connected", tone: "success" },
  manual: { label: "Manually tracked", tone: "info" },
  unavailable: { label: "Unavailable", tone: "neutral" },
};

export function ChannelPerformancePanel({ channels }: { channels: OverviewData["channels"] }) {
  return (
    <Card>
      <CardHeader
        title="Channel Performance"
        description="Rates use unique contacted prospects, not message count"
        icon={<BarChart3 className="size-4" aria-hidden />}
      />
      <CardBody className="space-y-2.5">
        {CHANNELS.map((channel) => {
          const stats = channels[channel.key];
          const Icon = CHANNEL_ICONS[channel.key];
          const tracking = TRACKING_LABEL[stats.tracking];
          const replyRate = formatRate(stats.replied, stats.prospectsContacted);
          const positiveRate = formatRate(stats.positive, stats.prospectsContacted);

          return (
            <div key={channel.key} className="rounded-lg border border-line bg-app/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Icon className="size-4 text-fg-muted" aria-hidden />
                  {channel.label}
                </span>
                <Badge tone={tracking.tone}>{tracking.label}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Contacted", formatCount(stats.prospectsContacted)],
                  ["Sent", formatCount(stats.sent)],
                  ["Failed", formatCount(stats.failed)],
                  ["Replies", formatCount(stats.replied)],
                  ["Positive", formatCount(stats.positive)],
                  ["Meetings", formatCount(stats.meetings)],
                  ["Reply rate", replyRate ?? "—"],
                  ["Positive rate", positiveRate ?? "—"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dd className="tabular text-sm font-medium text-fg">{value}</dd>
                    <dt className="text-[10px] text-fg-muted">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
        <p className="text-[11px] text-fg-muted">
          No channel is connected to a sending or reply-sync provider yet. Activity will come from
          manually logged sends and replies. “—” means no prospects have been contacted.
        </p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function LeadQualificationPanel({
  scoreBands,
  notScored,
}: {
  scoreBands: OverviewData["scoreBands"];
  notScored: number;
}) {
  const bands = SCORE_BANDS.map((band) => ({
    label: band.label,
    range: band.range,
    count: scoreBands[band.key],
  }));
  const scoredTotal = bands.reduce((sum, band) => sum + band.count, 0);

  return (
    <Card>
      <CardHeader
        title="Lead Qualification"
        description="Leads by AI fit-score band"
        icon={<BarChart3 className="size-4" aria-hidden />}
      />
      <CardBody>
        {scoredTotal === 0 ? (
          <EmptyState
            compact
            icon={BarChart3}
            title="No scored leads yet"
            description="Leads are grouped into fit bands once scoring runs. Unscored leads are never counted as zero."
          />
        ) : (
          <ScoreBandChart bands={bands} />
        )}
        <ul className="mt-3 grid grid-cols-2 gap-x-6 text-xs sm:grid-cols-3">
          {bands.map((band) => (
            <li key={band.label} className="flex justify-between gap-2 py-1">
              <span className="text-fg-secondary">
                {band.label} <span className="text-fg-muted">{band.range}</span>
              </span>
              <span className="tabular text-fg">
                {formatCount(band.count)}
                <span className="ml-1 text-fg-muted">
                  {formatRate(band.count, scoredTotal) ?? ""}
                </span>
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-2 py-1">
            <span className="text-fg-secondary">Not scored</span>
            <span className="tabular text-fg">{formatCount(notScored)}</span>
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function RecentImportsPanel({
  imports,
  timezone,
}: {
  imports: OverviewData["recentImports"];
  timezone: string;
}) {
  const headers = [
    "File name",
    "Type",
    "Worksheets",
    "Rows",
    "Unique companies",
    "Duplicates",
    "Last imported",
    "Status",
  ];
  return (
    <Card>
      <CardHeader
        title="Excel Sheet Inventory"
        description="Recently imported workbooks"
        icon={<FileSpreadsheet className="size-4" aria-hidden />}
        actions={<ViewLink href="/imports">View all</ViewLink>}
      />
      <CardBody>
        {imports.length === 0 ? (
          <EmptyState
            compact
            icon={FileSpreadsheet}
            title="No files imported yet"
            description="Uploaded workbooks will be listed here with their real worksheet and row counts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-fg-muted">
                <tr className="border-b border-line">
                  {headers.map((header) => (
                    <th key={header} scope="col" className="py-2 pr-4 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0 hover:bg-hover">
                    <td className="max-w-56 truncate py-2.5 pr-4 text-fg">{row.fileName}</td>
                    <td className="py-2.5 pr-4 text-fg-secondary uppercase">{row.fileType}</td>
                    <td className="tabular py-2.5 pr-4">{formatCount(row.worksheets)}</td>
                    <td className="tabular py-2.5 pr-4">{formatCount(row.rows)}</td>
                    <td className="tabular py-2.5 pr-4">{formatCount(row.uniqueCompanies)}</td>
                    <td className="tabular py-2.5 pr-4">{formatCount(row.duplicates)}</td>
                    <td className="py-2.5 pr-4 text-fg-secondary">
                      {formatDateTime(row.importedAt, timezone)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge>{row.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function RecentActivityPanel({ activity }: { activity: OverviewData["activity"] }) {
  return (
    <Card>
      <CardHeader
        title="Recent Activity"
        description="Real system events, newest first"
        icon={<History className="size-4" aria-hidden />}
      />
      <CardBody>
        {activity.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No activity yet"
            description="Imports, approvals, sends, replies and deal changes will appear here as they happen."
          />
        ) : (
          <ol className="space-y-3">
            {activity.map((event) => (
              <li key={event.id} className="text-xs">
                <p className="text-fg">{event.summary}</p>
                <time dateTime={event.at} className="text-fg-muted">
                  {event.at}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function FollowUpsPanel({ followUps }: { followUps: OverviewData["followUps"] }) {
  const total = followUps.dueToday + followUps.overdue + followUps.upcoming;
  return (
    <Card>
      <CardHeader
        title="Follow-ups Due"
        icon={<CalendarClock className="size-4" aria-hidden />}
        actions={<ViewLink href="/follow-ups">Open</ViewLink>}
      />
      <CardBody>
        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Due today", followUps.dueToday, "text-warning"],
            ["Overdue", followUps.overdue, "text-danger"],
            ["Upcoming", followUps.upcoming, "text-info"],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-lg border border-line bg-app/40 p-3">
              <dd className={`tabular text-xl font-semibold ${value ? color : "text-fg"}`}>
                {formatCount(Number(value))}
              </dd>
              <dt className="text-[11px] text-fg-muted">{label}</dt>
            </div>
          ))}
        </dl>
        {total === 0 ? (
          <p className="mt-3 text-xs text-fg-muted">
            No follow-up tasks yet. Nothing is ever sent automatically.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function AutomationHealthPanel({
  automations,
}: {
  automations: OverviewData["automations"];
}) {
  return (
    <Card>
      <CardHeader
        title="Automation Health"
        icon={<Workflow className="size-4" aria-hidden />}
        actions={<ViewLink href="/automation">Logs</ViewLink>}
      />
      <CardBody>
        {automations.length === 0 ? (
          <EmptyState
            compact
            icon={Activity}
            title="No workflows configured"
            description="Background automation (n8n) is not connected. Health appears only after real runs are recorded."
          />
        ) : (
          <ul className="divide-y divide-line">
            {automations.map((run) => (
              <li key={run.workflow} className="flex items-center justify-between py-2 text-xs">
                <span className="text-fg">{run.workflow}</span>
                <Badge
                  tone={
                    run.lastResult === "success"
                      ? "success"
                      : run.lastResult === "failed"
                        ? "danger"
                        : "warning"
                  }
                >
                  {run.lastResult ?? "No runs"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function PipelineSummaryPanel({ pipeline }: { pipeline: OverviewData["pipeline"] }) {
  const max = Math.max(1, ...Object.values(pipeline.stages));
  const avgWon = pipeline.wonCount > 0 ? formatUsd(pipeline.wonDealValue / pipeline.wonCount) : "—";

  return (
    <Card>
      <CardHeader
        title="Sales Pipeline"
        description="Estimated pipeline value is never counted as revenue"
        icon={<KanbanSquare className="size-4" aria-hidden />}
        actions={<ViewLink href="/pipeline">Open pipeline</ViewLink>}
      />
      <CardBody className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <ul className="space-y-1.5">
          {PIPELINE_STAGES.map((stage) => {
            const count = pipeline.stages[stage.key];
            return (
              <li key={stage.key} className="grid grid-cols-[130px_1fr_40px] items-center gap-3">
                <span className="truncate text-xs text-fg-secondary">{stage.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-elevated">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </span>
                <span className="tabular text-right text-xs text-fg">{formatCount(count)}</span>
              </li>
            );
          })}
        </ul>
        <dl className="divide-y divide-line self-start rounded-lg border border-line bg-app/40 px-3">
          <StatRow label="Pipeline value (estimated)" value={formatUsd(pipeline.pipelineValue)} />
          <StatRow label="Won deal value" value={formatUsd(pipeline.wonDealValue)} emphasis />
          <StatRow label="Average won deal" value={avgWon} />
          <StatRow
            label="Won / lost (period)"
            value={`${pipeline.wonCount} / ${pipeline.lostCount}`}
          />
          <StatRow
            label="Received revenue"
            value={
              pipeline.receivedRevenue === null ? (
                <span className="text-xs text-fg-muted">Not tracked</span>
              ) : (
                formatUsd(pipeline.receivedRevenue)
              )
            }
          />
        </dl>
      </CardBody>
    </Card>
  );
}
