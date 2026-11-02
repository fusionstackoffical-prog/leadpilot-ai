import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelation } from "@/features/overview/metrics";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "./search";

export type LeadRow = {
  id: string;
  company_name: string;
  website: string | null;
  business_email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  source_name: string | null;
  source_import_id: string | null;
  verification_status: string;
  qualification_status: string;
  discovered_at: string;
};

export const LEADS_PAGE_SIZE = 50;

/**
 * Leads for the workspace (RLS also restricts to the caller's workspaces).
 * `enabled` is false until the leads table exists (migration 008).
 */
export async function listLeads(workspaceId: string, { q = "", page = 1 } = {}) {
  const supabase = await createClient();
  // Not in the generated types until migration 008 is applied and types are regenerated.
  const untyped = supabase as unknown as SupabaseClient;
  const from = (page - 1) * LEADS_PAGE_SIZE;
  let query = untyped
    .from("leads")
    .select(
      "id, company_name, website, business_email, phone, city, state, source_name, source_import_id, verification_status, qualification_status, discovered_at",
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
    .order("discovered_at", { ascending: false })
    .order("company_name")
    .range(from, from + LEADS_PAGE_SIZE - 1);
  if (isMissingRelation(error)) return { enabled: false, leads: [] as LeadRow[], total: 0 };
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return { enabled: true, leads: (data ?? []) as LeadRow[], total: count ?? 0 };
}
