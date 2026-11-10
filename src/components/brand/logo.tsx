import { cn } from "@/lib/utils";

/** Muscle House monogram on a brushed-metal plate. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("metal grid size-10 shrink-0 place-items-center rounded-xl", className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-[22px]">
        <defs>
          <linearGradient id="mh-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E4FF9A" />
            <stop offset="1" stopColor="#C6FF45" />
          </linearGradient>
        </defs>
        <path
          d="M4 25V8l6 7 6-7 6 7 6-7v17"
          fill="none"
          stroke="url(#mh-g)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10 25v-5M22 25v-5" stroke="#58D9FF" strokeWidth="2.4" strokeLinecap="round" opacity=".9" />
      </svg>
    </div>
  );
}

export function Wordmark({ gymName = "Muscle House", collapsed }: { gymName?: string; collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <LogoMark />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-[15px] font-semibold tracking-tight text-fg">{gymName}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">Gym OS</p>
        </div>
      )}
    </div>
  );
}
