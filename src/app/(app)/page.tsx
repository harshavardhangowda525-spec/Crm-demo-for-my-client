import Link from "next/link";
import { CalendarClock, ChevronRight, CircleAlert, CirclePause, MessageSquareWarning, ReceiptIndianRupee, type LucideIcon } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { LazyRevenueChart } from "@/components/charts/lazy";
import { BarList } from "@/components/charts/bar-list";
import { RangeFilter } from "@/components/charts/range-filter";
import { addDaysISO, formatDate, formatINR, relativeDays, todayISO } from "@/lib/format";
import { loadMetrics, loadRevenue, resolveRange } from "@/server/analytics";

export const metadata = { title: "Overview" };

const pctChange = (now: number, prev: number) => (prev === 0 ? (now === 0 ? 0 : null) : ((now - prev) / prev) * 100);

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ bucket?: string; from?: string; to?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";
  const prevMonthStart = addDaysISO(monthStart, -1).slice(0, 8) + "01";
  const dayOfMonth = Number(today.slice(8));
  const prevSameDay = addDaysISO(prevMonthStart, Math.min(dayOfMonth, 28) - 1);
  const range = resolveRange(sp);
  const supabase = await createClient();
  const in7 = addDaysISO(today, 7);

  const [m, prev, revenue, followUps, expiring, unpaid, failed, pauses] = await Promise.all([
    loadMetrics(monthStart, today),
    loadMetrics(prevMonthStart, prevSameDay),
    loadRevenue(range.from, range.to, range.bucket),
    supabase
      .from("enquiries")
      .select("id, follow_up_date, customers!inner(id, full_name)")
      .eq("gym_id", staff.gymId)
      .in("status", ["new", "follow_up_pending", "interested"])
      .lte("follow_up_date", today)
      .order("follow_up_date")
      .limit(5),
    supabase
      .from("memberships")
      .select("id, end_date, plan_name, customers!inner(id, full_name)")
      .eq("gym_id", staff.gymId)
      .in("status", ["active", "paused"])
      .gte("end_date", today)
      .lte("end_date", in7)
      .order("end_date")
      .limit(5),
    supabase
      .from("invoices")
      .select("id, invoice_number, total_paise, amount_paid_paise, customer_snapshot")
      .eq("gym_id", staff.gymId)
      .eq("status", "issued")
      .neq("payment_status", "paid")
      .order("issue_date")
      .limit(5),
    supabase.from("whatsapp_messages").select("id, purpose, last_error, customers(id, full_name)").eq("gym_id", staff.gymId).eq("status", "failed").order("created_at", { ascending: false }).limit(5),
    supabase
      .from("membership_pauses")
      .select("id, start_date, end_date, days, requested_via, memberships!inner(customers!inner(id, full_name))")
      .eq("gym_id", staff.gymId)
      .eq("status", "approved")
      .gte("end_date", today)
      .order("start_date")
      .limit(5),
  ]);

  const conversion = m.enquiries_in_range ? (m.converted_in_range / m.enquiries_in_range) * 100 : 0;
  const prevConversion = prev.enquiries_in_range ? (prev.converted_in_range / prev.enquiries_in_range) * 100 : 0;

  type Item = { key: string; href: string; title: string; meta: string };
  const sections: { title: string; icon: LucideIcon; tone: string; items: Item[]; all: string; empty: string }[] = [
    {
      title: "Follow-ups due",
      icon: CalendarClock,
      tone: "text-warning",
      all: "/enquiries?view=due",
      empty: "No follow-ups due",
      items: (followUps.data ?? []).map((e) => {
        const c = e.customers as unknown as { id: string; full_name: string };
        return { key: e.id, href: `/customers/${c.id}?do=follow-up`, title: c.full_name, meta: `Follow-up ${relativeDays(e.follow_up_date!, today)}` };
      }),
    },
    {
      title: "Expiring within 7 days",
      icon: CircleAlert,
      tone: "text-cyan",
      all: "/memberships?view=expiring",
      empty: "No memberships expiring this week",
      items: (expiring.data ?? []).map((x) => {
        const c = x.customers as unknown as { id: string; full_name: string };
        return { key: x.id, href: `/customers/${c.id}?do=activate`, title: c.full_name, meta: `${x.plan_name} · ends ${relativeDays(x.end_date, today)}` };
      }),
    },
    {
      title: "Pending payments",
      icon: ReceiptIndianRupee,
      tone: "text-lime",
      all: "/invoices?status=outstanding",
      empty: "No outstanding invoices",
      items: (unpaid.data ?? []).map((i) => ({
        key: i.id,
        href: `/invoices/${i.id}`,
        title: (i.customer_snapshot as { name: string }).name,
        meta: `${formatINR(i.total_paise - i.amount_paid_paise)} due · ${i.invoice_number}`,
      })),
    },
    {
      title: "Failed WhatsApp deliveries",
      icon: MessageSquareWarning,
      tone: "text-danger",
      all: "/automations?status=failed",
      empty: "No failed messages",
      items: (failed.data ?? []).map((x) => {
        const c = x.customers as unknown as { id: string; full_name: string } | null;
        return { key: x.id, href: "/automations?status=failed", title: c?.full_name ?? "Customer", meta: x.last_error ?? "Delivery failed" };
      }),
    },
    {
      title: "Current & upcoming pauses",
      icon: CirclePause,
      tone: "text-cyan",
      all: "/memberships?view=paused",
      empty: "No active pauses",
      items: (pauses.data ?? []).map((p) => {
        const c = (p.memberships as unknown as { customers: { id: string; full_name: string } }).customers;
        return {
          key: p.id,
          href: `/customers/${c.id}`,
          title: c.full_name,
          meta: `${formatDate(p.start_date, true)} – ${formatDate(p.end_date, true)} · ${p.days} days${p.requested_via === "member_portal" ? " · via portal" : ""}`,
        };
      }),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Command center" title={staff.gymName} description={`This month so far · compared with the same days last month`} />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <KpiCard index={0} icon="active" label="Active memberships" value={m.active_memberships} hint={`${m.paused_memberships} paused right now`} href="/memberships" />
        <KpiCard index={1} icon="enquiries" accent="cyan" label="Pending enquiries" value={m.pending_enquiries} hint="New, follow-up or interested" href="/enquiries?view=open" />
        <KpiCard index={2} icon="expiring" accent="cyan" label="Expiring soon" value={m.expiring_soon} hint="Within the next 7 days" href="/memberships?view=expiring" />
        <KpiCard index={3} icon="collections" label="Collections this month" kind="currency" value={m.collected_paise} hint="Recorded payments only" trend={{ pct: pctChange(m.collected_paise, prev.collected_paise) }} href="/analytics" />
        <KpiCard index={4} icon="newCustomers" accent="cyan" label="New customers" value={m.new_customers} hint="This month" trend={{ pct: pctChange(m.new_customers, prev.new_customers) }} href="/customers" />
        <KpiCard index={5} icon="renewals" label="Renewals completed" value={m.renewals} hint="This month" trend={{ pct: pctChange(m.renewals, prev.renewals) }} />
        <KpiCard index={6} icon="conversion" accent="cyan" label="Enquiry conversion" kind="percent" value={conversion} hint={`${m.converted_in_range} of ${m.enquiries_in_range} this month`} trend={{ pct: prevConversion ? conversion - prevConversion : null }} />
        <KpiCard index={7} icon="outstanding" label="Outstanding payments" kind="currency" value={m.outstanding_paise} hint={`${m.outstanding_count} unpaid invoice${m.outstanding_count === 1 ? "" : "s"}`} href="/invoices?status=outstanding" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <GlassCard className="p-5 md:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">Revenue collected</h2>
              <p className="text-xs text-muted">
                {formatDate(range.from)} – {formatDate(range.to)} · {formatINR(revenue.reduce((s, r) => s + r.collected_paise, 0))} · unpaid invoices are not counted
              </p>
            </div>
          </div>
          <RangeFilter bucket={range.bucket} from={range.from} to={range.to} />
          <div className="mt-5">
            <LazyRevenueChart data={revenue} bucket={range.bucket} />
          </div>
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-fg">View as table</summary>
            <table className="mt-2 w-full text-left">
              <tbody>
                {revenue.map((r) => (
                  <tr key={r.bucket} className="border-t border-white/5">
                    <td className="py-1">{formatDate(r.bucket)}</td>
                    <td className="py-1 text-right tabular-nums text-fg">{formatINR(r.collected_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </GlassCard>

        <GlassCard className="p-5 md:p-6">
          <h2 className="font-display text-lg font-semibold">Membership mix</h2>
          <p className="mb-5 text-xs text-muted">Active and paused memberships by plan</p>
          <BarList items={m.plan_distribution.map((p) => ({ label: p.plan, value: p.count }))} emptyText="No active memberships yet." />
        </GlassCard>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold">Action center</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <GlassCard key={s.title} className="p-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <s.icon className={`size-4 ${s.tone}`} /> {s.title}
                </p>
                <Link href={s.all} className="focus-ring rounded-md text-xs text-muted hover:text-fg">
                  View all
                </Link>
              </div>
              {s.items.length === 0 ? (
                <p className="px-1 py-4 text-sm text-subtle">{s.empty}</p>
              ) : (
                <ul>
                  {s.items.map((it) => (
                    <li key={it.key}>
                      <Link href={it.href} className="focus-ring group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-white/[0.04]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-fg">{it.title}</p>
                          <p className="truncate text-xs text-muted">{it.meta}</p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
