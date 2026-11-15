import { daysBetween, formatDate, formatINR } from "@/lib/format";

/**
 * Rule-based WhatsApp menu bot. No AI: it answers only from the facts the
 * database hands it (this gym's info and the sender's own membership), so it
 * never invents prices, dates or policies. Anything it cannot answer is handed
 * to staff in the CRM inbox.
 */

export type BotPlan = {
  name: string;
  price_paise: number;
  duration_value: number;
  duration_unit: "day" | "month";
  gst_rate: number | null;
  pause_allowance_days: number;
  description: string | null;
};

export type BotContext = {
  gym: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    info: string | null;
    pause_max_days: number;
    gst_enabled: boolean;
    default_gst_rate: number;
  };
  today: string;
  plans: BotPlan[];
  member: null | {
    first_name: string;
    membership: null | {
      plan: string;
      status: "pending" | "active" | "paused" | "expired" | "cancelled";
      start_date: string;
      end_date: string;
      pause_days_used: number;
      pause_days_left: number;
    };
    unpaid_invoices: number;
    amount_due_paise: number;
    last_invoice: null | { number: string; date: string; total_paise: number; payment_status: "unpaid" | "partial" | "paid" };
  };
};

export type BotReply = { reply: string | null; needsStaff: boolean; intent: Intent };

export type Intent = "menu" | "membership" | "plans" | "timings" | "payments" | "pause" | "staff" | "thanks" | "unknown";

const KEYWORDS: [Intent, RegExp][] = [
  ["staff", /\b(staff|human|person|someone|call me|talk|speak|agent|manager|owner|trainer|complain|complaint|problem|issue|refund)\b/],
  ["pause", /\b(pause|paus|freeze|hold|break|leave|travel|vacation|holiday)\b/],
  ["payments", /\b(invoice|bill|receipt|payment|pay|paid|due|balance|pending amount|outstanding|gst bill)\b/],
  ["membership", /\b(membership|expir\w*|valid\w*|status|renew\w*|my plan|days left|end date|ends)\b/],
  ["plans", /\b(plans?|price|prices|pricing|fees?|cost|charges?|rates?|packages?|join|joining|offer|offers|discount)\b/],
  ["timings", /\b(timings?|time|times|open|opening|close|closing|hours?|address|location|where|directions?|map|sunday|holiday hours)\b/],
  ["thanks", /^(thanks?|thank you|thx|ty|ok|okay|okk|cool|great|nice|done|👍|🙏)[.! ]*$/],
  ["menu", /^(hi+|hello|hey|hii+|helo|menu|start|help|namaste|namaskara|good (morning|afternoon|evening)|0)[.! ]*$/],
];

export function detectIntent(text: string): Intent {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const digit = t.match(/^([0-6])(️?⃣)?[.)]?$/);
  if (digit) {
    return (["menu", "membership", "plans", "timings", "payments", "pause", "staff"] as const)[Number(digit[1])];
  }
  for (const [intent, re] of KEYWORDS) if (re.test(t)) return intent;
  return "unknown";
}

const FOOTER = "\n\nReply *MENU* to see all options.";

export function menuText(ctx: BotContext): string {
  const hello = ctx.member ? `Hi ${ctx.member.first_name}! 👋` : "Hi! 👋";
  return [
    `${hello} Welcome to *${ctx.gym.name}*. Reply with a number:`,
    "",
    "1️⃣ My membership (status & expiry)",
    "2️⃣ Plans & prices",
    "3️⃣ Timings & address",
    "4️⃣ Invoices & payments",
    "5️⃣ Pause my membership",
    "6️⃣ Talk to our team",
  ].join("\n");
}

function notFound(ctx: BotContext) {
  return `I couldn't find a ${ctx.gym.name} membership for this WhatsApp number. If you registered with a different number, please message us from that number, or reply *6* and our team will help.`;
}

function planLine(p: BotPlan, ctx: BotContext) {
  const dur = `${p.duration_value} ${p.duration_unit}${p.duration_value === 1 ? "" : "s"}`;
  const rate = p.gst_rate ?? ctx.gym.default_gst_rate;
  const gst = ctx.gym.gst_enabled && rate > 0 ? ` + ${Number(rate)}% GST` : "";
  return `• *${p.name}* — ${formatINR(p.price_paise)}${gst} (${dur})${p.description ? `\n   ${p.description}` : ""}`;
}

function membershipText(ctx: BotContext): { reply: string; needsStaff: boolean } {
  const m = ctx.member;
  if (!m) return { reply: notFound(ctx), needsStaff: false };
  const ms = m.membership;
  if (!ms) return { reply: `Hi ${m.first_name}, you don't have a membership with us yet. Reply *2* to see our plans.`, needsStaff: false };
  const left = daysBetween(ctx.today, ms.end_date);
  const end = formatDate(ms.end_date);
  switch (ms.status) {
    case "active":
      return {
        reply:
          `Hi ${m.first_name}, your *${ms.plan}* membership is *active* until *${end}*` +
          (left >= 0 ? ` (${left === 0 ? "ends today" : `${left} day${left === 1 ? "" : "s"} left`}).` : ".") +
          `\nPause days left: ${ms.pause_days_left}.` +
          (left <= 7 ? "\n\nTo renew, visit the front desk or reply *6* and our team will help." : ""),
        needsStaff: false,
      };
    case "paused":
      return { reply: `Hi ${m.first_name}, your *${ms.plan}* membership is currently *paused*. Your new expiry date is *${end}*.`, needsStaff: false };
    case "pending":
      return { reply: `Hi ${m.first_name}, your *${ms.plan}* membership is *pending activation* (starts ${formatDate(ms.start_date)}). Our team will confirm once payment is complete.`, needsStaff: false };
    case "expired":
      return { reply: `Hi ${m.first_name}, your *${ms.plan}* membership *ended on ${end}*. We'd love to have you back — visit the front desk to renew, or reply *6* and our team will help.`, needsStaff: false };
    default:
      return { reply: `Hi ${m.first_name}, I couldn't find an active membership. Reply *6* and our team will help.`, needsStaff: false };
  }
}

function paymentsText(ctx: BotContext): { reply: string; needsStaff: boolean } {
  const m = ctx.member;
  if (!m) return { reply: notFound(ctx), needsStaff: false };
  const lines: string[] = [];
  lines.push(
    m.unpaid_invoices > 0
      ? `Hi ${m.first_name}, you have *${formatINR(m.amount_due_paise, { decimals: true })}* due across ${m.unpaid_invoices} invoice${m.unpaid_invoices === 1 ? "" : "s"}. You can pay at the front desk.`
      : `Hi ${m.first_name}, you have *no pending payments*. 🎉`,
  );
  if (m.last_invoice) {
    const li = m.last_invoice;
    const st = li.payment_status === "paid" ? "Paid" : li.payment_status === "partial" ? "Part-paid" : "Unpaid";
    lines.push(`Latest invoice: *${li.number}* dated ${formatDate(li.date)} for ${formatINR(li.total_paise, { decimals: true })} — ${st}.`);
  }
  lines.push("Your invoices (PDF) are available in your member portal. Reply *6* if you need a copy here.");
  return { reply: lines.join("\n"), needsStaff: false };
}

function pauseText(ctx: BotContext): { reply: string; needsStaff: boolean } {
  const m = ctx.member;
  if (!m) return { reply: notFound(ctx), needsStaff: false };
  const ms = m.membership;
  if (!ms || (ms.status !== "active" && ms.status !== "paused")) {
    return { reply: `Hi ${m.first_name}, pauses are available on an active membership. Reply *1* to check your membership.`, needsStaff: false };
  }
  if (ms.status === "paused") return { reply: `Your membership is already paused. Your new expiry date is *${formatDate(ms.end_date)}*.`, needsStaff: false };
  if (ms.pause_days_left <= 0) {
    return { reply: `Hi ${m.first_name}, you have used all pause days on your *${ms.plan}* membership. Reply *6* if you'd like to talk to our team.`, needsStaff: false };
  }
  return {
    reply:
      `Hi ${m.first_name}, you have *${ms.pause_days_left} pause day${ms.pause_days_left === 1 ? "" : "s"}* left (up to ${ctx.gym.pause_max_days} days at a time). ` +
      "Your expiry date moves forward by the days you pause.\n\nTo request a pause, open your member portal, or reply with your dates (for example: *pause 10 Dec to 15 Dec*) and our team will confirm.",
    needsStaff: false,
  };
}

function timingsText(ctx: BotContext): { reply: string; needsStaff: boolean } {
  const parts: string[] = [];
  if (ctx.gym.info) parts.push(ctx.gym.info.trim());
  if (ctx.gym.address) parts.push(`📍 ${ctx.gym.address}`);
  if (ctx.gym.phone) parts.push(`📞 ${ctx.gym.phone}`);
  if (!parts.length) return { reply: "Our team will share our timings and address with you shortly.", needsStaff: true };
  return { reply: `*${ctx.gym.name}*\n${parts.join("\n")}`, needsStaff: false };
}

/** Decide the reply to one incoming message. `reply: null` means stay quiet. */
export function botReply(text: string, ctx: BotContext, opts: { handoffActive?: boolean } = {}): BotReply {
  const intent = detectIntent(text);

  // A member asked for a person and staff have not answered yet: don't talk
  // over the team, unless the member asks for the menu again.
  if (opts.handoffActive && intent !== "menu") return { reply: null, needsStaff: true, intent };

  switch (intent) {
    case "menu":
      return { reply: menuText(ctx), needsStaff: false, intent };
    case "membership": {
      const r = membershipText(ctx);
      return { reply: r.reply + FOOTER, needsStaff: r.needsStaff, intent };
    }
    case "plans": {
      if (!ctx.plans.length) return { reply: "Our team will share our current plans with you shortly." + FOOTER, needsStaff: true, intent };
      const lines = ctx.plans.slice(0, 12).map((p) => planLine(p, ctx));
      return { reply: `*${ctx.gym.name} — membership plans*\n${lines.join("\n")}\n\nVisit the front desk to join, or reply *6* to talk to our team.` + FOOTER, needsStaff: false, intent };
    }
    case "timings": {
      const r = timingsText(ctx);
      return { reply: r.reply + FOOTER, needsStaff: r.needsStaff, intent };
    }
    case "payments": {
      const r = paymentsText(ctx);
      return { reply: r.reply + FOOTER, needsStaff: r.needsStaff, intent };
    }
    case "pause": {
      const r = pauseText(ctx);
      // A message that already contains dates is a real pause request for staff.
      const hasDates = /\d/.test(text) && intent === "pause" && text.trim().length > 6;
      if (hasDates && ctx.member?.membership?.status === "active") {
        return { reply: "Thanks! I've passed your pause request to our team. They'll confirm here shortly.", needsStaff: true, intent };
      }
      return { reply: r.reply + FOOTER, needsStaff: r.needsStaff, intent };
    }
    case "staff":
      return { reply: "Sure — I've let our team know. Someone will reply here shortly. 🙂", needsStaff: true, intent };
    case "thanks":
      return { reply: "You're welcome! 🙂" + FOOTER, needsStaff: false, intent };
    default:
      return {
        reply: "Thanks for your message! I've passed it to our team and they'll reply here shortly.\n\nFor quick answers, reply *MENU*.",
        needsStaff: true,
        intent,
      };
  }
}
