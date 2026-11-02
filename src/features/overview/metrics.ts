/**
 * Counting rules for Overview metrics that come from imports and leads. Pure, so
 * they are unit-tested; queries.ts supplies the database rows. Definitions match
 * src/lib/metrics/definitions.ts (spec §17):
 *
 * - Total Records in Excel Sheets: data rows read by every finished import
 *   (completed / completed_with_errors), headers excluded. Re-importing a file adds
 *   its rows again by definition ("every data row ever imported").
 * - Unique Companies / New Leads Today / Verified / Qualified: from the leads table
 *   (public.lead_overview_metrics). Invalid and duplicate rows never become leads,
 *   and re-imported rows link to existing leads, so they don't inflate these.
 * - Verified and Qualified count only leads whose verification/scoring actually
 *   set them; imported leads start unverified and not scored.
 */

export const FINISHED_IMPORT_STATUSES = ["completed", "completed_with_errors"] as const;

export type FinishedImport = {
  id: string;
  file_name: string;
  file_type: string;
  status: string;
  worksheet_count: number;
  rows_read: number;
  invalid_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  completed_at: string | null;
  created_at: string;
};

export type LeadMetrics = {
  total_leads: number;
  unique_companies: number;
  new_leads: number;
  verified_contacts: number;
  qualified_leads: number;
};

export type RowQualityCounts = {
  missingCompanyName: number;
  missingWebsite: number;
  missingEmail: number;
  missingPhone: number;
};

export const acceptedRowCount = (i: FinishedImport) =>
  Math.max(0, i.rows_read - i.invalid_rows - i.duplicate_rows - i.failed_rows);

export function summarizeImports(
  imports: FinishedImport[],
  quality: RowQualityCounts,
  leads: LeadMetrics | null,
) {
  const sum = (pick: (i: FinishedImport) => number) =>
    imports.reduce((total, i) => total + pick(i), 0);
  const lastImportAt =
    imports
      .map((i) => i.completed_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  return {
    totalExcelRows: sum((i) => i.rows_read),
    inventory: {
      filesImported: imports.length,
      worksheets: sum((i) => i.worksheet_count),
      rowsAllTime: sum((i) => i.rows_read),
      // Active dataset = de-duplicated leads. Summing accepted rows across imports
      // would double-count re-imported files, so it stays 0 without a lead database.
      rowsActive: leads?.total_leads ?? 0,
      uniqueCompanies: leads?.unique_companies ?? 0,
      duplicateRows: sum((i) => i.duplicate_rows),
      missingCompanyName: quality.missingCompanyName,
      missingWebsite: quality.missingWebsite,
      missingEmail: quality.missingEmail,
      missingPhone: quality.missingPhone,
      verifiedEmails: leads?.verified_contacts ?? 0,
      rowsNeedingReview: sum((i) => i.invalid_rows + i.failed_rows),
      lastImportAt,
    },
    recentImports: [...imports]
      .sort((a, b) =>
        (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at),
      )
      .slice(0, 5)
      .map((i) => ({
        id: i.id,
        fileName: i.file_name,
        fileType: i.file_type,
        worksheets: i.worksheet_count,
        rows: i.rows_read,
        // Rows left after in-file duplicates and invalid rows: distinct company identities in the file.
        uniqueCompanies: acceptedRowCount(i),
        duplicates: i.duplicate_rows,
        importedAt: i.completed_at ?? i.created_at,
        status: i.status === "completed" ? "Completed" : "Completed with errors",
      })),
  };
}

/** PostgREST errors meaning a table/function doesn't exist yet (migration not applied). */
export function isMissingRelation(error: { code?: string } | null | undefined) {
  return ["PGRST202", "PGRST205", "42P01", "42883"].includes(error?.code ?? "");
}
