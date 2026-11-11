import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacHex(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Short-lived signed path for documents fetched by WhatsApp's servers. */
export function signDocumentPath(secret: string, invoiceId: string, ttlSeconds = 7 * 24 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmacHex(secret, `invoice:${invoiceId}:${exp}`);
  return `/api/documents/invoice/${invoiceId}?exp=${exp}&sig=${sig}`;
}

export function verifyDocumentSignature(secret: string, invoiceId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmacHex(secret, `invoice:${invoiceId}:${exp}`), sig);
}
