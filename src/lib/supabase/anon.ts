import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Session-less server client. Used for the member portal and the message
 * dispatcher, whose database functions authenticate the caller themselves
 * (portal session token or dispatch secret).
 */
export function createAnonClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
