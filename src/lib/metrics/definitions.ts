/**
 * Single source of truth for metric labels and definitions (spec §17).
 * UI tooltips and reports read from here; formulas live in SQL functions added per phase.
 */

export type MetricScope = "all-time" | "period";

export type MetricDefinition = {
  label: string;
  scope: MetricScope;
  definition: string;
};

export const KPI_KEYS = [
  "totalExcelRows",
  "uniqueCompanies",
  "newLeadsToday",
  "verifiedContacts",
  "qualifiedLeads",
  "messagesSent",
  "repliesReceived",
  "positiveReplies",
  "meetingsBooked",
  "dealsWon",
] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

export const METRICS: Record<KpiKey, MetricDefinition> = {
  totalExcelRows: {
    label: "Total Records in Excel Sheets",
    scope: "all-time",
    definition:
      "Every data row ever imported from Excel/CSV files, across all worksheets. Header rows are excluded. Active dataset counts are shown in Data Inventory.",
  },
  uniqueCompanies: {
    label: "Unique Companies",
    scope: "all-time",
    definition:
      "Distinct company identities in the active lead dataset after normalization and de-duplication — not the row count.",
  },
  newLeadsToday: {
    label: "New Leads Today",
    scope: "period",
    definition: "Lead records created today, using the workspace's business timezone.",
  },
  verifiedContacts: {
    label: "Verified Contacts",
    scope: "all-time",
    definition:
      "Contacts whose verification actually ran and succeeded. An email present in a spreadsheet is not counted as verified.",
  },
  qualifiedLeads: {
    label: "Qualified Leads",
    scope: "all-time",
    definition:
      "Leads at or above the configured qualification score threshold that also pass required data-quality checks.",
  },
  messagesSent: {
    label: "Total Messages Sent",
    scope: "period",
    definition:
      "Unique successful send events in the selected period. Drafts and failed attempts are excluded.",
  },
  repliesReceived: {
    label: "Replies Received",
    scope: "period",
    definition:
      "Unique inbound replies recorded from connected integrations or logged manually, without double-counting.",
  },
  positiveReplies: {
    label: "Positive Replies",
    scope: "period",
    definition: "Unique replies currently classified as positive (reviewable and correctable).",
  },
  meetingsBooked: {
    label: "Meetings Booked",
    scope: "period",
    definition: "Meetings with a confirmed booked status in the selected period.",
  },
  dealsWon: {
    label: "Deals Won",
    scope: "period",
    definition: "Sales opportunities moved to the Won stage in the selected period.",
  },
};

export const SCORE_BANDS = [
  { key: "high", label: "High fit", range: "90–100", min: 90, max: 100 },
  { key: "good", label: "Good fit", range: "70–89", min: 70, max: 89 },
  { key: "medium", label: "Medium fit", range: "50–69", min: 50, max: 69 },
  { key: "low", label: "Low fit", range: "30–49", min: 30, max: 49 },
  { key: "none", label: "Not a fit", range: "0–29", min: 0, max: 29 },
] as const;

export type ScoreBandKey = (typeof SCORE_BANDS)[number]["key"];

export const CHANNELS = [
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
] as const;

export type ChannelKey = (typeof CHANNELS)[number]["key"];

export const PIPELINE_STAGES = [
  { key: "new", label: "New" },
  { key: "qualified", label: "Qualified" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "meeting_booked", label: "Meeting booked" },
  { key: "meeting_completed", label: "Meeting completed" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "disqualified", label: "Disqualified" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];

export const DATE_RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
] as const;

export type DateRangeKey = (typeof DATE_RANGES)[number]["key"];

export function parseDateRange(value: unknown): DateRangeKey {
  return DATE_RANGES.some((range) => range.key === value) ? (value as DateRangeKey) : "30d";
}
