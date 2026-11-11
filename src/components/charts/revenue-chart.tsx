"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/format";

export type RevenuePoint = { bucket: string; collected_paise: number };

const fmtTick = (iso: string, bucket: string) => {
  const d = new Date(iso + "T00:00:00Z");
  if (bucket === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};

const compact = (paise: number) => {
  const r = paise / 100;
  if (r >= 100000) return `₹${(r / 100000).toFixed(r >= 1000000 ? 0 : 1)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
};

/** Collected revenue (recorded payments only) — one series, crosshair tooltip. */
export default function RevenueChart({ data, bucket }: { data: RevenuePoint[]; bucket: "day" | "week" | "month" }) {
  const total = data.reduce((s, d) => s + d.collected_paise, 0);
  if (total === 0) {
    return <div className="grid h-64 place-items-center text-sm text-muted">No payments recorded in this period.</div>;
  }
  return (
    <div className="h-64 w-full md:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C6FF45" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#C6FF45" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="bucket"
            tickFormatter={(v) => fmtTick(v, bucket)}
            tick={{ fill: "#929CAC", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis tickFormatter={compact} tick={{ fill: "#929CAC", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={{ stroke: "rgba(245,247,250,0.35)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as RevenuePoint;
              return (
                <div className="rounded-xl bg-[#192130] px-3 py-2 text-xs shadow-[0_8px_24px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
                  <p className="text-muted">
                    {bucket === "week" ? "Week of " : ""}
                    {fmtTick(p.bucket, bucket)}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-fg">{formatINR(p.collected_paise)}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="collected_paise"
            stroke="#C6FF45"
            strokeWidth={2}
            fill="url(#rev-fill)"
            activeDot={{ r: 5, stroke: "#111722", strokeWidth: 2, fill: "#C6FF45" }}
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
