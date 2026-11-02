import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Follow-ups" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={CalendarClock}
      title="No follow-up tasks yet"
      description="Due, overdue and upcoming follow-ups. Follow-ups are never sent to suppressed or opted-out contacts."
      phase="Phase 3"
    />
  );
}
