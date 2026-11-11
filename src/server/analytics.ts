import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, daysBetween, todayISO } from "@/lib/format";

export type Metrics = {
  active_memberships: number;
  paused_memberships: number;
  pending_enquiries: number;
  expiring_soon: number;
  collected_paise: number;
  new_customers: number;
  new_memberships: number;
  renewals: number;
  expired_in_range: number;
  enquiries_in_range: number;
  converted_in_range: number;
  outstanding_paise: number;
  outstanding_count: number;
  failed_messages: number;
  follow_ups_logged: number;
  follow_up_conversions: number;
  plan_distribution: { plan: string; count: number }[];
  plan_popularity: { plan: string; count: number }[];
  today: string;
};

export function resolveRange(sp: { bucket?: string; from?: string; to?: string }) {
  const today = todayISO();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  let bucket = (["day", "week", "month"] as const).find((b) => b === sp.bucket) ?? "day";
  let from: string;
  let to = sp.to && iso.test(sp.to) ? sp.to : today;
  if (sp.from && iso.test(sp.from)) {
    from = sp.from;
    if (from > to) [from, to] = [to, from];
    const span = daysBetween(from, to);
    if (!sp.bucket) bucket = span > 120 ? "month" : span > 45 ? "week" : "day";
  } else {
    from = bucket === "day" ? addDaysISO(to, -29) : bucket === "week" ? addDaysISO(to, -7 * 11) : addDaysISO(to.slice(0, 8) + "01", -334).slice(0, 8) + "01";
  }
  return { bucket, from, to };
}

export async function loadMetrics(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: from, p_to: to });
  if (error) throw error;
  return data as Metrics;
}

export async function loadRevenue(from: string, to: string, bucket: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revenue_series", { p_from: from, p_to: to, p_bucket: bucket });
  if (error) throw error;
  return (data ?? []) as { bucket: string; collected_paise: number }[];
}
