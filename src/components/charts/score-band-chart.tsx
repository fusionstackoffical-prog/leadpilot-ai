"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount } from "@/lib/utils";
import { CHART } from "./chart-theme";

type Band = { label: string; range: string; count: number };

/** Single series (lead count), so one hue and no legend; the card title names it. */
export function ScoreBandChart({ bands }: { bands: Band[] }) {
  const total = bands.reduce((sum, band) => sum + band.count, 0);

  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bands}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          barCategoryGap={6}
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={CHART.axis}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
          />
          <YAxis
            allowDecimals={false}
            stroke={CHART.axis}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgb(255 255 255 / 0.04)" }}
            contentStyle={{
              background: CHART.tooltipBg,
              border: `1px solid ${CHART.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.text }}
            itemStyle={{ color: CHART.text }}
            formatter={(value) => {
              const count = Number(value);
              const pct = total > 0 ? ` (${((count / total) * 100).toFixed(1)}%)` : "";
              return [`${formatCount(count)}${pct}`, "Leads"];
            }}
          />
          <Bar dataKey="count" fill={CHART.series.sent} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
