import { requirePermission } from "@/lib/auth";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { LazyRevenueChart } from "@/components/charts/lazy";
import { BarList } from "@/components/charts/bar-list";
import { RangeFilter } from "@/components/charts/range-filter";
import { formatDate, formatINR } from "@/lib/format";
import { loadMetrics, loadRevenue, resolveRange } from "@/server/analytics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ bucket?: string; from?: string; to?: string }> }) {
  await requirePermission("analytics.read");
  const range = resolveRange(await searchParams);
  const [m, revenue] = await Promise.all([loadMetrics(range.from, range.to), loadRevenue(range.from, range.to, range.bucket)]);
  const conversion = m.enquiries_in_range ? (m.converted_in_range / m.enquiries_in_range) * 100 : 0;
  const followUpRate = m.follow_ups_logged ? (m.follow_up_conversions / m.follow_ups_logged) * 100 : 0;

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Business intelligence" title="Analytics" description={`${formatDate(range.from)} – ${formatDate(range.to)} · calculated from recorded payments, enquiries and memberships`} />
      <RangeFilter bucket={range.bucket} from={range.from} to={range.to} />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <KpiCard index={0} icon="collections" label="Collected revenue" kind="currency" value={m.collected_paise} hint="Payments received in range" />
        <KpiCard index={1} icon="outstanding" accent="cyan" label="Outstanding" kind="currency" value={m.outstanding_paise} hint={`${m.outstanding_count} unpaid invoices (all time)`} />
        <KpiCard index={2} icon="enquiries" accent="cyan" label="Total enquiries" value={m.enquiries_in_range} hint="Enquiry date in range" />
        <KpiCard index={3} icon="conversion" label="Enquiry → member" kind="percent" value={conversion} hint={`${m.converted_in_range} converted`} />
        <KpiCard index={4} icon="active" label="New memberships" value={m.new_memberships} hint="First-time purchases" />
        <KpiCard index={5} icon="renewals" accent="cyan" label="Renewals" value={m.renewals} hint="Renewed after a previous term" />
        <KpiCard index={6} icon="expiring" accent="cyan" label="Expired memberships" value={m.expired_in_range} hint="Ended in range, not renewed yet" />
        <KpiCard index={7} icon="newCustomers" label="Follow-up effectiveness" kind="percent" value={followUpRate} hint={`${m.follow_up_conversions} conversions from ${m.follow_ups_logged} follow-ups`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <GlassCard className="p-5 md:p-6">
          <h2 className="font-display text-lg font-semibold">Collected revenue</h2>
          <p className="mb-4 text-xs text-muted">{formatINR(m.collected_paise)} in range · by {range.bucket}</p>
          <LazyRevenueChart data={revenue} bucket={range.bucket} />
        </GlassCard>
        <GlassCard className="p-5 md:p-6">
          <h2 className="font-display text-lg font-semibold">Plan popularity</h2>
          <p className="mb-5 text-xs text-muted">Memberships sold in range</p>
          <BarList items={m.plan_popularity.map((p) => ({ label: p.plan, value: p.count }))} emptyText="No memberships sold in this range." tone="cyan" />
        </GlassCard>
      </div>
    </div>
  );
}
