import "server-only";
import { serverEnv } from "@/lib/env.server";
import { publicEnv } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";
import { signDocumentPath } from "@/lib/signing";
import { providerFor } from "./index";

type ClaimedMessage = {
  id: string;
  to_phone_e164: string;
  template_name: string;
  template_language: string;
  template_params: unknown;
  document_path: string | null;
  provider: string;
  body_preview: string | null;
};

export type DispatchSummary = { claimed: number; sent: number; simulated: number; failed: number; skipped?: string };

/**
 * Claims due messages from the queue (row-locked, so concurrent runs never
 * double-send), sends each through its provider and records the outcome.
 */
export async function dispatchDueMessages(opts: { limit?: number; messageId?: string } = {}): Promise<DispatchSummary> {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return { claimed: 0, sent: 0, simulated: 0, failed: 0, skipped: "CRON_SECRET not configured" };

  const db = createAnonClient();
  const { data, error } = await db.rpc("dispatch_claim", {
    p_secret: secret,
    p_limit: opts.limit ?? 20,
    p_message_id: opts.messageId ?? null,
  });
  if (error) throw new Error(`dispatch_claim failed: ${error.message}`);

  const summary: DispatchSummary = { claimed: data?.length ?? 0, sent: 0, simulated: 0, failed: 0 };
  for (const m of (data ?? []) as ClaimedMessage[]) {
    const params = Array.isArray(m.template_params) ? m.template_params.map(String) : [];
    let documentUrl: string | undefined;
    const invoiceId = m.document_path?.startsWith("invoice:") ? m.document_path.slice(8) : null;
    if (invoiceId) documentUrl = publicEnv.NEXT_PUBLIC_APP_URL + signDocumentPath(secret, invoiceId);

    const result = await providerFor(m.provider).send({
      id: m.id,
      to: m.to_phone_e164,
      templateName: m.template_name,
      language: m.template_language,
      params,
      documentUrl,
      documentFilename: invoiceId ? "invoice.pdf" : undefined,
      bodyPreview: m.body_preview,
    });

    const { error: completeError } = await db.rpc("dispatch_complete", {
      p_secret: secret,
      p_message_id: m.id,
      p_outcome: result.outcome,
      p_provider_message_id: result.outcome === "sent" ? result.providerMessageId : null,
      p_error: result.outcome === "failed" ? result.error : null,
    });
    if (completeError) console.error("[dispatch] complete failed", m.id, completeError.message);
    summary[result.outcome === "sent" ? "sent" : result.outcome === "simulated" ? "simulated" : "failed"]++;
  }
  return summary;
}
