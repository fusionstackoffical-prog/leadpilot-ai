import type { BadgeTone } from "@/components/ui/badge";

/** Labels for public.leads.verification_status (check constraint in migration 008). */
export const VERIFICATION: Record<string, { label: string; tone: BadgeTone }> = {
  unverified: { label: "Unverified", tone: "neutral" },
  verified: { label: "Verified", tone: "success" },
  invalid: { label: "Invalid", tone: "danger" },
  risky: { label: "Risky", tone: "warning" },
};

/** Labels for public.leads.qualification_status (check constraint in migration 008). */
export const QUALIFICATION: Record<string, string> = {
  not_scored: "Not scored",
  qualified: "Qualified",
  not_qualified: "Not qualified",
};
