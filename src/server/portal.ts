"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/anon";
import { PORTAL_COOKIE, PORTAL_PENDING_COOKIE, portalCookieOptions } from "@/lib/portal";
import { dbError } from "@/lib/actions";
import { pauseSchema } from "@/lib/validation";

export async function portalVerify(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const jar = await cookies();
  const pending = jar.get(PORTAL_PENDING_COOKIE)?.value;
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!pending) return { error: "Please open the link from WhatsApp again." };
  if (code.length !== 6) return { error: "Enter the 6-digit code." };
  const [token, otpId] = pending.split(".");
  const { data, error } = await createAnonClient().rpc("portal_verify", { p_token: token, p_otp_id: otpId, p_code: code });
  if (error) return { error: dbError(error) };
  const r = data as { ok: boolean; session?: string; error?: string };
  if (!r.ok || !r.session) return { error: r.error ?? "Could not verify the code." };
  jar.delete(PORTAL_PENDING_COOKIE);
  jar.set(PORTAL_COOKIE, r.session, { ...portalCookieOptions, maxAge: 12 * 3600 });
  redirect("/portal");
}

export async function portalRequestPause(input: {
  membershipId: string;
  startDate: string;
  endDate: string;
  reason: string;
  idempotencyKey: string;
}): Promise<{ ok: true; data: { status: "pending" } } | { ok: false; error: string }> {
  const session = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!session) return { ok: false, error: "Your session has expired. Open the link from WhatsApp again." };
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the dates." };
  const v = parsed.data;
  if (!v.reason || v.reason.length < 3) return { ok: false, error: "Tell the gym the reason for your pause." };
  const { error } = await createAnonClient().rpc("portal_request_pause", {
    p_session: session,
    p_membership_id: v.membershipId,
    p_start: v.startDate,
    p_end: v.endDate,
    p_reason: v.reason,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "Your session has expired. Open the link from WhatsApp again." : dbError(error) };
  revalidatePath("/portal");
  return { ok: true, data: { status: "pending" } };
}

export async function portalSignOut() {
  const jar = await cookies();
  const session = jar.get(PORTAL_COOKIE)?.value;
  if (session) await createAnonClient().rpc("portal_sign_out", { p_session: session });
  jar.delete(PORTAL_COOKIE);
  redirect("/portal");
}

export async function portalResendCode(): Promise<{ error?: string; ok?: boolean }> {
  const pending = (await cookies()).get(PORTAL_PENDING_COOKIE)?.value;
  if (!pending) return { error: "Open the link from WhatsApp again." };
  const token = pending.split(".")[0];
  if (!z.string().regex(/^[0-9a-f]{64}$/).safeParse(token).success) return { error: "Invalid link." };
  redirect(`/portal/t/${token}`);
}
