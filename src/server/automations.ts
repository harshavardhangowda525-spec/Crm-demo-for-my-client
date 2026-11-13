"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, type ActionResult } from "@/lib/actions";
import { dispatchDueMessages, type DispatchSummary } from "@/lib/whatsapp/dispatcher";

export async function toggleAutomation(ruleId: string, enabled: boolean): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("automations.manage");
    if (!z.uuid().safeParse(ruleId).success) return fail("Invalid automation");
    const supabase = await createClient();
    const { error } = await supabase
      .from("automation_rules")
      .update({ enabled, updated_by: staff.userId })
      .eq("id", ruleId)
      .eq("gym_id", staff.gymId);
    if (error) return fail(dbError(error));
    revalidatePath("/automations");
    return ok(null);
  });
}

export async function updateTemplate(ruleId: string, templateName: string, body: string): Promise<ActionResult<null>> {
  return guard(async () => {
    const staff = await authorize("automations.manage");
    const v = z
      .object({
        ruleId: z.uuid(),
        templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names use lowercase letters, digits and _"),
        body: z.string().trim().min(10, "Message text is too short").max(1024),
      })
      .safeParse({ ruleId, templateName, body });
    if (!v.success) return fail(v.error.issues[0]?.message ?? "Invalid template");
    const supabase = await createClient();
    const { data: rule } = await supabase.from("automation_rules").select("config").eq("id", ruleId).single();
    const { error } = await supabase
      .from("automation_rules")
      .update({
        template_name: v.data.templateName,
        config: { ...(rule?.config as object), body: v.data.body },
        updated_by: staff.userId,
      })
      .eq("id", ruleId)
      .eq("gym_id", staff.gymId);
    if (error) return fail(dbError(error));
    revalidatePath("/automations");
    return ok(null);
  });
}

export async function retryMessage(messageId: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("messages.retry");
    const supabase = await createClient();
    const { error } = await supabase.rpc("retry_message", { p_message_id: messageId });
    if (error) return fail(dbError(error));
    await dispatchDueMessages({ messageId }).catch(() => undefined);
    revalidatePath("/automations");
    revalidatePath("/");
    return ok(null);
  });
}

export async function runAutomationsNow(): Promise<ActionResult<{ queued: number; statusChanges: number; dispatch: DispatchSummary }>> {
  return guard(async () => {
    await authorize("automations.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("run_automations_now");
    if (error) return fail(dbError(error));
    const r = data as { queued: number; status_changes: number };
    const dispatch = await dispatchDueMessages({ limit: 50 });
    for (const p of ["/", "/automations", "/memberships"]) revalidatePath(p);
    return ok({ queued: r.queued, statusChanges: r.status_changes, dispatch });
  });
}

export async function sendWhatsAppTest(): Promise<
  ActionResult<{ to: string; status: "sent" | "simulated" | "failed"; error: string | null }>
> {
  return guard(async () => {
    await authorize("automations.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_whatsapp_test");
    if (error) return fail(dbError(error));
    const r = data as { message_id: string; to: string };
    await dispatchDueMessages({ messageId: r.message_id });
    const { data: msg } = await supabase.from("whatsapp_messages").select("status, last_error").eq("id", r.message_id).single();
    revalidatePath("/automations");
    const status = msg?.status === "sent" || msg?.status === "delivered" || msg?.status === "read" ? "sent" : msg?.status === "simulated" ? "simulated" : "failed";
    return ok({ to: r.to, status, error: msg?.last_error ?? null });
  });
}
