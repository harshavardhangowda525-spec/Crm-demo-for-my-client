"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const PRESETS = [
  ["day", "Daily · 30 days"],
  ["week", "Weekly · 12 weeks"],
  ["month", "Monthly · 12 months"],
] as const;

/** One filter row above the charts: granularity presets + custom date range. */
export function RangeFilter({ bucket, from, to }: { bucket: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-xl bg-white/[0.03] p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
        {PRESETS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ bucket: k, from: null, to: null })}
            className={cn(
              "focus-ring h-9 rounded-lg px-3 text-[13px] font-medium transition-colors",
              bucket === k && !sp.get("from") ? "bg-lime/15 text-lime" : "text-muted hover:text-fg",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        <input
          type="date"
          aria-label="From date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && set({ from: e.target.value })}
          className="inner-shadow h-10 rounded-lg bg-bg/70 px-2.5 text-fg outline-none"
        />
        <span>to</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && set({ to: e.target.value })}
          className="inner-shadow h-10 rounded-lg bg-bg/70 px-2.5 text-fg outline-none"
        />
      </div>
    </div>
  );
}
