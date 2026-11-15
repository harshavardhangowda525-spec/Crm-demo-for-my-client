"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { sendWhatsAppText } from "@/lib/whatsapp";

const phone = z.string().regex(/^\+[1-9][0-9]{6,14}$/, "Invalid number");

export async function sendInboxReply(input: { phone: string; body: string }): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.write");
    const v = z.object({ phone, body: z.string().trim().min(1, "Write a reply").max(4000) }).safeParse(input);
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { data: win } = await supabase.rpc("inbox_window", { p_phone: v.data.phone });
    if (!(win as { open?: boolean } | null)?.open) {
      return fail("It's been more than 24 hours since this contact last messaged. WhatsApp only allows approved templates until they write again.");
    }
    const sent = await sendWhatsAppText(v.data.phone, v.data.body);
    const { error } = await supabase.rpc("inbox_record_staff_reply", {
      p_phone: v.data.phone,
      p_body: v.data.body,
      p_wa_message_id: sent.ok ? sent.id : null,
      p_ok: sent.ok,
      p_error: sent.ok ? null : sent.error,
    });
    if (error) return fail(dbError(error));
    revalidatePath("/inbox");
    return sent.ok ? ok(null) : fail(`WhatsApp did not accept the message: ${sent.error}`);
  });
}

export async function markInboxRead(contactPhone: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("customers.read");
    if (!phone.safeParse(contactPhone).success) return fail("Invalid number");
    const supabase = await createClient();
    const { error } = await supabase.rpc("inbox_mark_read", { p_phone: contactPhone });
    if (error) return fail(dbError(error));
    revalidatePath("/", "layout");
    return ok(null);
  });
}

export async function saveAutoReply(input: { enabled: boolean; info: string }): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("automations.manage");
    const v = z.object({ enabled: z.boolean(), info: z.string().max(4000, "Keep it under 4000 characters") }).safeParse(input);
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_auto_reply", { p_enabled: v.data.enabled, p_info: v.data.info });
    if (error) return fail(dbError(error));
    revalidatePath("/inbox");
    return ok(null);
  });
}
