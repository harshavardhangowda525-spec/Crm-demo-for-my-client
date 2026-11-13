import { formatInTimeZone } from "date-fns-tz";

export const BUSINESS_TZ = "Asia/Kolkata";

/** Paise → "₹3,540.00" (Indian digit grouping). */
export function formatINR(paise: number | bigint | null | undefined, opts: { decimals?: boolean } = {}) {
  const n = Number(paise ?? 0) / 100;
  const decimals = opts.decimals ?? !Number.isInteger(n);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(n);
}

/** Rupees string/number from a form → integer paise. Returns null if invalid. */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).replace(/[,\s₹]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Today's date (YYYY-MM-DD) in the gym's business timezone. */
export function todayISO(now: Date = new Date()) {
  return formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");
}

export function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string) {
  return Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / 86_400_000);
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DATE_SHORT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-11-10" → "10 Nov 2026" (date-only values are timezone-free). */
export function formatDate(iso: string | null | undefined, short = false) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (iso.length > 10) {
    return formatInTimeZone(d, BUSINESS_TZ, short ? "d MMM" : "d MMM yyyy");
  }
  return (short ? DATE_SHORT : DATE_FMT).format(d);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return formatInTimeZone(new Date(iso), BUSINESS_TZ, "d MMM yyyy, h:mm a");
}

export function relativeDays(iso: string, today = todayISO()) {
  const d = daysBetween(today, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// ---------------------------------------------------------------------------
// Status vocabularies (labels shown in the UI)
// ---------------------------------------------------------------------------
export const ENQUIRY_STATUS = {
  new: "New enquiry",
  follow_up_pending: "Follow-up pending",
  interested: "Interested",
  converted: "Converted",
  not_interested: "Not interested",
} as const;
export type EnquiryStatus = keyof typeof ENQUIRY_STATUS;

export const LIFECYCLE = {
  ...ENQUIRY_STATUS,
  active_member: "Active member",
  expired_member: "Expired member",
  no_enquiry: "No enquiry",
} as const;
export type Lifecycle = keyof typeof LIFECYCLE;

export const MEMBERSHIP_STATUS = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  expired: "Expired",
  cancelled: "Cancelled",
} as const;
export type MembershipStatus = keyof typeof MEMBERSHIP_STATUS;

export const ENQUIRY_SOURCES = {
  walk_in: "Walk-in",
  phone: "Phone call",
  instagram: "Instagram",
  facebook: "Facebook",
  website: "Website",
  referral: "Referral",
  google: "Google",
  other: "Other",
} as const;

export const PAYMENT_METHODS = {
  upi: "UPI",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const PAYMENT_STATUS = { unpaid: "Unpaid", partial: "Part-paid", paid: "Paid" } as const;

export const FOLLOW_UP_KINDS = {
  follow_up_call: "Phone call",
  follow_up_whatsapp: "WhatsApp chat",
  visit: "Gym visit",
} as const;

export const FOLLOW_UP_OUTCOMES = {
  reached: "Spoke with customer",
  no_answer: "No answer",
  call_back: "Asked to call back",
  interested: "Interested",
  not_interested: "Not interested",
} as const;

export const MESSAGE_PURPOSE = {
  enquiry_follow_up: "Enquiry follow-up",
  membership_confirmation: "Membership confirmation",
  invoice_delivery: "Invoice delivery",
  expiry_reminder: "Expiry reminder",
  pause_confirmation: "Pause confirmation",
  renewal_follow_up: "Renewal follow-up",
  enquiry_thanks: "Enquiry thank-you",
  birthday: "Birthday wishes",
  anniversary: "Membership anniversary",
  win_back: "Win-back",
  owner_daily_briefing: "Morning briefing",
  owner_evening_summary: "Evening summary",
  portal_link: "Member portal link",
  portal_otp: "Portal login code",
} as const;

export const MESSAGE_STATUS = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  cancelled: "Cancelled",
  simulated: "Simulated",
} as const;

export function label<T extends Record<string, string>>(map: T, key: string | null | undefined) {
  if (!key) return "—";
  return (map as Record<string, string>)[key] ?? key;
}
