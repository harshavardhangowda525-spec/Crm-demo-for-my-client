export type OutgoingMessage = {
  id: string;
  to: string; // E.164
  templateName: string;
  language: string;
  params: string[];
  /** Public, short-lived URL of a PDF to attach as the template header. */
  documentUrl?: string;
  documentFilename?: string;
  bodyPreview: string | null;
  /** Authentication template: repeat the code as the copy-code button parameter. */
  otpButton?: boolean;
};

export type SendResult =
  | { outcome: "sent"; providerMessageId: string }
  | { outcome: "simulated" }
  | { outcome: "failed"; error: string; retryable: boolean };

export interface WhatsAppProvider {
  readonly name: "mock" | "meta_cloud";
  send(message: OutgoingMessage): Promise<SendResult>;
}
