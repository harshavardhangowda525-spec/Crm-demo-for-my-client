import * as React from "react";
import { cn } from "@/lib/utils";

export function GlassCard({
  className,
  interactive,
  glow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; glow?: "lime" | "cyan" }) {
  return (
    <div
      className={cn(
        "glass overflow-hidden",
        interactive && "glass-interactive",
        glow === "lime" && "after:absolute after:-top-16 after:-right-16 after:size-40 after:rounded-full after:bg-lime/10 after:blur-3xl after:content-['']",
        glow === "cyan" && "after:absolute after:-top-16 after:-right-16 after:size-40 after:rounded-full after:bg-cyan/10 after:blur-3xl after:content-['']",
        className,
      )}
      {...props}
    />
  );
}

export function SectionTitle({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime/80">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
