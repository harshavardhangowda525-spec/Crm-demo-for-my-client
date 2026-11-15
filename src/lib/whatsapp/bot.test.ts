import { describe, expect, it } from "vitest";
import { botReply, detectIntent, type BotContext } from "./bot";

const base: BotContext = {
  gym: { name: "Muscle House", phone: "+919876543210", email: null, address: "12 MG Road, Bengaluru", info: "Open 5 AM – 10 PM, Mon–Sat. Sunday 6 AM – 12 PM.", pause_max_days: 7, gst_enabled: true, default_gst_rate: 18 },
  today: "2026-11-15",
  plans: [
    { name: "Monthly", price_paise: 150000, duration_value: 1, duration_unit: "month", gst_rate: null, pause_allowance_days: 7, description: null },
    { name: "Quarterly", price_paise: 400000, duration_value: 3, duration_unit: "month", gst_rate: 18, pause_allowance_days: 7, description: "Best value" },
  ],
  member: {
    first_name: "Rahul",
    membership: { plan: "Quarterly", status: "active", start_date: "2026-09-01", end_date: "2026-11-20", pause_days_used: 2, pause_days_left: 5 },
    unpaid_invoices: 1,
    amount_due_paise: 120000,
    last_invoice: { number: "MH/26-27/0012", date: "2026-09-01", total_paise: 472000, payment_status: "partial" },
  },
};

describe("WhatsApp menu bot", () => {
  it("understands numbers, keycap emoji and common words", () => {
    expect(detectIntent("1")).toBe("membership");
    expect(detectIntent("2️⃣")).toBe("plans");
    expect(detectIntent("Hi")).toBe("menu");
    expect(detectIntent("hiii")).toBe("menu");
    expect(detectIntent("when does my membership expire?")).toBe("membership");
    expect(detectIntent("What are the fees")).toBe("plans");
    expect(detectIntent("what time do you open on sunday")).toBe("timings");
    expect(detectIntent("is any payment due")).toBe("payments");
    expect(detectIntent("I want to pause for a week")).toBe("pause");
    expect(detectIntent("can I talk to the manager")).toBe("staff");
    expect(detectIntent("thank you")).toBe("thanks");
    expect(detectIntent("do you have zumba classes")).toBe("unknown");
  });

  it("shows a personal menu", () => {
    const r = botReply("hello", base);
    expect(r.reply).toContain("Hi Rahul!");
    expect(r.reply).toContain("6️⃣ Talk to our team");
    expect(r.needsStaff).toBe(false);
  });

  it("answers membership status from the member's own data", () => {
    const r = botReply("1", base);
    expect(r.reply).toContain("*Quarterly* membership is *active* until *20 Nov 2026* (5 days left)");
    expect(r.reply).toContain("Pause days left: 5");
    expect(r.reply).toContain("To renew"); // ends within 7 days
  });

  it("lists plans with GST and never invents prices", () => {
    const r = botReply("2", base);
    expect(r.reply).toContain("*Monthly* — ₹1,500 + 18% GST (1 month)");
    expect(r.reply).toContain("*Quarterly* — ₹4,000 + 18% GST (3 months)");
    expect(botReply("2", { ...base, plans: [] }).needsStaff).toBe(true);
  });

  it("uses the gym info the owner typed in for timings", () => {
    const r = botReply("3", base);
    expect(r.reply).toContain("Open 5 AM – 10 PM");
    expect(r.reply).toContain("12 MG Road");
    const none = botReply("3", { ...base, gym: { ...base.gym, info: null, address: null, phone: null } });
    expect(none.needsStaff).toBe(true);
  });

  it("reports dues and the latest invoice", () => {
    const r = botReply("4", base);
    expect(r.reply).toContain("₹1,200.00");
    expect(r.reply).toContain("MH/26-27/0012");
    expect(r.reply).toContain("Part-paid");
  });

  it("explains pauses, and hands a dated request to staff", () => {
    expect(botReply("5", base).reply).toContain("*5 pause days* left");
    const req = botReply("pause 10 Dec to 15 Dec", base);
    expect(req.needsStaff).toBe(true);
    expect(req.reply).toContain("passed your pause request");
  });

  it("does not reveal anything to unknown numbers", () => {
    const stranger = { ...base, member: null };
    expect(botReply("1", stranger).reply).toContain("couldn't find");
    expect(botReply("4", stranger).reply).not.toContain("₹");
    expect(botReply("hi", stranger).reply).toContain("Hi! 👋");
  });

  it("hands unknown questions and 'talk to team' to staff", () => {
    expect(botReply("do you have zumba", base)).toMatchObject({ needsStaff: true, intent: "unknown" });
    expect(botReply("6", base)).toMatchObject({ needsStaff: true, intent: "staff" });
  });

  it("stays quiet while staff are handling the chat, except for the menu", () => {
    expect(botReply("ok when?", base, { handoffActive: true })).toMatchObject({ reply: null, needsStaff: true });
    expect(botReply("menu", base, { handoffActive: true }).reply).toContain("Reply with a number");
  });
});
