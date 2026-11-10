import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, STAFF_ROLES } from "./permissions";

describe("role-based permissions", () => {
  it("owners can do everything", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can("owner", p)).toBe(true);
    }
  });

  it("staff can run day-to-day operations", () => {
    expect(can("staff", "customers.write")).toBe(true);
    expect(can("staff", "memberships.activate")).toBe(true);
    expect(can("staff", "invoices.create")).toBe(true);
    expect(can("staff", "pauses.create")).toBe(true);
  });

  it("staff cannot manage settings, cancel invoices, discount or see analytics", () => {
    expect(can("staff", "settings.manage")).toBe(false);
    expect(can("staff", "invoices.cancel")).toBe(false);
    expect(can("staff", "memberships.discount")).toBe(false);
    expect(can("staff", "analytics.read")).toBe(false);
    expect(can("staff", "staff.manage")).toBe(false);
  });

  it("missing role has no permissions", () => {
    expect(can(null, "customers.read")).toBe(false);
    expect(can(undefined, "customers.read")).toBe(false);
  });

  it("every permission lists only known roles", () => {
    for (const roles of Object.values(PERMISSIONS)) {
      for (const r of roles) expect(STAFF_ROLES).toContain(r);
    }
  });
});
