import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { hmacHex, safeEqual } from "@/lib/signing";
import { createAnonClient } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = serverEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token") ?? "", token)) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type StatusEvent = { id: string; status: string; errors?: { title?: string; message?: string }[] };

/** Delivery status updates. Every request must carry Meta's HMAC signature. */
export async function POST(req: NextRequest) {
  const env = serverEnv();
  if (!env.WHATSAPP_APP_SECRET || !env.CRON_SECRET) return new Response("Not configured", { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!safeEqual(signature, `sha256=${hmacHex(env.WHATSAPP_APP_SECRET, raw)}`)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const db = createAnonClient();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        if (!st.id || !st.status) continue;
        const err = st.errors?.[0];
        await db.rpc("dispatch_status_update", {
          p_secret: env.CRON_SECRET,
          p_provider: "meta_cloud",
          p_provider_message_id: st.id,
          p_status: st.status,
          p_error: err ? (err.message ?? err.title ?? null) : null,
        });
      }
    }
  }
  return NextResponse.json({ received: true });
}
