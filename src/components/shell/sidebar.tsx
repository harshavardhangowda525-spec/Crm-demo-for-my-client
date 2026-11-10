"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Wordmark } from "@/components/brand/logo";
import { can, type StaffRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

export function Sidebar({
  gymName,
  role,
  collapsed,
  onToggle,
}: {
  gymName: string;
  role: StaffRole;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.permission || can(role, i.permission));

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 84 : 256 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur-xl lg:flex"
      aria-label="Main navigation"
    >
      <div className={cn("flex h-20 items-center px-5", collapsed && "justify-center px-0")}>
        <Wordmark gymName={gymName} collapsed={collapsed} />
      </div>
      <div className="divider-metal mx-4" />

      <Tooltip.Provider delayDuration={150}>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-none">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring group relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active ? "text-fg" : "text-muted hover:bg-white/[0.035] hover:text-fg",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-lime/[0.13] to-lime/[0.02] shadow-[inset_0_0_0_1px_rgb(198_255_69/0.18)]"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                {active && (
                  <motion.span
                    layoutId="sidebar-active-bar"
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lime shadow-[0_0_12px_rgb(198_255_69/0.8)]"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className={cn("relative size-[18px] shrink-0", active && "text-lime")} />
                {!collapsed && <span className="relative truncate">{item.label}</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip.Root key={item.href}>
                <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={10}
                    className="glass z-50 px-3 py-1.5 text-xs font-medium text-fg"
                  >
                    {item.label}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            ) : (
              link
            );
          })}
        </nav>
      </Tooltip.Provider>

      <div className="p-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "focus-ring flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted hover:bg-white/[0.035] hover:text-fg",
            collapsed && "justify-center px-0",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </motion.aside>
  );
}
