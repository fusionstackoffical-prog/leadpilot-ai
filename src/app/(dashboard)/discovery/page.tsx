import { Search } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Lead Discovery" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={Search}
      title="No discovery provider configured"
      description="Leads are acquired through Excel/CSV imports for now. Automated discovery will only run against an authorized, permitted data source once one is configured."
      phase="a later phase (after a data provider is selected)"
    />
  );
}
