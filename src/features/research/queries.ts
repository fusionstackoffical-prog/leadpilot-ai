import "server-only";
import { sanitizeSearch } from "@/features/leads/search";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export const RESEARCH_PAGE_SIZE = 50;

export type ResearchCompany = Pick<
  Tables<"leads">,
  | "id"
  | "company_name"
  | "website"
  | "city"
  | "state"
  | "lead_score"
  | "qualification_status"
  | "discovered_at"
>;

/**
 * Companies in the workspace for the Company Research list. A company is a non-suppressed
 * lead (docs/COMPANY_RESEARCH_SPEC.md §2); RLS also restricts rows to the caller's workspaces.
 */
export async function listResearchCompanies(workspaceId: string, { q = "", page = 1 } = {}) {
  const supabase = await createClient();
  const from = (page - 1) * RESEARCH_PAGE_SIZE;
  let query = supabase
    .from("leads")
    .select(
      "id, company_name, website, city, state, lead_score, qualification_status, discovered_at",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .eq("suppressed", false);
  const term = sanitizeSearch(q);
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `company_name.ilike.${like},website.ilike.${like},business_email.ilike.${like},city.ilike.${like},phone.ilike.${like}`,
    );
  }
  const { data, error, count } = await query
    .order("company_name")
    .order("id")
    .range(from, from + RESEARCH_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load companies: ${error.message}`);
  return { companies: (data ?? []) as ResearchCompany[], total: count ?? 0 };
}

export type CompanyProfileLead = Omit<
  Tables<"leads">,
  | "normalized_city"
  | "normalized_company_name"
  | "normalized_domain"
  | "normalized_email"
  | "normalized_phone"
  | "normalized_state"
>;

export type ImportProvenance = {
  rowId: string;
  rowNumber: number;
  importId: string;
  fileName: string | null;
  sheetName: string | null;
  importedAt: string | null;
};

/**
 * One company and the import rows it came from. Returns null when the lead does not exist or
 * belongs to another workspace (RLS hides it), which the page turns into a 404.
 */
export async function getCompanyProfile(workspaceId: string, leadId: string) {
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      "id, workspace_id, company_name, website, business_email, phone, address, city, state, postal_code, country, services, decision_maker_name, decision_maker_title, notes, source_url, source_name, source_import_id, lead_score, lead_score_reason, qualification_status, verification_status, suppressed, discovered_at, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`Could not load company: ${error.message}`);
  if (!lead) return null;

  const { data: rows, error: rowsError } = await supabase
    .from("import_rows")
    .select("id, row_number, import_id, sheet_id")
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("created_at")
    .limit(50);
  if (rowsError) throw new Error(`Could not load import history: ${rowsError.message}`);

  const importIds = [...new Set((rows ?? []).map((r) => r.import_id))];
  const sheetIds = [...new Set((rows ?? []).map((r) => r.sheet_id))];
  const [imports, sheets] = importIds.length
    ? await Promise.all([
        supabase
          .from("excel_imports")
          .select("id, file_name, completed_at")
          .eq("workspace_id", workspaceId)
          .in("id", importIds),
        supabase
          .from("excel_import_sheets")
          .select("id, sheet_name")
          .eq("workspace_id", workspaceId)
          .in("id", sheetIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (imports.error) throw new Error(`Could not load imports: ${imports.error.message}`);
  if (sheets.error) throw new Error(`Could not load worksheets: ${sheets.error.message}`);

  const importById = new Map((imports.data ?? []).map((i) => [i.id, i]));
  const sheetById = new Map((sheets.data ?? []).map((s) => [s.id, s]));
  const provenance: ImportProvenance[] = (rows ?? []).map((r) => ({
    rowId: r.id,
    rowNumber: r.row_number,
    importId: r.import_id,
    fileName: importById.get(r.import_id)?.file_name ?? null,
    sheetName: sheetById.get(r.sheet_id)?.sheet_name ?? null,
    importedAt: importById.get(r.import_id)?.completed_at ?? null,
  }));

  return { lead: lead as CompanyProfileLead, provenance };
}
