import { cn } from "@/lib/utils";

/**
 * Part-to-whole as labelled horizontal bars (plan names are written beside
 * each bar, so identity never depends on colour).
 */
export function BarList({
  items,
  valueLabel = (n: number) => n.toLocaleString("en-IN"),
  emptyText = "No data yet.",
  tone = "lime",
}: {
  items: { label: string; value: number }[];
  valueLabel?: (n: number) => string;
  emptyText?: string;
  tone?: "lime" | "cyan";
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length || total === 0) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-3.5">
      {items.map((it) => {
        const pct = Math.round((it.value / total) * 100);
        return (
          <li key={it.label} title={`${it.label}: ${valueLabel(it.value)} (${pct}%)`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg">{it.label}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {valueLabel(it.value)} · {pct}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]", tone === "lime" ? "bg-lime" : "bg-cyan")}
                style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
