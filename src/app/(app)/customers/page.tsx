import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { CustomerSearch } from "@/components/crm/customer-search";
import { LifecycleBadge } from "@/components/crm/lifecycle-badge";
import { QuickAddButton } from "@/components/crm/quick-add";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Customers" };
const PAGE_SIZE = 20;
const FILTERS = [
  ["all", "All"],
  ["active_member", "Active members"],
  ["interested", "Interested"],
  ["follow_up_pending", "Follow-up pending"],
  ["new", "New enquiries"],
  ["expired_member", "Expired"],
  ["not_interested", "Not interested"],
] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const filter = FILTERS.some(([k]) => k === sp.filter) ? sp.filter! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase
    .from("customer_overview")
    .select("id, full_name, phone_e164, lifecycle, last_enquiry_date, interested_plan_name, membership_plan_name, membership_end_date, follow_up_date", {
      count: "exact",
    })
    .eq("gym_id", staff.gymId);
  if (filter !== "all") q = q.eq("lifecycle", filter);
  const { data: rows, count } = await q.order("updated_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const counts = await Promise.all(
    FILTERS.map(async ([k]) => {
      let c = supabase.from("customer_overview").select("id", { count: "exact", head: true }).eq("gym_id", staff.gymId);
      if (k !== "all") c = c.eq("lifecycle", k);
      return (await c).count ?? 0;
    }),
  );

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="CRM" title="Customers" description="Find a returning customer instantly by mobile number." action={<QuickAddButton className="focus-ring hidden h-11 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-bg shadow-[var(--shadow-lime)] md:inline-flex" />} />

      <GlassCard glow="lime" className="p-4 md:p-6">
        <CustomerSearch />
      </GlassCard>

      <FilterChips
        active={filter}
        items={FILTERS.map(([k, l], i) => ({ key: k, label: l, count: counts[i], href: k === "all" ? "/customers" : `/customers?filter=${k}` }))}
      />

      <GlassCard className="p-2 md:p-3">
        {!rows?.length ? (
          <EmptyState icon={Users} title="No customers here yet" description="Add your first walk-in enquiry with the + button." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="focus-ring group flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-white/[0.03] md:gap-5">
                  <span className="metal grid size-11 shrink-0 place-items-center rounded-xl font-display text-sm font-semibold">
                    {c.full_name
                      .split(" ")
                      .map((p: string) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <p className="truncate font-medium text-fg">{c.full_name}</p>
                      <LifecycleBadge lifecycle={c.lifecycle} />
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-muted">
                      {formatPhone(c.phone_e164)}
                      <span className="hidden sm:inline">
                        {c.membership_plan_name
                          ? ` · ${c.membership_plan_name} · ends ${formatDate(c.membership_end_date, true)}`
                          : c.interested_plan_name
                            ? ` · interested in ${c.interested_plan_name}`
                            : ""}
                      </span>
                    </p>
                  </div>
                  <div className="hidden text-right text-xs text-muted md:block">
                    <p>Last enquiry</p>
                    <p className="text-fg">{formatDate(c.last_enquiry_date)}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="px-3 pb-2">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? 0}
            hrefFor={(p) => `/customers?${new URLSearchParams({ ...(filter !== "all" ? { filter } : {}), page: String(p) })}`}
          />
        </div>
      </GlassCard>
    </div>
  );
}
