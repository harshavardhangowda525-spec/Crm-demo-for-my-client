"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, FileX2, IndianRupee, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cancelInvoice, reissueInvoice } from "@/server/invoices";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { PaymentForm } from "./payment-form";

export function InvoiceActions({
  invoiceId,
  status,
  outstandingPaise,
  amountPaidPaise,
  discountPaise,
  canCancel,
}: {
  invoiceId: string;
  status: "issued" | "cancelled";
  outstandingPaise: number;
  amountPaidPaise: number;
  discountPaise: number;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<"pay" | "cancel" | "reissue" | null>(null);
  const [pending, start] = React.useTransition();
  const [key] = React.useState(() => crypto.randomUUID());
  const close = () => setOpen(null);

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <a href={`/api/invoices/${invoiceId}/pdf`} target="_blank" rel="noopener">
          <FileText /> View PDF
        </a>
      </Button>
      <Button asChild variant="outline">
        <a href={`/api/invoices/${invoiceId}/pdf?download=1`}>
          <Download /> Download
        </a>
      </Button>
      {status === "issued" && outstandingPaise > 0 && (
        <Button onClick={() => setOpen("pay")}>
          <IndianRupee /> Record payment
        </Button>
      )}
      {status === "issued" && canCancel && (
        <>
          <Button variant="outline" onClick={() => setOpen("reissue")}>
            <RotateCcw /> Correct & re-issue
          </Button>
          {amountPaidPaise === 0 && (
            <Button variant="danger" onClick={() => setOpen("cancel")}>
              <FileX2 /> Cancel invoice
            </Button>
          )}
        </>
      )}

      <Sheet open={open === "pay"} onOpenChange={(o) => !o && close()} title="Record payment" description={`Outstanding ${formatINR(outstandingPaise, { decimals: true })}`} size="sm">
        <PaymentForm invoiceId={invoiceId} outstandingPaise={outstandingPaise} onDone={close} />
      </Sheet>

      <Sheet open={open === "cancel"} onOpenChange={(o) => !o && close()} title="Cancel invoice" description="The invoice number stays used and the cancellation is audited." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            start(async () => {
              const r = await cancelInvoice(invoiceId, reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Invoice cancelled");
              close();
              router.refresh();
            });
          }}
        >
          <Textarea name="reason" required minLength={3} placeholder="Reason, e.g. created by mistake" />
          <Button type="submit" variant="danger" className="w-full" loading={pending}>
            Cancel invoice
          </Button>
        </form>
      </Sheet>

      <Sheet open={open === "reissue"} onOpenChange={(o) => !o && close()} title="Correct & re-issue" description="Cancels this invoice and issues a new one with the next number. Payments move to the new invoice." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const discountPaise = rupeesToPaise(String(f.get("discount") ?? "0"));
            if (discountPaise === null) return void toast.error("Enter a valid discount");
            start(async () => {
              const r = await reissueInvoice({ invoiceId, discountPaise, reason: String(f.get("reason") ?? ""), idempotencyKey: key });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Corrected invoice issued");
              close();
              router.push(`/invoices/${r.data.invoiceId}`);
            });
          }}
        >
          <Field label="Corrected discount (₹)" htmlFor="discount">
            <Input id="discount" name="discount" inputMode="decimal" defaultValue={(discountPaise / 100).toFixed(2)} />
          </Field>
          <Field label="Reason" htmlFor="rr">
            <Textarea id="rr" name="reason" required minLength={3} placeholder="What was wrong?" />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Issue corrected invoice
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
