"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { gymSettingsSchema, planSchema, staffInviteSchema } from "@/lib/validation";

export async function saveGymSettings(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("settings.manage");
    const parsed = gymSettingsSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase
      .from("gyms")
      .update({
        name: v.name,
        legal_name: v.legalName,
        address_line1: v.addressLine1,
        address_line2: v.addressLine2,
        city: v.city,
        state: v.state,
        state_code: v.stateCode,
        postal_code: v.postalCode,
        phone_e164: v.phone,
        email: v.email,
        gstin: v.gstin,
        gst_enabled: v.gstEnabled,
        default_gst_rate: v.defaultGstRate,
        sac_code: v.sacCode,
        invoice_prefix: v.invoicePrefix,
        pause_max_days: v.pauseMaxDays,
        reminder_offsets: [...new Set(v.reminderOffsets)].sort((a, b) => b - a),
        activation_rule: v.activationRule,
        renewal_follow_up_days: v.renewalFollowUpDays,
        whatsapp_provider: v.whatsappProvider,
      })
      .eq("id", staff.gymId);
    if (error) return fail(dbError(error));
    revalidatePath("/", "layout");
    return ok(null);
  });
}

export async function savePlan(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("settings.manage");
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const row = {
      gym_id: staff.gymId,
      name: v.name,
      duration_value: v.durationValue,
      duration_unit: v.durationUnit,
      base_price_paise: v.basePricePaise,
      gst_rate: v.gstRate,
      description: v.description,
      pause_allowance_days: v.pauseAllowanceDays,
      active: v.active,
    };
    const { error } = v.planId
      ? await supabase.from("membership_plans").update(row).eq("id", v.planId).eq("gym_id", staff.gymId)
      : await supabase.from("membership_plans").insert(row);
    if (error) return fail(error.code === "23505" ? "A plan with this name already exists." : dbError(error));
    revalidatePath("/settings");
    revalidatePath("/memberships");
    return ok(null);
  });
}

export async function addStaff(input: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("staff.manage");
    const parsed = staffInviteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_staff_by_email", {
      p_email: parsed.data.email,
      p_role: parsed.data.role,
      p_full_name: parsed.data.fullName,
    });
    if (error) return fail(dbError(error));
    const r = data as { ok: boolean; error?: string };
    if (!r.ok) return fail(r.error ?? "Could not add staff member.");
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function setStaffActive(staffId: string, active: boolean): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("staff.manage");
    if (staffId === staff.staffId && !active) return fail("You cannot deactivate your own account.");
    const supabase = await createClient();
    const { error } = await supabase.from("gym_staff").update({ active }).eq("id", staffId).eq("gym_id", staff.gymId);
    if (error) return fail(dbError(error, /owner/i.test(error.message) ? capital(error.message) : undefined));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function updateMyName(fullName: string): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("customers.read");
    const name = fullName.trim();
    if (name.length < 2 || name.length > 80) return fail("Enter your name (2–80 characters).");
    const supabase = await createClient();
    const { error } = await supabase.from("user_profiles").update({ full_name: name }).eq("id", staff.userId);
    if (error) return fail(dbError(error));
    revalidatePath("/", "layout");
    return ok(null);
  });
}

export async function changeMyPassword(password: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.read");
    if (password.length < 10) return fail("Use at least 10 characters.");
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return fail(error.message);
    return ok(null);
  });
}

export async function loadDemoData(): Promise<ActionResult<Record<string, number>>> {
  return guard(async () => {
    await authorize("settings.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("load_demo_data");
    if (error) return fail(dbError(error));
    revalidatePath("/", "layout");
    return ok(data as Record<string, number>);
  });
}

export async function removeDemoData(): Promise<ActionResult<{ removed_customers: number }>> {
  return guard(async () => {
    await authorize("settings.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("remove_demo_data");
    if (error) return fail(dbError(error));
    revalidatePath("/", "layout");
    return ok(data as { removed_customers: number });
  });
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
