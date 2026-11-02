import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label/value line used in dense panels (inventory, pipeline summaries). */
export function StatRow({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="min-w-0 text-xs text-fg-secondary">
        {label}
        {hint ? <span className="ml-1 text-fg-muted">· {hint}</span> : null}
      </dt>
      <dd
        className={cn(
          "tabular shrink-0 text-right text-sm",
          emphasis ? "font-semibold text-fg" : "text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
