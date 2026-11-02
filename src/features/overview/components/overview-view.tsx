import {
  BadgeCheck,
  Building2,
  CalendarCheck,
  MessageSquareReply,
  Send,
  Sheet,
  Sparkles,
  ThumbsUp,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { OutreachActivityChart } from "@/components/charts/outreach-activity-chart";
import { KpiCard } from "@/components/data/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OverviewFilters } from "@/features/overview/components/overview-filters";
import {
  AutomationHealthPanel,
  ChannelPerformancePanel,
  DataInventoryPanel,
  FollowUpsPanel,
  LeadQualificationPanel,
  PipelineSummaryPanel,
  RecentActivityPanel,
  RecentImportsPanel,
} from "@/features/overview/components/panels";
import type { WorkspaceSummary } from "@/features/workspace/types";
import {
  DATE_RANGES,
  KPI_KEYS,
  METRICS,
  type DateRangeKey,
  type KpiKey,
} from "@/lib/metrics/definitions";
import { formatRangeSpan, formatZoneAbbreviation } from "@/lib/metrics/date-range";
import type { OverviewData } from "../types";

const KPI_ICONS: Record<KpiKey, LucideIcon> = {
  totalExcelRows: Sheet,
  uniqueCompanies: Building2,
  newLeadsToday: UserPlus,
  verifiedContacts: BadgeCheck,
  qualifiedLeads: Sparkles,
  messagesSent: Send,
  repliesReceived: MessageSquareReply,
  positiveReplies: ThumbsUp,
  meetingsBooked: CalendarCheck,
  dealsWon: Trophy,
};

export function OverviewView({
  data,
  workspace,
}: {
  data: OverviewData;
  workspace: WorkspaceSummary;
}) {
  const range: DateRangeKey = data.range;
  const periodLabel = DATE_RANGES.find((option) => option.key === range)?.label ?? "";
  const periodSpan = formatRangeSpan(data.period);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <OverviewFilters
        range={range}
        periodSpan={periodSpan}
        zone={formatZoneAbbreviation(data.period)}
        generatedAt={data.generatedAt}
        timezone={data.period.timeZone}
        // CSV export isn't implemented yet (roadmap step 7); never show a dead active button.
        canExport={false}
      />

      {!data.leadsEnabled && data.inventory.filesImported > 0 ? (
        <p
          role="status"
          className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info"
        >
          Imported rows are counted below, but the Lead Database hasn&apos;t been enabled yet, so
          lead metrics (unique companies, new leads, verified, qualified) show 0 until it is.
        </p>
      ) : null}

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        {KPI_KEYS.map((key) => (
          <KpiCard
            key={key}
            metric={METRICS[key]}
            value={data.kpis[key]}
            icon={KPI_ICONS[key]}
            periodLabel={key === "newLeadsToday" ? "Today" : periodLabel}
          />
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col">
          <CardHeader
            title="Outreach Activity Over Time"
            description={`Messages sent, replies and positive replies · ${periodLabel} (${periodSpan})`}
          />
          <CardBody className="flex flex-1 flex-col">
            <OutreachActivityChart data={data.outreachSeries} />
          </CardBody>
        </Card>
        <ChannelPerformancePanel channels={data.channels} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DataInventoryPanel inventory={data.inventory} timezone={workspace.timezone} />
        <LeadQualificationPanel scoreBands={data.scoreBands} notScored={data.notScored} />
      </div>

      <RecentImportsPanel imports={data.recentImports} timezone={workspace.timezone} />

      <PipelineSummaryPanel pipeline={data.pipeline} />

      <div className="grid gap-5 lg:grid-cols-3">
        <RecentActivityPanel activity={data.activity} />
        <FollowUpsPanel followUps={data.followUps} />
        <AutomationHealthPanel automations={data.automations} />
      </div>
    </div>
  );
}
