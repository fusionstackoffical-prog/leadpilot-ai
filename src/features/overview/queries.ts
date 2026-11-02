import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANNELS,
  KPI_KEYS,
  PIPELINE_STAGES,
  SCORE_BANDS,
  type DateRangeKey,
} from "@/lib/metrics/definitions";
import { DEFAULT_REPORTING_TIMEZONE, getDateRangeBounds } from "@/lib/metrics/date-range";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceSummary } from "@/features/workspace/types";
import {
  FINISHED_IMPORT_STATUSES,
  isMissingRelation,
  summarizeImports,
  type FinishedImport,
  type LeadMetrics,
  type RowQualityCounts,
} from "./metrics";
import type { OverviewData } from "./types";

function zeros<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

const ACCEPTED_ROW_STATUSES = ["valid", "imported"];
// jsonb containment must be sent as a JSON string; supabase-js would encode an
// array as a Postgres array literal, which PostgREST rejects for jsonb.
const MISSING_COMPANY_ISSUE = JSON.stringify([{ code: "missing_company_name" }]);

/**
 * Overview metrics for a workspace, from real records only. Every query runs as
 * the signed-in user (RLS) and is scoped to the workspace explicitly.
 *
 * Imports/inventory come from excel_imports + import_rows. Lead KPIs come from
 * public.lead_overview_metrics() (migration 008); until that exists they are 0
 * and `leadsEnabled` is false. Outreach, follow-ups, pipeline and automation have
 * no tables yet, so they are genuinely empty.
 */
export async function getOverviewData(
  workspace: WorkspaceSummary,
  range: DateRangeKey,
): Promise<OverviewData> {
  const timeZone = workspace.timezone || DEFAULT_REPORTING_TIMEZONE;
  const period = getDateRangeBounds(range, timeZone);
  const today = getDateRangeBounds("today", timeZone);
  const supabase = await createClient();

  const { data: importData, error: importError } = await supabase
    .from("excel_imports")
    .select(
      "id, file_name, file_type, status, worksheet_count, rows_read, invalid_rows, duplicate_rows, failed_rows, completed_at, created_at",
    )
    .eq("workspace_id", workspace.id)
    .in("status", [...FINISHED_IMPORT_STATUSES]);
  if (importError) throw new Error(`Could not load imports: ${importError.message}`);
  const imports = (importData ?? []) as FinishedImport[];

  const [quality, leads] = await Promise.all([
    rowQuality(supabase, workspace.id, imports),
    leadMetrics(supabase, workspace.id, today.start, today.end),
  ]);
  const summary = summarizeImports(imports, quality, leads.metrics);

  const kpis = zeros(KPI_KEYS);
  kpis.totalExcelRows = summary.totalExcelRows;
  kpis.uniqueCompanies = leads.metrics?.unique_companies ?? 0;
  kpis.newLeadsToday = leads.metrics?.new_leads ?? 0;
  kpis.verifiedContacts = leads.metrics?.verified_contacts ?? 0;
  kpis.qualifiedLeads = leads.metrics?.qualified_leads ?? 0;

  return {
    range,
    period,
    generatedAt: new Date().toISOString(),
    leadsEnabled: leads.enabled,
    kpis,
    outreachSeries: [],
    inventory: summary.inventory,
    recentImports: summary.recentImports,
    // Email sending is manual for the MVP; no social integrations are authorized.
    channels: Object.fromEntries(
      CHANNELS.map((channel) => [
        channel.key,
        {
          tracking: "manual",
          prospectsContacted: 0,
          sent: 0,
          failed: 0,
          replied: 0,
          positive: 0,
          meetings: 0,
        },
      ]),
    ) as OverviewData["channels"],
    scoreBands: zeros(SCORE_BANDS.map((band) => band.key)),
    // Every lead is unscored until scoring exists.
    notScored: leads.metrics?.total_leads ?? 0,
    activity: [],
    followUps: { dueToday: 0, overdue: 0, upcoming: 0 },
    automations: [],
    pipeline: {
      stages: zeros(PIPELINE_STAGES.map((stage) => stage.key)),
      pipelineValue: 0,
      wonDealValue: 0,
      wonCount: 0,
      lostCount: 0,
      receivedRevenue: null,
    },
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** Data-quality counts over rows of finished imports. */
async function rowQuality(
  supabase: Client,
  workspaceId: string,
  imports: FinishedImport[],
): Promise<RowQualityCounts> {
  if (imports.length === 0) {
    return { missingCompanyName: 0, missingWebsite: 0, missingEmail: 0, missingPhone: 0 };
  }
  const ids = imports.map((i) => i.id);
  const base = () =>
    supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("import_id", ids);
  const accepted = () => base().in("status", ACCEPTED_ROW_STATUSES);
  const results = await Promise.all([
    base().eq("status", "invalid").contains("issues", MISSING_COMPANY_ISSUE),
    accepted().is("normalized_domain", null),
    accepted().is("normalized_email", null),
    accepted().is("normalized_phone", null),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load import data quality: ${failed.error.message}`);
  const [company, website, email, phone] = results.map((r) => r.count ?? 0);
  return {
    missingCompanyName: company,
    missingWebsite: website,
    missingEmail: email,
    missingPhone: phone,
  };
}

/** Lead KPIs from the lead database; `enabled: false` until migration 008 is applied. */
async function leadMetrics(
  supabase: Client,
  workspaceId: string,
  from: string,
  to: string,
): Promise<{ enabled: boolean; metrics: LeadMetrics | null }> {
  // Not in the generated types until migration 008 is applied and types are regenerated.
  const untyped = supabase as unknown as SupabaseClient;
  const { data, error } = await untyped.rpc("lead_overview_metrics", {
    p_workspace_id: workspaceId,
    p_from: from,
    p_to: to,
  });
  if (isMissingRelation(error)) return { enabled: false, metrics: null };
  if (error) throw new Error(`Could not load lead metrics: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    Record<keyof LeadMetrics, number | string> | undefined;
  const num = (key: keyof LeadMetrics) => Number(row?.[key] ?? 0);
  return {
    enabled: true,
    metrics: {
      total_leads: num("total_leads"),
      unique_companies: num("unique_companies"),
      new_leads: num("new_leads"),
      verified_contacts: num("verified_contacts"),
      qualified_leads: num("qualified_leads"),
    },
  };
}
