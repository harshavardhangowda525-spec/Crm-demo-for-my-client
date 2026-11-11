import Link from "next/link";
import { ChevronRight, ReceiptIndianRupee } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { Badge, PAYMENT_TONE } from "@/components/ui/badge";
import { formatDate, formatINR, label, PAYMENT_STATUS } from "@/lib/format";

export const metadata = { title: "Invoices" };
const PAGE_SIZE = 25;
const VIEWS = [
  ["all", "All issued"],
  ["outstanding", "Outstanding"],
  ["paid", "Paid"],
  ["cancelled", "Cancelled"],
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.status) ? sp.status! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  const filtered = (k: string, cols: string, opts?: { count: "exact"; head?: boolean }) => {
    const base = supabase.from("invoices").select(cols, opts).eq("gym_id", staff.gymId);
    if (k === "cancelled") return base.eq("status", "cancelled");
    if (k === "outstanding") return base.eq("status", "issued").neq("payment_status", "paid");
    if (k === "paid") return base.eq("status", "issued").eq("payment_status", "paid");
    return base.eq("status", "issued");
  };
  const { data: rows, count } = await filtered(view, "id, invoice_number, issue_date, total_paise, amount_paid_paise, payment_status, status, customer_snapshot", { count: "exact" })
    .order("issue_date", { ascending: false })
    .order("sequence_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<{ id: string; invoice_number: string; issue_date: string; total_paise: number; amount_paid_paise: number; payment_status: string; status: string; customer_snapshot: { name: string } }[]>();
  const counts = await Promise.all(VIEWS.map(async ([k]) => (await filtered(k, "id", { count: "exact", head: true })).count ?? 0));
  const { data: outstanding } = await supabase.from("invoices").select("total_paise, amount_paid_paise").eq("gym_id", staff.gymId).eq("status", "issued").neq("payment_status", "paid");
  const due = (outstanding ?? []).reduce((s, i) => s + i.total_paise - i.amount_paid_paise, 0);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Billing" title="Invoices" description="GST invoices with sequential numbering. Issued invoices are never edited — cancel or re-issue instead." />
      {due > 0 && (
        <GlassCard glow="lime" className="flex items-center justify-between p-5">
          <div>
            <p className="text-sm text-muted">Outstanding across {outstanding?.length} invoices</p>
            <p className="text-metric mt-1 text-3xl font-semibold text-lime">{formatINR(due)}</p>
          </div>
          <Link href="/invoices?status=outstanding" className="focus-ring rounded-xl px-4 py-2.5 text-sm text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-fg">
            View
          </Link>
        </GlassCard>
      )}
      <FilterChips active={view} items={VIEWS.map(([k, l], i) => ({ key: k, label: l, count: counts[i], href: `/invoices?status=${k}` }))} />
      <GlassCard className="p-2 md:p-3">
        {!rows?.length ? (
          <EmptyState icon={ReceiptIndianRupee} title="No invoices" description="Invoices are created when you activate or renew a membership." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`} className="focus-ring flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-white/[0.03]">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.customer_snapshot.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {i.invoice_number} · {formatDate(i.issue_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums font-medium">{formatINR(i.total_paise)}</p>
                    {i.status === "cancelled" ? (
                      <Badge>Cancelled</Badge>
                    ) : (
                      <Badge tone={PAYMENT_TONE[i.payment_status]}>{label(PAYMENT_STATUS, i.payment_status)}</Badge>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="px-3 pb-2">
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/invoices?status=${view}&page=${p}`} />
        </div>
      </GlassCard>
    </div>
  );
}
