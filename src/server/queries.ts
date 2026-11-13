import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type PlanOption = {
  id: string;
  name: string;
  duration_value: number;
  duration_unit: "day" | "month";
  base_price_paise: number;
  gst_rate: number | null;
  pause_allowance_days: number;
  active: boolean;
  description: string | null;
  is_demo: boolean;
};
export type StaffOption = { staff_id: string; user_id: string; full_name: string; email: string; role: string; active: boolean };
export type GymSettings = {
  id: string;
  name: string;
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  postal_code: string | null;
  phone_e164: string | null;
  email: string | null;
  gstin: string | null;
  gst_enabled: boolean;
  default_gst_rate: number;
  sac_code: string;
  invoice_prefix: string;
  pause_max_days: number;
  reminder_offsets: number[];
  activation_rule: "full_payment" | "any_payment" | "immediate";
  renewal_follow_up_days: number;
  whatsapp_provider: "mock" | "meta_cloud";
  ai_summary_enabled: boolean;
  timezone: string;
};

export const getPlans = cache(async (gymId: string, includeInactive = false): Promise<PlanOption[]> => {
  const supabase = await createClient();
  let q = supabase
    .from("membership_plans")
    .select("id, name, duration_value, duration_unit, base_price_paise, gst_rate, pause_allowance_days, active, description, is_demo")
    .eq("gym_id", gymId)
    .order("sort_order")
    .order("base_price_paise");
  if (!includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as PlanOption[];
});

export const getStaffDirectory = cache(async (): Promise<StaffOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("staff_directory");
  return (data ?? []) as StaffOption[];
});

export const getGym = cache(async (gymId: string): Promise<GymSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("gyms").select("*").eq("id", gymId).single();
  if (error) throw error;
  return data as GymSettings;
});

/** Items for the header notification centre and the dashboard action centre. */
export const getActionCounts = cache(async (gymId: string, today: string) => {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const in7 = new Date(Date.parse(today + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
  const [followUps, expiring, unpaid, failed] = await Promise.all([
    supabase
      .from("enquiries")
      .select("id", head)
      .eq("gym_id", gymId)
      .in("status", ["new", "follow_up_pending", "interested"])
      .lte("follow_up_date", today),
    supabase.from("memberships").select("id", head).eq("gym_id", gymId).in("status", ["active", "paused"]).gte("end_date", today).lte("end_date", in7),
    supabase.from("invoices").select("id", head).eq("gym_id", gymId).eq("status", "issued").neq("payment_status", "paid"),
    supabase.from("whatsapp_messages").select("id", head).eq("gym_id", gymId).eq("status", "failed"),
  ]);
  return {
    followUps: followUps.count ?? 0,
    expiring: expiring.count ?? 0,
    unpaid: unpaid.count ?? 0,
    failed: failed.count ?? 0,
  };
});
