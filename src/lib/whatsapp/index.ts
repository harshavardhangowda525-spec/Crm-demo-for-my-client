import "server-only";
import { serverEnv } from "@/lib/env.server";
import { MetaCloudProvider } from "./meta";
import { MockProvider } from "./mock";
import type { WhatsAppProvider } from "./types";

/**
 * Picks the provider for a message. A message queued while the gym was on
 * "mock" is always simulated, so switching providers never sends old
 * simulated messages for real.
 */
export function providerFor(messageProvider: string): WhatsAppProvider {
  if (messageProvider === "meta_cloud") {
    const env = serverEnv();
    if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
      return new MetaCloudProvider(env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_ACCESS_TOKEN);
    }
    return {
      name: "meta_cloud",
      async send() {
        return { outcome: "failed", error: "WhatsApp Cloud API credentials are not configured", retryable: false };
      },
    };
  }
  return new MockProvider();
}

export type { OutgoingMessage, SendResult, WhatsAppProvider } from "./types";
