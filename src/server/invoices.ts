"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { paymentSchema, reasonSchema } from "@/lib/validation";

function refresh(invoiceId?: string) {
  for (const p of ["/", "/invoices", "/memberships", "/analytics", "/customers"]) revalidatePath(p);
  revalidatePath("/customers/[id]", "page");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

export async function recordPayment(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("payments.record");
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_payment", {
      p_invoice_id: v.invoiceId,
      p_amount_paise: v.amountPaise,
      p_method: v.method,
      p_reference: v.reference,
      p_idempotency_key: v.idempotencyKey,
    });
    if (error) return fail(dbError(error));
    refresh(v.invoiceId);
    return ok(null);
  });
}

export async function cancelInvoice(invoiceId: string, reason: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("invoices.cancel");
    const r = reasonSchema.safeParse(reason);
    if (!r.success) return zodFail(r.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: invoiceId, p_reason: r.data });
    if (error) return fail(dbError(error));
    refresh(invoiceId);
    return ok(null);
  });
}

const reissueSchema = z.object({
  invoiceId: z.uuid(),
  discountPaise: z.number().int().min(0),
  reason: reasonSchema,
  idempotencyKey: z.uuid(),
});

export async function reissueInvoice(input: unknown): Promise<ActionResult<{ invoiceId: string }>> {
  return guard(async () => {
    await authorize("invoices.cancel");
    const parsed = reissueSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("reissue_invoice", {
      p_invoice_id: v.invoiceId,
      p_discount_paise: v.discountPaise,
      p_reason: v.reason,
      p_idempotency_key: v.idempotencyKey,
    });
    if (error) return fail(dbError(error));
    const r = data as { invoice_id: string };
    refresh(v.invoiceId);
    return ok({ invoiceId: r.invoice_id });
  });
}
