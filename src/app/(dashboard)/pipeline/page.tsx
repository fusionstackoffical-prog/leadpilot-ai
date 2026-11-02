import { KanbanSquare } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Sales Pipeline" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={KanbanSquare}
      title="No opportunities yet"
      description="Opportunities by stage with estimated pipeline value kept separate from won deal value and received revenue."
      phase="Phase 3"
    />
  );
}
