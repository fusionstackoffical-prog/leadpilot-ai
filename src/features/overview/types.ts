import type {
  ChannelKey,
  DateRangeKey,
  KpiKey,
  PipelineStageKey,
  ScoreBandKey,
} from "@/lib/metrics/definitions";
import type { DateRangeBounds } from "@/lib/metrics/date-range";

export type ChannelTracking = "api" | "manual" | "unavailable";

export type OverviewData = {
  range: DateRangeKey;
  /** Resolved [start, end) instants for `range` in the workspace reporting timezone. */
  period: DateRangeBounds;
  generatedAt: string;
  /** False until the lead database (migration 008) exists; lead KPIs are then 0. */
  leadsEnabled: boolean;
  kpis: Record<KpiKey, number>;
  outreachSeries: { date: string; sent: number; replies: number; positive: number }[];
  inventory: {
    filesImported: number;
    worksheets: number;
    rowsAllTime: number;
    rowsActive: number;
    uniqueCompanies: number;
    duplicateRows: number;
    missingCompanyName: number;
    missingWebsite: number;
    missingEmail: number;
    missingPhone: number;
    verifiedEmails: number;
    rowsNeedingReview: number;
    lastImportAt: string | null;
  };
  recentImports: {
    id: string;
    fileName: string;
    fileType: string;
    worksheets: number;
    rows: number;
    uniqueCompanies: number;
    duplicates: number;
    importedAt: string;
    status: string;
  }[];
  channels: Record<
    ChannelKey,
    {
      tracking: ChannelTracking;
      prospectsContacted: number;
      sent: number;
      failed: number;
      replied: number;
      positive: number;
      meetings: number;
    }
  >;
  scoreBands: Record<ScoreBandKey, number>;
  notScored: number;
  activity: { id: string; type: string; summary: string; at: string; href?: string }[];
  followUps: { dueToday: number; overdue: number; upcoming: number };
  automations: {
    workflow: string;
    enabled: boolean;
    lastRunAt: string | null;
    lastResult: "success" | "failed" | "warning" | null;
    error: string | null;
  }[];
  pipeline: {
    stages: Record<PipelineStageKey, number>;
    pipelineValue: number;
    wonDealValue: number;
    wonCount: number;
    lostCount: number;
    /** Null unless payment records exist (spec §5.11). */
    receivedRevenue: number | null;
  };
};
