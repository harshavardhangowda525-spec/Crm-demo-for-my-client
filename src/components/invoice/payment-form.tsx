"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { recordPayment } from "@/server/invoices";
import { formatINR, PAYMENT_METHODS, rupeesToPaise } from "@/lib/format";

export function PaymentForm({ invoiceId, outstandingPaise, onDone }: { invoiceId: string; outstandingPaise: number; onDone?: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState((outstandingPaise / 100).toFixed(2));
  const [method, setMethod] = React.useState("upi");
  const [reference, setReference] = React.useState("");
  const [pending, start] = React.useTransition();
  const [key] = React.useState(() => crypto.randomUUID());
  const paise = rupeesToPaise(amount);
  const invalid = paise === null || paise <= 0 || paise > outstandingPaise;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        start(async () => {
          const res = await recordPayment({ invoiceId, amountPaise: paise, method, reference, idempotencyKey: key });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Payment of ${formatINR(paise!, { decimals: true })} recorded`);
          onDone?.();
          router.refresh();
        });
      }}
    >
      <Field label="Amount (₹)" htmlFor="amt" error={invalid ? `Enter up to ${formatINR(outstandingPaise, { decimals: true })}` : undefined}>
        <Input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={invalid} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method" htmlFor="pm">
          <Select id="pm" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="pref">
          <Input id="pref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" maxLength={120} />
        </Field>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={invalid}>
        Record payment
      </Button>
    </form>
  );
}
