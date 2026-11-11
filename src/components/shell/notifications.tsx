"use client";

import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Bell, CalendarClock, CircleAlert, MessageSquareWarning, ReceiptIndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionCounts = { followUps: number; expiring: number; unpaid: number; failed: number };

export function NotificationCenter({ counts }: { counts: ActionCounts }) {
  const total = counts.followUps + counts.expiring + counts.unpaid + counts.failed;
  const items = [
    { href: "/enquiries?view=due", icon: CalendarClock, label: "Follow-ups due", n: counts.followUps, tone: "text-warning" },
    { href: "/memberships?view=expiring", icon: CircleAlert, label: "Expiring within 7 days", n: counts.expiring, tone: "text-cyan" },
    { href: "/invoices?status=outstanding", icon: ReceiptIndianRupee, label: "Invoices awaiting payment", n: counts.unpaid, tone: "text-lime" },
    { href: "/automations?status=failed", icon: MessageSquareWarning, label: "Failed WhatsApp messages", n: counts.failed, tone: "text-danger" },
  ];
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="focus-ring relative grid size-11 place-items-center rounded-xl text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04] hover:text-fg"
        aria-label={`Notifications: ${total} items need attention`}
      >
        <Bell className="size-[18px]" />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-lime px-1 text-[10px] font-bold text-bg">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="glass z-50 w-80 p-1.5 data-[state=open]:animate-[menu-in_180ms_var(--ease-out-expo)]">
          <p className="px-3 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Needs attention</p>
          {items.map(({ href, icon: Icon, label, n, tone }) => (
            <Dropdown.Item key={href} asChild>
              <Link href={href} className="flex h-12 items-center gap-3 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-white/5">
                <Icon className={cn("size-4", tone)} />
                <span className="flex-1 text-fg">{label}</span>
                <span className={cn("tabular-nums font-semibold", n ? "text-fg" : "text-subtle")}>{n}</span>
              </Link>
            </Dropdown.Item>
          ))}
          {total === 0 && <p className="px-3 pb-3 pt-1 text-xs text-subtle">All clear — nothing needs attention.</p>}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
