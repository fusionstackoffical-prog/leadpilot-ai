import type { LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import type { MetricDefinition } from "@/lib/metrics/definitions";
import { formatCount } from "@/lib/utils";

/**
 * KPI tile. Deliberately has no trend/delta slot until a metric has enough history
 * to compare against — a fabricated change is worse than none (spec §5.2).
 */
export function KpiCard({
  metric,
  value,
  icon: Icon,
  periodLabel,
}: {
  metric: MetricDefinition;
  value: number;
  icon: LucideIcon;
  periodLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-8 items-center justify-center rounded-md border border-line bg-elevated text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        <InfoTip label={metric.label}>{metric.definition}</InfoTip>
      </div>
      <div>
        <p className="text-xs leading-snug text-fg-secondary">{metric.label}</p>
        <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-fg">
          {formatCount(value)}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between text-[11px] text-fg-muted">
        <span>{metric.scope === "all-time" ? "All time" : periodLabel}</span>
        {value === 0 ? <span>No data yet</span> : null}
      </div>
    </div>
  );
}
