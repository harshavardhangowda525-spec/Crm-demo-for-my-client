import Link from "next/link";
import { CalendarClock, ChevronRight, MessageSquareText } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { LifecycleBadge } from "@/components/crm/lifecycle-badge";
import { QuickAddButton } from "@/components/crm/quick-add";
import { ENQUIRY_SOURCES, formatDate, label, relativeDays, todayISO } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export const metadata = { title: "Enquiries" };
const PAGE_SIZE = 25;
const OPEN = ["new", "follow_up_pending", "interested"];
const VIEWS = [
  ["due", "Due & overdue"],
  ["open", "All open"],
  ["new", "New"],
  ["follow_up_pending", "Follow-up pending"],
  ["interested", "Interested"],
  ["converted", "Converted"],
  ["not_interested", "Not interested"],
] as const;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "due";
  const page = Math.max(1, Number(sp.page) || 1);
  const today = todayISO();
  const supabase = await createClient();

  const filtered = (k: string, cols: string, opts?: { count: "exact"; head?: boolean }) => {
    const base = supabase.from("enquiries").select(cols, opts).eq("gym_id", staff.gymId);
    if (k === "due") return base.in("status", OPEN).lte("follow_up_date", today);
    if (k === "open") return base.in("status", OPEN);
    return base.eq("status", k);
  };
  const listQuery = filtered(
    view,
    "id, status, source, enquiry_date, follow_up_date, customers!inner(id, full_name, phone_e164), membership_plans(name)",
    { count: "exact" },
  );
  const { data: rows, count } = await (view === "due" || view === "open"
    ? listQuery.order("follow_up_date", { ascending: true, nullsFirst: false })
    : listQuery.order("enquiry_date", { ascending: false })
  )
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<
      {
        id: string;
        status: string;
        source: string;
        enquiry_date: string;
        follow_up_date: string | null;
        customers: { id: string; full_name: string; phone_e164: string };
        membership_plans: { name: string } | null;
      }[]
    >();

  const counts = await Promise.all(VIEWS.map(async ([k]) => (await filtered(k, "id", { count: "exact", head: true })).count ?? 0));

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Pipeline" title="Enquiries" description="Follow up on time and convert interested visitors." action={<QuickAddButton className="focus-ring hidden h-11 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-bg shadow-[var(--shadow-lime)] md:inline-flex" />} />
      <FilterChips active={view} items={VIEWS.map(([k, l], i) => ({ key: k, label: l, count: counts[i], href: `/enquiries?view=${k}` }))} />
      <GlassCard className="p-2 md:p-3">
        {!rows?.length ? (
          <EmptyState icon={view === "due" ? CalendarClock : MessageSquareText} title={view === "due" ? "No follow-ups due" : "Nothing here"} description={view === "due" ? "You're all caught up for today." : "Enquiries matching this filter will appear here."} />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((e) => {
              const cust = e.customers;
              const plan = e.membership_plans?.name;
              const overdue = e.follow_up_date && e.follow_up_date < today && OPEN.includes(e.status);
              const dueToday = e.follow_up_date === today && OPEN.includes(e.status);
              return (
                <li key={e.id}>
                  <Link href={`/customers/${cust.id}?do=follow-up`} className="focus-ring group flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-white/[0.03]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <p className="font-medium">{cust.full_name}</p>
                        <LifecycleBadge lifecycle={e.status} />
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {formatPhone(cust.phone_e164)} · {plan ?? "No plan chosen"} · {label(ENQUIRY_SOURCES, e.source)} · enquired {formatDate(e.enquiry_date, true)}
                      </p>
                    </div>
                    {e.follow_up_date && OPEN.includes(e.status) && (
                      <span className={cn("shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium", overdue ? "bg-danger/12 text-danger" : dueToday ? "bg-warning/12 text-warning" : "bg-white/[0.05] text-muted")}>
                        {overdue ? `Overdue · ${relativeDays(e.follow_up_date, today)}` : `Follow-up ${relativeDays(e.follow_up_date, today)}`}
                      </span>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="px-3 pb-2">
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/enquiries?view=${view}&page=${p}`} />
        </div>
      </GlassCard>
    </div>
  );
}
