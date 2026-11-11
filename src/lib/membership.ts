/**
 * Client-side mirrors of the database rules, used only for live previews.
 * The database functions remain the source of truth (and are tested to match).
 */

/** Last day of a membership term. Mirrors public.membership_end_date(). */
export function membershipEndDate(startISO: string, value: number, unit: "day" | "month"): string {
  const [y, m, d] = startISO.split("-").map(Number);
  if (unit === "day") {
    const t = new Date(Date.UTC(y, m - 1, d + value - 1));
    return t.toISOString().slice(0, 10);
  }
  const targetMonthIndex = m - 1 + value;
  const lastDayOfTarget = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate();
  if (d > lastDayOfTarget) {
    // clamped (e.g. 31 Jan + 1 month) → ends on the target month's last day
    return new Date(Date.UTC(y, targetMonthIndex, lastDayOfTarget)).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, targetMonthIndex, d - 1)).toISOString().slice(0, 10);
}

/** Intra-state GST split. Mirrors public.gst_breakdown(). */
export function gstBreakdown(taxablePaise: number, ratePercent: number) {
  const tax = Math.round((taxablePaise * ratePercent) / 100);
  const sgst = Math.floor(tax / 2);
  const cgst = tax - sgst;
  return { cgst, sgst, totalTax: tax };
}

export function priceBreakdown(basePaise: number, discountPaise: number, ratePercent: number) {
  const discount = Math.min(Math.max(discountPaise, 0), basePaise);
  const taxable = basePaise - discount;
  const gst = gstBreakdown(taxable, ratePercent);
  return { base: basePaise, discount, taxable, ...gst, total: taxable + gst.totalTax };
}

export function pauseAllowance(m: { pause_allowance_days: number; pause_days_used: number }) {
  const remaining = Math.max(0, m.pause_allowance_days - m.pause_days_used);
  return { used: m.pause_days_used, total: m.pause_allowance_days, remaining };
}

export function durationLabel(value: number, unit: "day" | "month") {
  if (unit === "day") return `${value} day${value === 1 ? "" : "s"}`;
  if (value === 12) return "12 months";
  return `${value} month${value === 1 ? "" : "s"}`;
}
