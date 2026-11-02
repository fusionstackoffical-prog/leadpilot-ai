import { Send } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Outreach" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={Send}
      title="No campaigns or outreach events yet"
      description="Campaigns and a complete log of every send attempt and reply. Sends are logged manually until an email provider is connected."
      phase="Phase 3"
    />
  );
}
