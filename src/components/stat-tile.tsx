"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { BadgeCheck, MessageSquareText, UserCog, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Icons are referenced by name: components cannot cross the server→client boundary. */
const ICONS = { users: Users, enquiries: MessageSquareText, memberships: BadgeCheck, staff: UserCog } satisfies Record<string, LucideIcon>;
export type StatIcon = keyof typeof ICONS;

function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-IN"));
  React.useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, reduce, mv]);
  return <motion.span>{text}</motion.span>;
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  accent = "lime",
  index = 0,
}: {
  label: string;
  value: number | null;
  hint?: string;
  icon: StatIcon;
  accent?: "lime" | "cyan";
  index?: number;
}) {
  const Icon = ICONS[icon];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="glass glass-interactive overflow-hidden p-4 md:p-5"
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 size-32 rounded-full blur-3xl",
          accent === "lime" ? "bg-lime/10" : "bg-cyan/10",
        )}
      />
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-muted md:text-[13px]">{label}</p>
        <span className="metal grid size-8 place-items-center rounded-lg">
          <Icon className={cn("size-4", accent === "lime" ? "text-lime" : "text-cyan")} />
        </span>
      </div>
      <p className="text-metric mt-3 text-[30px] font-semibold leading-none text-fg md:text-[36px]">
        {value === null ? <span className="text-subtle">—</span> : <AnimatedNumber value={value} />}
      </p>
      {hint && <p className="mt-2 text-[11.5px] text-subtle md:text-xs">{value === null ? "Couldn't load" : hint}</p>}
    </motion.div>
  );
}
