import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneSearchPrefix } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+14155552671", "+14155552671"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "abcdefghij", "+91 12345"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("treats differently formatted copies of a number as the same customer", () => {
    const variants = ["98765 43210", "+91 9876543210", "0 98765-43210"];
    expect(new Set(variants.map((v) => normalizePhone(v))).size).toBe(1);
  });
});

describe("phoneSearchPrefix", () => {
  it("adds India country code for partial local input", () => {
    expect(phoneSearchPrefix("98765")).toBe("+9198765");
  });
  it("keeps explicit international prefixes", () => {
    expect(phoneSearchPrefix("+1415")).toBe("+1415");
  });
  it("needs at least three digits", () => {
    expect(phoneSearchPrefix("98")).toBeNull();
  });
  it("handles 91-prefixed full numbers", () => {
    expect(phoneSearchPrefix("919876543210")).toBe("+919876543210");
  });
});

describe("formatPhone", () => {
  it("formats E.164 for display", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });
});
