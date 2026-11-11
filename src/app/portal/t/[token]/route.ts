import { NextResponse, type NextRequest } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { PORTAL_COOKIE, PORTAL_PENDING_COOKIE, portalCookieOptions } from "@/lib/portal";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

export const dynamic = "force-dynamic";

/**
 * Exchanges the secret link for a session (or sends a WhatsApp code first),
 * then redirects so the token never stays in the address bar or history.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = req.nextUrl.clone();
  base.search = "";
  if (!/^[0-9a-f]{64}$/.test(token)) {
    base.pathname = "/portal";
    base.searchParams.set("error", "invalid");
    return NextResponse.redirect(base);
  }
  const { data, error } = await createAnonClient().rpc("portal_open", { p_token: token });
  const r = (data ?? {}) as { ok?: boolean; mode?: "link" | "otp"; session?: string; otp_id?: string; error?: string };
  if (error || !r.ok) {
    base.pathname = "/portal";
    base.searchParams.set("error", error?.code === "54000" ? "rate" : "invalid");
    return NextResponse.redirect(base);
  }
  if (r.mode === "link" && r.session) {
    base.pathname = "/portal";
    const res = NextResponse.redirect(base);
    res.cookies.set(PORTAL_COOKIE, r.session, { ...portalCookieOptions, maxAge: 12 * 3600 });
    return res;
  }
  await dispatchDueMessages({ limit: 5 }).catch(() => undefined);
  base.pathname = "/portal/verify";
  const res = NextResponse.redirect(base);
  res.cookies.set(PORTAL_PENDING_COOKIE, `${token}.${r.otp_id}`, { ...portalCookieOptions, maxAge: 15 * 60 });
  return res;
}
