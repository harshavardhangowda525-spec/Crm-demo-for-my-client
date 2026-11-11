import { describe, expect, it } from "vitest";
import { gstBreakdown, membershipEndDate, priceBreakdown } from "./membership";
import { rupeesToPaise, formatINR, addDaysISO, daysBetween } from "./format";

describe("membershipEndDate (mirrors the database)", () => {
  it.each([
    ["2026-11-10", 1, "month", "2026-12-09"],
    ["2026-01-31", 1, "month", "2026-02-28"],
    ["2028-01-31", 1, "month", "2028-02-29"],
    ["2028-01-29", 1, "month", "2028-02-28"],
    ["2026-03-01", 1, "month", "2026-03-31"],
    ["2026-11-30", 3, "month", "2027-02-28"],
    ["2027-02-28", 12, "month", "2028-02-27"],
    ["2026-12-31", 30, "day", "2027-01-29"],
    ["2026-12-15", 6, "month", "2027-06-14"],
  ] as const)("%s + %d %s → %s", (start, n, unit, end) => {
    expect(membershipEndDate(start, n, unit)).toBe(end);
  });
});

describe("GST", () => {
  it("₹3,000 at 18% → ₹540 tax, ₹3,540 total", () => {
    const p = priceBreakdown(300000, 0, 18);
    expect(p.totalTax).toBe(54000);
    expect(p.cgst).toBe(27000);
    expect(p.sgst).toBe(27000);
    expect(p.total).toBe(354000);
  });
  it("splits odd paise so CGST + SGST equals the tax", () => {
    const g = gstBreakdown(99999, 18);
    expect(g.cgst + g.sgst).toBe(g.totalTax);
    expect(g.totalTax).toBe(18000);
  });
  it("applies discount before tax and never below zero", () => {
    expect(priceBreakdown(300000, 50000, 18).taxable).toBe(250000);
    expect(priceBreakdown(300000, 999999, 18).total).toBe(0);
  });
  it("0% rate → no tax", () => {
    expect(priceBreakdown(150000, 0, 0).total).toBe(150000);
  });
});

describe("money and dates", () => {
  it("parses rupee input to paise", () => {
    expect(rupeesToPaise("3,540")).toBe(354000);
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("1.234")).toBeNull();
  });
  it("formats INR with Indian grouping", () => {
    expect(formatINR(12345600)).toBe("₹1,23,456");
    expect(formatINR(354050)).toBe("₹3,540.50");
  });
  it("date helpers cross month and leap boundaries", () => {
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });
});
