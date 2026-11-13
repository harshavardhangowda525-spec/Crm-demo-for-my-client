import { describe, expect, it } from "vitest";
import { memberSinceLabel, upgradeHint } from "./renewal";

const plans = [
  { id: "m", name: "Monthly", duration_value: 1, duration_unit: "month" as const, base_price_paise: 150000, active: true },
  { id: "q", name: "Quarterly", duration_value: 3, duration_unit: "month" as const, base_price_paise: 400000, active: true },
  { id: "h", name: "Half-yearly", duration_value: 6, duration_unit: "month" as const, base_price_paise: 750000, active: true },
  { id: "x", name: "Old annual", duration_value: 12, duration_unit: "month" as const, base_price_paise: 1000000, active: false },
];
const monthly = { same_plan_streak: 3, last_duration_value: 1, last_duration_unit: "month" as const, last_price_paise: 150000, last_plan_id: "m" };

describe("upgrade hint", () => {
  it("suggests Quarterly after 3 monthly renewals with the exact saving", () => {
    expect(upgradeHint(monthly, plans)).toEqual({ planId: "q", planName: "Quarterly", savingPaise: 50000, termsCovered: 3 });
  });
  it("needs at least 3 consecutive terms", () => {
    expect(upgradeHint({ ...monthly, same_plan_streak: 2 }, plans)).toBeNull();
  });
  it("ignores inactive plans and plans that are not cheaper", () => {
    const noSaving = plans.map((p) => (p.id === "q" ? { ...p, base_price_paise: 450000 } : p));
    expect(upgradeHint(monthly, noSaving)?.planId).toBe("h");
    expect(upgradeHint({ ...monthly, last_duration_value: 6, last_price_paise: 750000, last_plan_id: "h" }, plans)).toBeNull();
  });
  it("does not suggest for day-based plans", () => {
    expect(upgradeHint({ ...monthly, last_duration_unit: "day" }, plans)).toBeNull();
  });
  it("uses the discounted price actually paid", () => {
    expect(upgradeHint({ ...monthly, last_price_paise: 140000 }, plans)?.savingPaise).toBe(20000);
  });
});

describe("member since", () => {
  it("formats tenure", () => {
    expect(memberSinceLabel("2026-11-02", "2026-11-13")).toBe("New this month");
    expect(memberSinceLabel("2026-02-10", "2026-11-13")).toBe("9 months");
    expect(memberSinceLabel("2024-08-10", "2026-11-13")).toBe("2 years 3 mo");
  });
});
