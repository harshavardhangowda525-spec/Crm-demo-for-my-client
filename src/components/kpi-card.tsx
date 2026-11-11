"use client";

import * as React from "react";
import Link from "next/link";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  IndianRupee,
  MessageSquareText,
  Percent,
  RefreshCw,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  active: BadgeCheck,
  enquiries: MessageSquareText,
  expiring: CircleAlert,
  collections: IndianRupee,
  newCustomers: UserPlus,
  renewals: RefreshCw,
  conversion: Percent,
  outstanding: Wallet,
} satisfies Record<string, LucideIcon>;
export type KpiIcon = keyof typeof ICONS;

function format(v: number, kind: "number" | "currency" | "percent") {
  if (kind === "currency") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v / 100);
  }
  if (kind === "percent") return `${v.toFixed(v < 10 && v % 1 ? 1 : 0)}%`;
  return Math.round(v).toLocaleString("en-IN");
}

function Counter({ value, kind }: { value: number; kind: "number" | "currency" | "percent" }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(v, kind));
  React.useEffect(() => {
    if (reduce) return void mv.set(value);
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span>{text}</motion.span>;
}

export function KpiCard({
  label,
  value,
  kind = "number",
  hint,
  icon,
  accent = "lime",
  trend,
  href,
  index = 0,
}: {
  label: string;
  value: number;
  kind?: "number" | "currency" | "percent";
  hint: string;
  icon: KpiIcon;
  accent?: "lime" | "cyan";
  /** % change vs the previous comparable period; up = good unless `inverse`. */
  trend?: { pct: number | null; inverse?: boolean } | null;
  href?: string;
  index?: number;
}) {
  const Icon = ICONS[icon];
  const up = trend?.pct != null && trend.pct > 0;
  const good = trend?.pct != null && (trend.inverse ? trend.pct < 0 : trend.pct > 0);
  const body = (
    <>
      <div aria-hidden className={cn("pointer-events-none absolute -right-10 -top-10 size-32 rounded-full blur-3xl", accent === "lime" ? "bg-lime/10" : "bg-cyan/10")} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted md:text-[13px]">{label}</p>
        <span className="metal grid size-8 shrink-0 place-items-center rounded-lg">
          <Icon className={cn("size-4", accent === "lime" ? "text-lime" : "text-cyan")} />
        </span>
      </div>
      <p className="text-metric mt-3 truncate text-[26px] font-semibold leading-none text-fg md:text-[32px]">
        <Counter value={value} kind={kind} />
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {trend && trend.pct != null && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11.5px] font-semibold", good ? "text-success" : "text-danger")}>
            {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(trend.pct).toFixed(0)}%
          </span>
        )}
        <span className="text-[11.5px] text-subtle md:text-xs">{hint}</span>
      </div>
    </>
  );
  const cls = "glass glass-interactive block overflow-hidden p-4 md:p-5";
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}>
      {href ? (
        <Link href={href} className={cn(cls, "focus-ring")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </motion.div>
  );
}
