import { Badge } from "@/components/ui/badge";
import { COMPANY_STATUS, RUN_STATUS, type CompanyStatus, type RunStatus } from "../status";

/** A company's headline research status. Always carries a text label, never colour alone. */
export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const { label, tone } = COMPANY_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** The status of one research run. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { label, tone } = RUN_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
