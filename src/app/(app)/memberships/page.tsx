import Link from "next/link";
import { BadgeCheck, ChevronRight } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { MembershipBadge } from "@/components/crm/lifecycle-badge";
import { addDaysISO, daysBetween, formatDate, todayISO } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export const metadata = { title: "Memberships" };
const PAGE_SIZE = 25;
const VIEWS = [
  ["live", "Active & paused"],
  ["expiring", "Expiring in 7 days"],
  ["paused", "Paused"],
  ["pending", "Pending payment"],
  ["expired", "Expired"],
  ["cancelled", "Cancelled"],
] as const;

export default async function MembershipsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "live";
  const page = Math.max(1, Number(sp.page) || 1);
  const today = todayISO();
  const in7 = addDaysISO(today, 7);
  const supabase = await createClient();

  const filtered = (k: string, cols: string, opts?: { count: "exact"; head?: boolean }) => {
    const base = supabase.from("memberships").select(cols, opts).eq("gym_id", staff.gymId);
    if (k === "live") return base.in("status", ["active", "paused"]);
    if (k === "expiring") return base.in("status", ["active", "paused"]).gte("end_date", today).lte("end_date", in7);
    return base.eq("status", k);
  };
  const ascending = view === "live" || view === "expiring" || view === "paused" || view === "pending";
  const { data: rows, count } = await filtered(
    view,
    "id, plan_name, status, start_date, end_date, pause_allowance_days, pause_days_used, is_demo, customers!inner(id, full_name, phone_e164)",
    { count: "exact" },
  )
    .order("end_date", { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<
      {
        id: string;
        plan_name: string;
        status: string;
        start_date: string;
        end_date: string;
        pause_allowance_days: number;
        pause_days_used: number;
        customers: { id: string; full_name: string; phone_e164: string };
      }[]
    >();
  const counts = await Promise.all(VIEWS.map(async ([k]) => (await filtered(k, "id", { count: "exact", head: true })).count ?? 0));

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Members" title="Memberships" description="Expiry dates, pauses and payment status at a glance. Open a member to renew or pause." />
      <FilterChips active={view} items={VIEWS.map(([k, l], i) => ({ key: k, label: l, count: counts[i], href: `/memberships?view=${k}` }))} />
      <GlassCard className="p-2 md:p-3">
        {!rows?.length ? (
          <EmptyState icon={BadgeCheck} title="No memberships here" description="Convert an enquiry from the customer profile to create one." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((m) => {
              const cust = m.customers;
              const left = daysBetween(today, m.end_date) + 1;
              const urgent = ["active", "paused"].includes(m.status) && left <= 7;
              return (
                <li key={m.id}>
                  <Link href={`/customers/${cust.id}`} className="focus-ring flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-white/[0.03]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <p className="font-medium">{cust.full_name}</p>
                        <MembershipBadge status={m.status} />
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {m.plan_name} · {formatDate(m.start_date, true)} – {formatDate(m.end_date)} · pauses {m.pause_days_used}/{m.pause_allowance_days}
                        <span className="hidden sm:inline"> · {formatPhone(cust.phone_e164)}</span>
                      </p>
                    </div>
                    {["active", "paused", "pending"].includes(m.status) && (
                      <div className={cn("shrink-0 text-right", urgent ? "text-warning" : "text-fg")}>
                        <p className="text-metric text-xl font-semibold leading-none">{Math.max(0, left)}</p>
                        <p className="text-[11px] text-muted">days left</p>
                      </div>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="px-3 pb-2">
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/memberships?view=${view}&page=${p}`} />
        </div>
      </GlassCard>
    </div>
  );
}
