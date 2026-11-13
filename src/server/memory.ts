"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { normalizePhone } from "@/lib/phone";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

function refresh(customerId?: string | null) {
  revalidatePath("/today");
  revalidatePath("/customers");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function setCustomerTags(customerId: string, tagIds: string[]): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = z.object({ customerId: uuid, tagIds: z.array(uuid).max(30) }).safeParse({ customerId, tagIds });
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_customer_tags", { p_customer_id: customerId, p_tag_ids: tagIds });
    if (error) return fail(dbError(error));
    refresh(customerId);
    return ok(null);
  });
}

export async function setCustomerPreferences(customerId: string, contactTime: string, language: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = z
      .object({
        customerId: uuid,
        contactTime: z.enum(["", "morning", "afternoon", "evening", "any"]),
        language: z.string().trim().max(40),
      })
      .safeParse({ customerId, contactTime, language });
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_customer_preferences", {
      p_customer_id: customerId,
      p_contact_time: contactTime,
      p_language: v.data.language,
    });
    if (error) return fail(dbError(error));
    refresh(customerId);
    return ok(null);
  });
}

const promiseSchema = z.object({
  customerId: uuid,
  body: z.string().trim().min(3, "Describe what was promised").max(500),
  dueDate: optionalDate,
});

export async function addPromise(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = promiseSchema.safeParse(input);
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_promise", { p_customer_id: v.data.customerId, p_body: v.data.body, p_due_date: v.data.dueDate });
    if (error) return fail(dbError(error));
    refresh(v.data.customerId);
    return ok(null);
  });
}

export async function resolvePromise(promiseId: string, status: "fulfilled" | "cancelled"): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    if (!uuid.safeParse(promiseId).success || !["fulfilled", "cancelled"].includes(status)) return fail("Invalid request");
    const supabase = await createClient();
    const { error } = await supabase.rpc("resolve_promise", { p_promise_id: promiseId, p_status: status });
    if (error) return fail(dbError(error));
    refresh();
    revalidatePath("/customers/[id]", "page");
    return ok(null);
  });
}

const taskSchema = z.object({
  customerId: z
    .union([uuid, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  title: z.string().trim().min(3, "What should we remind you about?").max(200),
  dueDate: isoDate,
  assignedStaffId: z
    .union([uuid, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function addStaffTask(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = taskSchema.safeParse(input);
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_staff_task", {
      p_customer_id: v.data.customerId,
      p_title: v.data.title,
      p_due_date: v.data.dueDate,
      p_assigned_staff_id: v.data.assignedStaffId,
    });
    if (error) return fail(dbError(error));
    refresh(v.data.customerId);
    return ok(null);
  });
}

export async function markTodayItem(key: string, action: "done" | "snooze", days = 1): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = z
      .object({ key: z.string().min(3).max(200).regex(/^[a-z_]+:[0-9a-f-]{36}(:[0-9-]+)?$/), action: z.enum(["done", "snooze"]), days: z.number().int().min(1).max(30) })
      .safeParse({ key, action, days });
    if (!v.success) return fail("Invalid item");
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_today_item", { p_key: key, p_action: action, p_days: days });
    if (error) return fail(dbError(error));
    refresh();
    revalidatePath("/");
    return ok(null);
  });
}

const reminderPrefsSchema = z.object({
  briefingEnabled: z.boolean(),
  briefingTime: z.string().regex(/^([01]\d|2[0-1]):[0-5]\d$/, "Choose a time between 05:00 and 21:00"),
  eveningEnabled: z.boolean(),
  eveningTime: z.string().regex(/^([01]\d|2[0-1]):[0-5]\d$/, "Choose a time between 05:00 and 21:00"),
  phone: z.string().trim().max(20),
});

export async function saveMyReminders(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.read");
    const v = reminderPrefsSchema.safeParse(input);
    if (!v.success) return zodFail(v.error);
    const phone = v.data.phone ? normalizePhone(v.data.phone) : null;
    if (v.data.phone && !phone) return fail("Enter a valid WhatsApp number");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_my_reminders", {
      p_briefing_enabled: v.data.briefingEnabled,
      p_briefing_time: v.data.briefingTime,
      p_evening_enabled: v.data.eveningEnabled,
      p_evening_time: v.data.eveningTime,
      p_phone_e164: phone,
    });
    if (error) return fail(dbError(error));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function sendTestBriefing(): Promise<ActionResult<{ queued: boolean; simulated: number; sent: number; failed: number }>> {
  return guard(async () => {
    await authorize("customers.read");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_test_briefing");
    if (error) return fail(dbError(error));
    const id = (data as { message_id: string | null }).message_id;
    if (!id) return fail("Not queued — add your WhatsApp number above and make sure the Morning briefing automation is on.");
    const d = await dispatchDueMessages({ messageId: id });
    revalidatePath("/automations");
    return ok({ queued: true, simulated: d.simulated, sent: d.sent, failed: d.failed });
  });
}

export async function addTag(kind: "interest" | "objection", label: string): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("settings.manage");
    const v = z.object({ kind: z.enum(["interest", "objection"]), label: z.string().trim().min(2).max(40) }).safeParse({ kind, label });
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.from("customer_tags").insert({ gym_id: staff.gymId, kind, label: v.data.label, sort_order: 100 });
    if (error) return fail(error.code === "23505" ? "This tag already exists." : dbError(error));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function setTagActive(tagId: string, active: boolean): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("settings.manage");
    if (!uuid.safeParse(tagId).success) return fail("Invalid tag");
    const supabase = await createClient();
    const { error } = await supabase.from("customer_tags").update({ active }).eq("id", tagId).eq("gym_id", staff.gymId);
    if (error) return fail(dbError(error));
    revalidatePath("/settings");
    return ok(null);
  });
}
