"use client";

import { CalendarRange, Download, Loader2, MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DATE_RANGES, type DateRangeKey } from "@/lib/metrics/definitions";
import { cn } from "@/lib/utils";

export function OverviewFilters({
  range,
  periodSpan,
  zone,
  generatedAt,
  timezone,
  canExport,
}: {
  range: DateRangeKey;
  /** Calendar span of the server-resolved range, e.g. "Oct 3 – Nov 1, 2026". */
  periodSpan: string;
  /** Reporting timezone abbreviation, e.g. "EST". */
  zone: string;
  generatedAt: string;
  timezone: string;
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Highlight the clicked range immediately; the server render confirms it.
  const [selected, setSelected] = useOptimistic(range);

  function selectRange(key: DateRangeKey) {
    if (key === selected) return;
    const params = new URLSearchParams(searchParams);
    params.set("range", key);
    startTransition(() => {
      setSelected(key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  const updated = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(generatedAt));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Date range"
        aria-busy={pending}
        className="flex flex-wrap gap-0.5 rounded-md border border-line bg-card p-0.5"
      >
        {DATE_RANGES.map((option) => {
          const active = selected === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => selectRange(option.key)}
              className={cn(
                "h-8 touch-manipulation rounded border px-2.5 text-xs transition-colors",
                active
                  ? "border-accent/40 bg-accent-soft font-medium text-accent"
                  : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <span
        data-testid="range-dates"
        className="flex h-8 items-center gap-1.5 text-xs text-fg-secondary"
        title={`Reporting timezone: ${timezone}`}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
        ) : (
          <CalendarRange className="size-3.5 text-fg-muted" aria-hidden />
        )}
        <span className={cn(pending && "opacity-60")}>
          {periodSpan} <span className="text-fg-muted">({zone})</span>
        </span>
      </span>

      <span className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-xs text-fg-secondary">
        <MapPin className="size-3.5 text-fg-muted" aria-hidden />
        United States · All states
      </span>

      <Button
        size="sm"
        disabled={!canExport}
        title={canExport ? undefined : "CSV export isn't available yet"}
      >
        <Download className="size-3.5" aria-hidden />
        Export CSV
      </Button>

      <span className="ml-auto text-[11px] text-fg-muted" aria-live="polite">
        {pending ? "Updating…" : `Updated ${updated}`}
      </span>
    </div>
  );
}
