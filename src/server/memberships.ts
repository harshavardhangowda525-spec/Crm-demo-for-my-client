"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { activationSchema, pauseSchema, reasonSchema } from "@/lib/validation";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

function refreshAll(customerId?: string) {
  for (const p of ["/", "/customers", "/enquiries", "/memberships", "/invoices", "/automations", "/analytics"]) revalidatePath(p);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** Sends whatever the action just queued (confirmation, invoice…) right away. */
async function flushQueue() {
  await dispatchDueMessages({ limit: 10 }).catch((e) => console.error("[dispatch]", e));
}

export async function activateMembership(
  input: unknown,
): Promise<ActionResult<{ membershipId: string; invoiceId: string; status: string; duplicate: boolean }>> {
  return guard(async () => {
    await authorize("memberships.activate");
    const parsed = activationSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("activate_membership", {
      p_customer_id: v.customerId,
      p_plan_id: v.planId,
      p_start_date: v.startDate,
      p_discount_paise: v.discountPaise,
      p_amount_paid_paise: v.amountPaidPaise,
      p_payment_method: v.paymentMethod,
      p_payment_reference: v.paymentReference,
      p_idempotency_key: v.idempotencyKey,
    });
    if (error) return fail(dbError(error));
    const r = data as { membership_id: string; invoice_id: string; status: string; duplicate: boolean };
    await flushQueue();
    refreshAll(v.customerId);
    return ok({ membershipId: r.membership_id, invoiceId: r.invoice_id, status: r.status, duplicate: r.duplicate });
  });
}

export async function requestPause(
  input: unknown,
): Promise<ActionResult<{ newEndDate: string; remaining: number; days: number }>> {
  return guard(async () => {
    await authorize("pauses.create");
    const parsed = pauseSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_pause", {
      p_membership_id: v.membershipId,
      p_start: v.startDate,
      p_end: v.endDate,
      p_reason: v.reason,
      p_idempotency_key: v.idempotencyKey,
    });
    if (error) return fail(dbError(error));
    const r = data as { new_end_date: string; remaining: number; days: number };
    await flushQueue();
    refreshAll();
    revalidatePath("/customers/[id]", "page");
    return ok({ newEndDate: r.new_end_date, remaining: r.remaining, days: r.days });
  });
}

export async function cancelMembership(membershipId: string, reason: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("memberships.cancel");
    const r = reasonSchema.safeParse(reason);
    if (!r.success) return zodFail(r.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_membership", { p_membership_id: membershipId, p_reason: r.data });
    if (error) return fail(dbError(error));
    refreshAll();
    revalidatePath("/customers/[id]", "page");
    return ok(null);
  });
}
