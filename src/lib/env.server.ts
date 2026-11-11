import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a client component fails the
 * build (via `server-only`), so the service-role key can never ship to browsers.
 */
const serverSchema = z.object({
  // Optional: only the owner bootstrap script needs it. The app itself never
  // uses the service role; privileged work runs in checked database functions.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  // Shared with the database (private.app_secrets 'dispatch'): authenticates
  // the scheduler → app calls and the app → dispatcher RPCs.
  CRON_SECRET: z.string().min(32).optional(),
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
