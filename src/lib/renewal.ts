/**
 * Renewal intelligence helpers (deterministic, no AI).
 */
export type RenewalStats = {
  customer_id: string;
  member_since: string;
  terms: number;
  renewals: number;
  lifetime_paid_paise: number;
  avg_days_late: number | null;
  last_renewal_days_late: number | null;
  last_plan_name: string;
  last_plan_id: string | null;
  last_price_paise: number;
  last_duration_value: number;
  last_duration_unit: "day" | "month";
  same_plan_streak: number;
  current_pause_days: number;
  longest_pause_days: number;
  unpaid_paise: number;
  latest_status: string;
  latest_end_date: string;
  risk: boolean;
  risk_reasons: string[];
};

type PlanLike = { id: string; name: string; duration_value: number; duration_unit: "day" | "month"; base_price_paise: number; active: boolean };

export type UpgradeHint = { planId: string; planName: string; savingPaise: number; termsCovered: number };

/**
 * After 3+ consecutive terms on the same short monthly plan, suggest the
 * shortest active longer plan that is cheaper than paying month by month.
 * Saving compares base prices (both taxed at the same rate).
 */
export function upgradeHint(stats: Pick<RenewalStats, "same_plan_streak" | "last_duration_value" | "last_duration_unit" | "last_price_paise" | "last_plan_id">, plans: PlanLike[]): UpgradeHint | null {
  if (stats.same_plan_streak < 3 || stats.last_duration_unit !== "month") return null;
  const months = stats.last_duration_value;
  const candidates = plans
    .filter((p) => p.active && p.id !== stats.last_plan_id && p.duration_unit === "month" && p.duration_value > months && p.duration_value % months === 0)
    .map((p) => {
      const termsCovered = p.duration_value / months;
      return { p, termsCovered, saving: termsCovered * stats.last_price_paise - p.base_price_paise };
    })
    .filter((c) => c.saving > 0)
    .sort((a, b) => a.p.duration_value - b.p.duration_value);
  const best = candidates[0];
  return best ? { planId: best.p.id, planName: best.p.name, savingPaise: best.saving, termsCovered: best.termsCovered } : null;
}

export function memberSinceLabel(sinceISO: string, todayISO: string) {
  const [y1, m1] = sinceISO.split("-").map(Number);
  const [y2, m2] = todayISO.split("-").map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1);
  if (months < 1) return "New this month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? "" : "s"}${rest ? ` ${rest} mo` : ""}`;
}
