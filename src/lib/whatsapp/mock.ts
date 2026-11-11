import type { OutgoingMessage, SendResult, WhatsAppProvider } from "./types";

/**
 * Sandbox provider used until the WhatsApp Business Platform is connected.
 * It never contacts WhatsApp and always reports "simulated" — the CRM shows
 * these as simulated, never as sent or delivered.
 */
export class MockProvider implements WhatsAppProvider {
  readonly name = "mock" as const;
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[whatsapp:mock] → ${message.to} (${message.templateName}): ${message.bodyPreview ?? ""}`);
    }
    return { outcome: "simulated" };
  }
}
