"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import {
  customerCreateSchema,
  customerUpdateSchema,
  enquiryUpdateSchema,
  followUpSchema,
  newEnquirySchema,
  noteSchema,
  type CustomerCreateInput,
} from "@/lib/validation";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

function refreshCrm(customerId?: string) {
  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/enquiries");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createCustomer(
  input: CustomerCreateInput,
): Promise<ActionResult<{ customerId: string; duplicate: boolean }>> {
  return guard(async () => {
    await authorize("customers.write");
    const parsed = customerCreateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_customer", {
      p_full_name: v.fullName,
      p_phone_e164: v.phone,
      p_email: v.email,
      p_date_of_birth: v.dateOfBirth,
      p_gender: v.gender,
      p_notes: v.notes,
      p_assigned_staff_id: v.assignedStaffId,
      p_interested_plan_id: v.interestedPlanId,
      p_source: v.source,
      p_enquiry_date: v.enquiryDate,
      p_enquiry_status: v.status,
      p_follow_up_date: v.followUpDate,
      p_whatsapp_opt_in: v.whatsappOptIn,
    });
    if (error) return fail(dbError(error));
    const r = data as { status: "created" | "duplicate"; customer_id: string };
    if (r.status === "created") refreshCrm(r.customer_id);
    return ok({ customerId: r.customer_id, duplicate: r.status === "duplicate" });
  });
}

export async function updateCustomer(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("customers.write");
    const parsed = customerUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase
      .from("customers")
      .update({
        full_name: v.fullName,
        phone_e164: v.phone,
        email: v.email,
        date_of_birth: v.dateOfBirth,
        gender: v.gender,
        assigned_staff_id: v.assignedStaffId,
        notes: v.notes,
      })
      .eq("id", v.customerId)
      .eq("gym_id", staff.gymId);
    if (error) return fail(dbError(error));

    const { data: pref } = await supabase
      .from("notification_preferences")
      .select("whatsapp_opt_in")
      .eq("customer_id", v.customerId)
      .maybeSingle();
    if (!pref || pref.whatsapp_opt_in !== v.whatsappOptIn) {
      const now = new Date().toISOString();
      const { error: prefError } = await supabase.from("notification_preferences").upsert({
        customer_id: v.customerId,
        gym_id: staff.gymId,
        whatsapp_opt_in: v.whatsappOptIn,
        opt_in_source: "staff_recorded",
        ...(v.whatsappOptIn ? { opted_in_at: now } : { opted_out_at: now }),
      });
      if (prefError) return fail(dbError(prefError));
    }
    refreshCrm(v.customerId);
    return ok(null);
  });
}

export async function updateEnquiry(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("enquiries.write");
    const parsed = enquiryUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("enquiries")
      .update({
        status: v.status,
        follow_up_date: v.status === "not_interested" ? null : v.followUpDate,
        interested_plan_id: v.interestedPlanId,
        assigned_staff_id: v.assignedStaffId,
      })
      .eq("id", v.enquiryId)
      .eq("gym_id", staff.gymId)
      .neq("status", "converted")
      .select("customer_id")
      .maybeSingle();
    if (error) return fail(dbError(error));
    if (!data) return fail("This enquiry was already converted and can no longer be edited.");
    refreshCrm(data.customer_id);
    return ok(null);
  });
}

export async function createEnquiry(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("enquiries.write");
    const parsed = newEnquirySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("enquiries")
      .insert({
        gym_id: staff.gymId,
        customer_id: v.customerId,
        interested_plan_id: v.interestedPlanId,
        source: v.source,
        status: v.followUpDate ? "follow_up_pending" : "new",
        follow_up_date: v.followUpDate,
        created_by: staff.userId,
      })
      .select("id")
      .single();
    if (error) return fail(dbError(error));
    if (v.notes) {
      await supabase.from("enquiry_notes").insert({
        gym_id: staff.gymId,
        enquiry_id: data.id,
        customer_id: v.customerId,
        kind: "visit",
        body: v.notes,
        author_id: staff.userId,
      });
    }
    refreshCrm(v.customerId);
    return ok(null);
  });
}

export async function addNote(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("customers.write");
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.from("enquiry_notes").insert({
      gym_id: staff.gymId,
      customer_id: v.customerId,
      enquiry_id: v.enquiryId,
      kind: "note",
      body: v.body,
      author_id: staff.userId,
    });
    if (error) return fail(dbError(error));
    refreshCrm(v.customerId);
    return ok(null);
  });
}

export async function logFollowUp(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("enquiries.write");
    const parsed = followUpSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("log_follow_up", {
      p_enquiry_id: v.enquiryId,
      p_kind: v.kind,
      p_outcome: v.outcome,
      p_body: v.body,
      p_next_follow_up_date: v.nextFollowUpDate,
      p_new_status: v.newStatus,
    });
    if (error) return fail(dbError(error));
    refreshCrm();
    revalidatePath("/customers/[id]", "page");
    return ok(null);
  });
}

export async function sendPortalLink(customerId: string): Promise<ActionResult<{ link: string; queued: boolean }>> {
  return guard(async () => {
    await authorize("customers.write");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_portal_link", { p_customer_id: customerId });
    if (error) return fail(dbError(error));
    const r = data as { link: string; message_id: string | null };
    if (r.message_id) await dispatchDueMessages({ messageId: r.message_id }).catch(() => undefined);
    refreshCrm(customerId);
    return ok({ link: r.link, queued: !!r.message_id });
  });
}
