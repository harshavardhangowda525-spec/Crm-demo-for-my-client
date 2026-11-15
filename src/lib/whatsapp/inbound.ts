import "server-only";
import { serverEnv } from "@/lib/env.server";
import { createAnonClient } from "@/lib/supabase/anon";
import { botReply, type BotContext } from "./bot";
import { sendWhatsAppText } from "./index";

/** One incoming message from Meta's webhook payload. */
export type InboundMessage = {
  phoneNumberId: string | null;
  from: string;
  name: string | null;
  id: string;
  timestamp: number | null;
  text: string;
  isText: boolean;
};

type MetaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: {
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    button?: { text?: string };
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  }[];
};

/** Pulls the member messages out of a webhook body (ignores status updates). */
export function parseInbound(body: { entry?: { changes?: { value?: MetaValue }[] }[] }): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v?.messages ?? []) {
        if (!m.from || !m.id) continue;
        const text =
          m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        const contact = v?.contacts?.find((c) => c.wa_id === m.from) ?? v?.contacts?.[0];
        out.push({
          phoneNumberId: v?.metadata?.phone_number_id ?? null,
          from: m.from,
          name: contact?.profile?.name ?? null,
          id: m.id,
          timestamp: m.timestamp ? Number(m.timestamp) : null,
          text: text?.trim() || `[${m.type ?? "unsupported"} message]`,
          isText: text != null && text.trim() !== "",
        });
      }
    }
  }
  return out;
}

type Received = {
  ok: boolean;
  duplicate?: boolean;
  inbound_id?: string;
  to?: string;
  bot_enabled?: boolean;
  reply_allowed?: boolean;
  handoff_active?: boolean;
  context?: BotContext;
};

/** Store an incoming message; returns what is needed to answer it. */
export async function receiveInbound(m: InboundMessage): Promise<Received | null> {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return null;
  const { data, error } = await createAnonClient().rpc("inbox_receive", {
    p_secret: secret,
    p_phone_number_id: m.phoneNumberId ?? "",
    p_from: m.from,
    p_name: m.name,
    p_wa_message_id: m.id,
    p_body: m.text,
    p_sent_at: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
  });
  if (error) {
    console.error("[inbox] receive failed", error.message);
    return null;
  }
  return data as Received;
}

/** Let the menu bot answer (or flag the chat for staff). */
export async function answerInbound(m: InboundMessage, r: Received): Promise<void> {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !r.ok || r.duplicate || !r.inbound_id || !r.to || !r.context) return;
  const db = createAnonClient();
  const flag = (needsStaff: boolean) =>
    db.rpc("inbox_record_reply", {
      p_secret: secret, p_inbound_id: r.inbound_id, p_body: null, p_wa_message_id: null, p_ok: true, p_needs_staff: needsStaff,
    });

  // Bot off: everything waits for staff in the inbox.
  if (!r.bot_enabled) return void (await flag(true));
  // Rate-limited or stale (Meta retried an old message): don't auto-reply.
  if (!r.reply_allowed) return void (await flag(true));

  const decision = m.isText
    ? botReply(m.text, r.context, { handoffActive: r.handoff_active })
    : { reply: "Thanks! I can only read text messages. Our team will take a look and reply here shortly.\n\nReply *MENU* for quick answers.", needsStaff: true };
  if (decision.reply == null) return void (await flag(decision.needsStaff));

  const sent = await sendWhatsAppText(r.to, decision.reply);
  const { error } = await db.rpc("inbox_record_reply", {
    p_secret: secret,
    p_inbound_id: r.inbound_id,
    p_body: decision.reply,
    p_wa_message_id: sent.ok ? sent.id : null,
    p_ok: sent.ok,
    p_error: sent.ok ? null : sent.error,
    p_needs_staff: decision.needsStaff,
  });
  if (error) console.error("[inbox] record reply failed", error.message);
}
