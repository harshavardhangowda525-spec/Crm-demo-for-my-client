"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import { CalendarRange, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { activateMembership } from "@/server/memberships";
import { formatDate, formatINR, PAYMENT_METHODS, rupeesToPaise, todayISO, addDaysISO } from "@/lib/format";
import { durationLabel, membershipEndDate, priceBreakdown } from "@/lib/membership";
import type { PlanOption } from "@/server/queries";

export type ActivationContext = {
  customerId: string;
  customerName: string;
  plans: PlanOption[];
  defaultPlanId: string | null;
  gstEnabled: boolean;
  defaultGstRate: number;
  pauseMaxDays: number;
  activationRule: "full_payment" | "any_payment" | "immediate";
  canDiscount: boolean;
  /** Day after the current membership ends, for renewals. */
  earliestStart: string | null;
};

const RULE_TEXT = {
  full_payment: "The membership activates once the invoice is fully paid.",
  any_payment: "The membership activates once any payment is recorded.",
  immediate: "The membership activates on the start date, paid or not.",
};

export function ActivateMembershipForm({ ctx, onDone }: { ctx: ActivationContext; onDone?: () => void }) {
  const router = useRouter();
  const today = todayISO();
  const [planId, setPlanId] = React.useState(ctx.defaultPlanId ?? ctx.plans[0]?.id ?? "");
  const [startDate, setStartDate] = React.useState(ctx.earliestStart && ctx.earliestStart > today ? ctx.earliestStart : today);
  const [discount, setDiscount] = React.useState("");
  const [paid, setPaid] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState("upi");
  const [reference, setReference] = React.useState("");
  const [pending, start] = React.useTransition();
  // One key per opened form: double taps / retries never create two memberships.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());

  const plan = ctx.plans.find((p) => p.id === planId);
  if (!plan) {
    return <p className="text-sm text-muted">No active membership plans yet. An owner or admin can add plans in Settings → Plans.</p>;
  }
  const rate = ctx.gstEnabled ? Number(plan.gst_rate ?? ctx.defaultGstRate) : 0;
  const discountPaise = ctx.canDiscount ? Math.min(rupeesToPaise(discount) ?? 0, plan.base_price_paise) : 0;
  const b = priceBreakdown(plan.base_price_paise, discountPaise, rate);
  const paidPaise = paid === null ? b.total : (rupeesToPaise(paid) ?? -1);
  const end = startDate ? membershipEndDate(startDate, plan.duration_value, plan.duration_unit) : null;
  const tooEarly = ctx.earliestStart && startDate < ctx.earliestStart;
  const invalidPaid = paidPaise < 0 || paidPaise > b.total;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalidPaid || !plan) return;
    start(async () => {
      const res = await activateMembership({
        customerId: ctx.customerId,
        planId: plan.id,
        startDate,
        discountPaise,
        amountPaidPaise: paidPaise,
        paymentMethod: method,
        paymentReference: reference,
        idempotencyKey,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data.status === "active"
          ? `${plan.name} membership is active · invoice generated`
          : `Membership created (${res.data.status}) · invoice generated`,
      );
      onDone?.();
      router.push(`/invoices/${res.data.invoiceId}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Membership plan" htmlFor="plan" className="sm:col-span-2">
          <Select id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {ctx.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {durationLabel(p.duration_value, p.duration_unit)} · {formatINR(p.base_price_paise)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Start date"
          htmlFor="start"
          error={tooEarly ? `Current membership runs until ${formatDate(addDaysISO(ctx.earliestStart!, -1))}` : undefined}
        >
          <Input id="start" type="date" value={startDate} min={addDaysISO(today, -7)} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <div className="flex flex-col justify-end">
          <div className="flex h-12 items-center gap-2.5 rounded-xl bg-cyan/[0.07] px-4 text-sm shadow-[inset_0_0_0_1px_rgb(88_217_255/0.2)]">
            <CalendarRange className="size-4 text-cyan" />
            <span className="text-muted">Expires</span>
            <span className="ml-auto font-semibold text-fg">{end ? formatDate(end) : "—"}</span>
          </div>
        </div>
        {ctx.canDiscount && (
          <Field label="Discount (₹, optional)" htmlFor="discount" hint="Owners and admins only">
            <Input id="discount" inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        )}
      </div>

      <motion.div layout className="rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <Row label={`Base price (${durationLabel(plan.duration_value, plan.duration_unit)})`} value={formatINR(b.base, { decimals: true })} />
        {b.discount > 0 && <Row label="Discount" value={`− ${formatINR(b.discount, { decimals: true })}`} />}
        <Row label="Taxable amount" value={formatINR(b.taxable, { decimals: true })} />
        {rate > 0 ? (
          <>
            <Row label={`CGST @ ${rate / 2}%`} value={formatINR(b.cgst, { decimals: true })} muted />
            <Row label={`SGST @ ${rate / 2}%`} value={formatINR(b.sgst, { decimals: true })} muted />
          </>
        ) : (
          <Row label="GST" value="Not applied" muted />
        )}
        <div className="divider-metal my-3" />
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Grand total</span>
          <span className="text-metric text-2xl font-semibold text-lime">{formatINR(b.total, { decimals: true })}</span>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount received now (₹)" htmlFor="paid" error={invalidPaid ? `Enter between ₹0 and ${formatINR(b.total, { decimals: true })}` : undefined}>
          <Input
            id="paid"
            inputMode="decimal"
            value={paid ?? (b.total / 100).toFixed(2)}
            onChange={(e) => setPaid(e.target.value)}
            aria-invalid={invalidPaid}
          />
        </Field>
        <Field label="Payment method" htmlFor="method">
          <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (optional)" htmlFor="ref">
          <Input id="ref" placeholder="UPI / txn ID" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {RULE_TEXT[ctx.activationRule]} Includes {Math.min(plan.pause_allowance_days, ctx.pauseMaxDays)} pause days. A GST invoice is
          generated and a WhatsApp confirmation is queued if the customer opted in.
        </span>
      </p>

      <Button type="submit" size="lg" loading={pending} disabled={!!tooEarly || invalidPaid} className="w-full">
        Activate membership & generate invoice
      </Button>
    </form>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-sm">
      <span className={muted ? "text-subtle" : "text-muted"}>{label}</span>
      <span className="tabular-nums text-fg">{value}</span>
    </div>
  );
}
