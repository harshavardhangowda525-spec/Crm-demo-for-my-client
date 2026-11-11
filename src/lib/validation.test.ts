import { describe, expect, it } from "vitest";
import { activationSchema, customerCreateSchema, pauseSchema } from "./validation";

describe("customer validation", () => {
  it("normalises the phone to E.164 so duplicates are detected regardless of formatting", () => {
    const a = customerCreateSchema.parse({ fullName: "Rahul Kumar", phone: "98765 43210" });
    const b = customerCreateSchema.parse({ fullName: "Rahul Kumar", phone: "+91-98765-43210" });
    expect(a.phone).toBe("+919876543210");
    expect(b.phone).toBe(a.phone);
  });
  it("rejects invalid numbers and empty names", () => {
    expect(customerCreateSchema.safeParse({ fullName: "R", phone: "12345" }).success).toBe(false);
  });
  it("does not allow 'converted' to be chosen manually", () => {
    expect(customerCreateSchema.safeParse({ fullName: "Rahul", phone: "9876543210", status: "converted" }).success).toBe(false);
  });
});

describe("pause validation", () => {
  it("requires end on/after start", () => {
    const base = { membershipId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    expect(pauseSchema.safeParse({ ...base, startDate: "2026-11-12", endDate: "2026-11-10" }).success).toBe(false);
    expect(pauseSchema.safeParse({ ...base, startDate: "2026-11-12", endDate: "2026-11-14" }).success).toBe(true);
  });
});

describe("activation validation", () => {
  it("requires an idempotency key and non-negative amounts", () => {
    const v = {
      customerId: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      startDate: "2026-11-10",
      amountPaidPaise: -1,
      paymentMethod: "upi",
      idempotencyKey: crypto.randomUUID(),
    };
    expect(activationSchema.safeParse(v).success).toBe(false);
    expect(activationSchema.safeParse({ ...v, amountPaidPaise: 0 }).success).toBe(true);
    expect(activationSchema.safeParse({ ...v, amountPaidPaise: 0, idempotencyKey: undefined }).success).toBe(false);
  });
});
