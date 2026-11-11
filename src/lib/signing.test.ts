import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { signDocumentPath, verifyDocumentSignature } from "./signing";

describe("signed invoice links", () => {
  const id = "00000000-0000-0000-0000-000000000001";
  it("verifies its own signature", () => {
    const url = new URL("https://x" + signDocumentPath("secret-key-123", id));
    expect(verifyDocumentSignature("secret-key-123", id, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(true);
  });
  it("rejects tampered ids, wrong secrets and expired links", () => {
    const url = new URL("https://x" + signDocumentPath("secret-key-123", id));
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifyDocumentSignature("secret-key-123", id.replace(/1$/, "2"), exp, sig)).toBe(false);
    expect(verifyDocumentSignature("other", id, exp, sig)).toBe(false);
    expect(verifyDocumentSignature("secret-key-123", id, "1", sig)).toBe(false);
  });
});
