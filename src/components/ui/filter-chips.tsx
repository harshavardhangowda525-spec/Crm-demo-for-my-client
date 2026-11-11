import Link from "next/link";
import { cn } from "@/lib/utils";

export function FilterChips({
  items,
  active,
}: {
  items: { key: string; label: string; href: string; count?: number | null }[];
  active: string;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:px-0">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={cn(
              "focus-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              on
                ? "bg-lime/12 text-lime shadow-[inset_0_0_0_1px_rgb(198_255_69/0.3)]"
                : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04] hover:text-fg",
            )}
          >
            {it.label}
            {it.count != null && (
              <span className={cn("tabular-nums text-[11px]", on ? "text-lime/80" : "text-subtle")}>{it.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
