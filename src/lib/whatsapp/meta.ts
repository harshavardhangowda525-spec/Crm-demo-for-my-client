import type { OutgoingMessage, SendResult, WhatsAppProvider } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Meta error codes meaning "this template can't be used yet" (missing, not
 * approved in this language, paused, disabled or parameters out of sync).
 * The message itself is fine, so it can still go out as plain text.
 */
export const TEMPLATE_UNAVAILABLE_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);

/** Outside the 24-hour customer-service window, free-form messages are refused. */
const OUTSIDE_WINDOW_CODES = new Set([131047]);

export const TEXT_FALLBACK_NOTE = "Sent as text (template pending approval)";

type GraphResponse = { messages?: { id: string }[]; error?: { message?: string; code?: number } };

/**
 * Official WhatsApp Business Platform (Cloud API) provider. Sends approved
 * template messages. Requires WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_ACCESS_TOKEN; templates must be approved in Meta Business Manager
 * with the same names and parameter order as automation_rules.
 *
 * Backup: with `textFallback`, a message whose template is not approved yet is
 * resent as the same rendered text (invoices as a PDF document with the text
 * as caption). WhatsApp allows this only within 24 hours of the recipient's
 * last message to the business number.
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta_cloud" as const;
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly opts: { textFallback?: boolean } = {},
  ) {}

  private async post(payload: Record<string, unknown>): Promise<{ status: number; body: GraphResponse } | { networkError: string }> {
    try {
      const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as GraphResponse };
    } catch (e) {
      return { networkError: (e as Error).message };
    }
  }

  async send(m: OutgoingMessage): Promise<SendResult> {
    const to = m.to.replace(/^\+/, "");
    const components: unknown[] = [];
    if (m.documentUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "document", document: { link: m.documentUrl, filename: m.documentFilename ?? "invoice.pdf" } }],
      });
    }
    if (m.params.length) {
      components.push({ type: "body", parameters: m.params.map((text) => ({ type: "text", text: text.slice(0, 1024) })) });
    }
    // Authentication (one-time code) templates also need the code for their
    // "Copy code" button.
    if (m.otpButton && m.params[0]) {
      components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.params[0] }] });
    }

    const r = await this.post({ to, type: "template", template: { name: m.templateName, language: { code: m.language }, components } });
    if ("networkError" in r) return { outcome: "failed", error: `Network error: ${r.networkError}`, retryable: true };
    if (r.status < 300 && r.body.messages?.[0]?.id) return { outcome: "sent", providerMessageId: r.body.messages[0].id };

    const code = r.body.error?.code;
    if (this.opts.textFallback && code !== undefined && TEMPLATE_UNAVAILABLE_CODES.has(code) && m.bodyPreview) {
      return this.sendAsText(m, to, r.body.error?.message ?? `HTTP ${r.status}`);
    }
    return failure(r.status, r.body);
  }

  /** Same message, sent free-form (inside the 24-hour window). */
  private async sendAsText(m: OutgoingMessage, to: string, templateError: string): Promise<SendResult> {
    const text = m.bodyPreview!.slice(0, m.documentUrl ? 1024 : 4096);
    const payload = m.documentUrl
      ? { to, type: "document", document: { link: m.documentUrl, filename: m.documentFilename ?? "invoice.pdf", caption: text } }
      : { to, type: "text", text: { body: text, preview_url: true } };
    const r = await this.post(payload);
    if ("networkError" in r) return { outcome: "failed", error: `Network error: ${r.networkError}`, retryable: true };
    if (r.status < 300 && r.body.messages?.[0]?.id) {
      return { outcome: "sent", providerMessageId: r.body.messages[0].id, note: TEXT_FALLBACK_NOTE };
    }
    if (r.body.error?.code !== undefined && OUTSIDE_WINDOW_CODES.has(r.body.error.code)) {
      return {
        outcome: "failed",
        retryable: false,
        error: `Template not approved yet, and the text backup needs the customer to have messaged the business number in the last 24 hours. (${templateError})`,
      };
    }
    const f = failure(r.status, r.body);
    return f.outcome === "failed" ? { ...f, error: `Template not approved yet; text backup failed: ${f.error}` } : f;
  }
}

function failure(status: number, body: GraphResponse): SendResult {
  const error = body.error?.message ?? `HTTP ${status}`;
  // 4xx (except rate limits) are permanent: bad template, invalid number…
  const retryable = status >= 500 || status === 429 || body.error?.code === 130429;
  return { outcome: "failed", error, retryable };
}
