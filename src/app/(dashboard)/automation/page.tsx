import { Activity } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Automation Logs" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={Activity}
      title="No automation runs recorded"
      description="n8n workflow runs, outcomes and errors will be listed here once background automation is connected."
      phase="Phase 6"
    />
  );
}
