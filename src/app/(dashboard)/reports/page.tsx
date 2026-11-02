import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={BarChart3}
      title="No report data yet"
      description="Filtered reports with explicit metric definitions and CSV export. Charts appear only when real data exists."
      phase="Phase 5"
    />
  );
}
