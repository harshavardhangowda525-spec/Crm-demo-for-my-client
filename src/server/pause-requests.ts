"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, type ActionResult } from "@/lib/actions";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

export async function decidePauseRequest(input: { requestId: string; approve: boolean; note?: string }): Promise<ActionResult<{ status: string; newEndDate?: string }>> {
  return guard(async () => {
    await authorize("pauses.create");
    const v = z.object({ requestId: z.uuid(), approve: z.boolean(), note: z.string().trim().max(500).optional() }).safeParse(input);
    if (!v.success) return fail("Invalid request");
    if (!v.data.approve && (!v.data.note || v.data.note.length < 3)) return fail("Add a short reason so the member knows why.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_pause_request", {
      p_request_id: v.data.requestId,
      p_approve: v.data.approve,
      p_note: v.data.note ?? null,
    });
    if (error) return fail(dbError(error));
    // Approval queues the pause confirmation on WhatsApp — send it now.
    if (v.data.approve) await dispatchDueMessages({ limit: 5 }).catch((e) => console.error("[dispatch]", e));
    for (const p of ["/today", "/memberships", "/customers"]) revalidatePath(p);
    revalidatePath("/customers/[id]", "page");
    const r = data as { status: string; new_end_date?: string };
    return ok({ status: r.status, newEndDate: r.new_end_date });
  });
}
