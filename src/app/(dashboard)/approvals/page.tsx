import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export const metadata: Metadata = { title: "Approval Queue" };

export default function Page() {
  return (
    <SectionPlaceholder
      icon={CheckSquare}
      title="Nothing awaiting approval"
      description="Every draft message must be explicitly approved here before it can be sent. Editing an approved draft returns it to review."
      phase="Phase 3"
    />
  );
}
