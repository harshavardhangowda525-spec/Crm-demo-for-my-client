"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** Segmented allowance meter: used days, the preview of new days, remaining. */
export function PauseMeter({ total, used, preview = 0, className }: { total: number; used: number; preview?: number; className?: string }) {
  const reduce = useReducedMotion();
  const remaining = Math.max(0, total - used - preview);
  return (
    <div className={className}>
      <div className="flex gap-1.5" role="img" aria-label={`${used} of ${total} pause days used, ${remaining} remaining`}>
        {Array.from({ length: Math.max(total, 1) }).map((_, i) => {
          const state = i < used ? "used" : i < used + preview ? "preview" : "free";
          return (
            <motion.span
              key={i}
              initial={reduce ? false : { scaleY: 0.4, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className={cn(
                "h-3 flex-1 rounded-full",
                state === "used" && "bg-cyan shadow-[0_0_10px_rgb(88_217_255/0.5)]",
                state === "preview" && "bg-lime shadow-[0_0_10px_rgb(198_255_69/0.6)]",
                state === "free" && "bg-white/[0.08]",
              )}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-cyan">{used} used</span>
        {preview > 0 && <span className="text-lime">+{preview} this pause</span>}
        <span className="text-muted">{remaining} remaining</span>
      </div>
    </div>
  );
}
