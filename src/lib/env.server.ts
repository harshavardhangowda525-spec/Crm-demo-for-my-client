import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a client component fails the
 * build (via `server-only`), so the service-role key can never ship to browsers.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(16).optional(),
  PORTAL_SESSION_SECRET: z.string().min(32).optional(),
  WHATSAPP_PROVIDER: z.enum(["mock", "meta_cloud"]).default("mock"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
});

let cached: z.infer<typeof serverSchema> | undefined;

export function serverEnv() {
  cached ??= serverSchema.parse(process.env);
  return cached;
}
