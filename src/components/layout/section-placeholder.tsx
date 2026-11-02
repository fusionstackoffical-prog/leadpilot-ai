import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Honest empty state for a section whose feature ships in a later phase. */
export function SectionPlaceholder({
  icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="mx-auto max-w-[1600px]">
      <Card className="p-5">
        <EmptyState
          icon={icon}
          title={title}
          description={
            <>
              <p>{description}</p>
              <p className="mt-2 text-fg-secondary">Planned for {phase}.</p>
            </>
          }
        />
      </Card>
    </div>
  );
}
