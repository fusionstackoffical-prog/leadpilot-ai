"use client";

import { LineChart as LineChartIcon } from "lucide-react";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/states";
import { cn, formatCount } from "@/lib/utils";
import { CHART } from "./chart-theme";

type Point = { date: string; sent: number; replies: number; positive: number };
type SeriesKey = "sent" | "replies" | "positive";

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "sent", label: "Messages sent", color: CHART.series.sent },
  { key: "replies", label: "Replies received", color: CHART.series.replies },
  { key: "positive", label: "Positive replies", color: CHART.series.positive },
];

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function OutreachActivityChart({ data }: { data: Point[] }) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  if (data.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="No outreach events yet"
        description="Sends and replies appear here once outreach is logged. Counts come only from saved outreach events."
        className="min-h-[260px] flex-1"
      />
    );
  }

  function toggle(key: SeriesKey) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Toggle series">
        {SERIES.map((series) => {
          const off = hidden.has(series.key);
          return (
            <button
              key={series.key}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(series.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs transition-colors hover:bg-hover",
                off ? "text-fg-muted" : "text-fg-secondary",
              )}
            >
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: off ? CHART.grid : series.color }}
                aria-hidden
              />
              {series.label}
            </button>
          );
        })}
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => dateLabel.format(new Date(value))}
              stroke={CHART.axis}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              stroke={CHART.axis}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
              contentStyle={{
                background: CHART.tooltipBg,
                border: `1px solid ${CHART.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: CHART.text, marginBottom: 4 }}
              itemStyle={{ color: CHART.text, padding: 0 }}
              labelFormatter={(value) => dateLabel.format(new Date(String(value)))}
              formatter={(value) => formatCount(Number(value))}
            />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.tooltipBg }}
                hide={hidden.has(series.key)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
