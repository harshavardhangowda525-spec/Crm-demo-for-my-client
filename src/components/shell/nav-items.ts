import {
  LayoutDashboard,
  Users,
  MessageSquareText,
  BadgeCheck,
  ReceiptIndianRupee,
  Workflow,
  ChartNoAxesCombined,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (max 4); others live in the "More" sheet. */
  primaryMobile?: boolean;
  permission?: Permission;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, primaryMobile: true },
  { href: "/customers", label: "Customers", icon: Users, primaryMobile: true },
  { href: "/enquiries", label: "Enquiries", icon: MessageSquareText },
  { href: "/memberships", label: "Memberships", icon: BadgeCheck, primaryMobile: true },
  { href: "/invoices", label: "Invoices", icon: ReceiptIndianRupee, primaryMobile: true },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined, permission: "analytics.read" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
