import type { OutgoingMessage, SendResult, WhatsAppProvider } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Official WhatsApp Business Platform (Cloud API) provider. Sends approved
 * template messages only. Requires WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_ACCESS_TOKEN; templates must be approved in Meta Business Manager
 * with the same names and parameter order as automation_rules.
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta_cloud" as const;
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  async send(m: OutgoingMessage): Promise<SendResult> {
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
    let res: Response;
    try {
      res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: m.to.replace(/^\+/, ""),
          type: "template",
          template: { name: m.templateName, language: { code: m.language }, components },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { outcome: "failed", error: `Network error: ${(e as Error).message}`, retryable: true };
    }
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (res.ok && body.messages?.[0]?.id) return { outcome: "sent", providerMessageId: body.messages[0].id };
    const error = body.error?.message ?? `HTTP ${res.status}`;
    // 4xx (except rate limits) are permanent: bad template, invalid number…
    const retryable = res.status >= 500 || res.status === 429 || body.error?.code === 130429;
    return { outcome: "failed", error, retryable };
  }
}
