import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { GlassCard } from "@/components/ui/card";
import { Badge, MESSAGE_TONE, PAYMENT_TONE } from "@/components/ui/badge";
import { InvoiceActions } from "@/components/invoice/invoice-actions";
import { RetryMessageButton } from "@/components/automation/retry-button";
import { formatDate, formatDateTime, formatINR, label, MESSAGE_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from "@/lib/format";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: inv }, { data: items }, { data: payments }, { data: messages }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).eq("gym_id", staff.gymId).maybeSingle(),
    supabase.from("invoice_items").select("description, sac_code, quantity, unit_price_paise, amount_paise").eq("invoice_id", id),
    supabase.from("payments").select("id, amount_paise, method, reference, paid_at").eq("invoice_id", id).order("paid_at"),
    supabase
      .from("whatsapp_messages")
      .select("id, status, simulated, last_error, provider_message_id, created_at, sent_at, delivered_at")
      .eq("related_entity_type", "invoice")
      .eq("related_entity_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!inv) notFound();
  const c = inv.customer_snapshot as { name: string; phone: string };
  const outstanding = inv.total_paise - inv.amount_paid_paise;
  const half = Number(inv.gst_rate) / 2;

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="focus-ring inline-flex items-center gap-1 rounded-lg text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> Invoices
      </Link>

      <GlassCard glow="cyan" className="p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Invoice</p>
            <h1 className="mt-1 font-display text-2xl font-semibold">{inv.invoice_number}</h1>
            <p className="mt-1 text-sm text-muted">
              Issued {formatDate(inv.issue_date)} to{" "}
              <Link href={`/customers/${inv.customer_id}`} className="text-fg underline-offset-4 hover:underline">
                {c.name}
              </Link>
            </p>
          </div>
          <div className="text-right">
            {inv.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : <Badge tone={PAYMENT_TONE[inv.payment_status]}>{label(PAYMENT_STATUS, inv.payment_status)}</Badge>}
            <p className="text-metric mt-2 text-3xl font-semibold">{formatINR(inv.total_paise, { decimals: true })}</p>
            {outstanding > 0 && inv.status === "issued" && <p className="text-sm text-warning">{formatINR(outstanding, { decimals: true })} due</p>}
          </div>
        </div>
        {inv.status === "cancelled" && <p className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">Cancelled {formatDateTime(inv.cancelled_at)} — {inv.cancelled_reason}</p>}
        {inv.notes && <p className="mt-3 text-sm text-muted">{inv.notes}</p>}
        <div className="divider-metal my-5" />
        <InvoiceActions
          invoiceId={inv.id}
          status={inv.status}
          outstandingPaise={outstanding}
          amountPaidPaise={inv.amount_paid_paise}
          discountPaise={inv.discount_paise}
          canCancel={can(staff.role, "invoices.cancel")}
        />
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <GlassCard className="p-5 md:p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Breakdown</h2>
          <ul className="space-y-2">
            {(items ?? []).map((it, i) => (
              <li key={i} className="flex justify-between gap-4 text-sm">
                <span>
                  {it.description}
                  <span className="text-subtle"> · SAC {it.sac_code}</span>
                </span>
                <span className="tabular-nums">{formatINR(it.amount_paise, { decimals: true })}</span>
              </li>
            ))}
          </ul>
          <div className="divider-metal my-4" />
          <dl className="space-y-1.5 text-sm">
            <Row k="Subtotal" v={formatINR(inv.subtotal_paise, { decimals: true })} />
            {inv.discount_paise > 0 && <Row k="Discount" v={`− ${formatINR(inv.discount_paise, { decimals: true })}`} />}
            <Row k="Taxable value" v={formatINR(inv.taxable_paise, { decimals: true })} />
            {Number(inv.gst_rate) > 0 ? (
              <>
                <Row k={`CGST @ ${half}%`} v={formatINR(inv.cgst_paise, { decimals: true })} />
                <Row k={`SGST @ ${half}%`} v={formatINR(inv.sgst_paise, { decimals: true })} />
              </>
            ) : (
              <Row k="GST" v="Not applied" />
            )}
            <div className="divider-metal my-2" />
            <Row k="Total" v={formatINR(inv.total_paise, { decimals: true })} strong />
            <Row k="Paid" v={formatINR(inv.amount_paid_paise, { decimals: true })} />
          </dl>
        </GlassCard>

        <div className="space-y-6">
          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Payments</h2>
            {!payments?.length ? (
              <p className="text-sm text-muted">No payments recorded.</p>
            ) : (
              <ul className="space-y-2">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span>
                      {label(PAYMENT_METHODS, p.method)}
                      <span className="block text-xs text-muted">
                        {formatDateTime(p.paid_at)}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium text-success">{formatINR(p.amount_paise, { decimals: true })}</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
          <GlassCard className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
              <MessageCircle className="size-4 text-success" /> WhatsApp delivery
            </h2>
            {!messages?.length ? (
              <p className="text-sm text-muted">Not sent — the customer has not opted in, or the automation is off. The invoice is always available here.</p>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <Badge tone={MESSAGE_TONE[m.status]}>{label(MESSAGE_STATUS, m.status)}</Badge>
                      <span className="text-xs text-muted">{formatDateTime(m.sent_at ?? m.created_at)}</span>
                    </div>
                    {m.simulated && <p className="mt-1.5 text-xs text-muted">Simulated — WhatsApp is not connected yet, so nothing was delivered.</p>}
                    {m.last_error && <p className="mt-1.5 text-xs text-danger">{m.last_error}</p>}
                    {m.status === "failed" && can(staff.role, "messages.retry") && <RetryMessageButton messageId={m.id} className="mt-2" />}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={strong ? "font-semibold" : "text-muted"}>{k}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{v}</dd>
    </div>
  );
}
