import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "./mock";
import { MetaCloudProvider } from "./meta";

const msg = { id: "m1", to: "+919876543210", templateName: "membership_confirmation", language: "en", params: ["Rahul"], bodyPreview: "Hi Rahul" };

describe("WhatsApp providers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mock provider never claims a real send", async () => {
    expect(await new MockProvider().send(msg)).toEqual({ outcome: "simulated" });
  });

  it("meta provider returns the provider message id on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 }));
    expect(await new MetaCloudProvider("123", "token").send(msg)).toEqual({ outcome: "sent", providerMessageId: "wamid.123" });
  });

  it("meta provider reports permanent failures as non-retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Template not found", code: 132001 } }), { status: 400 }),
    );
    expect(await new MetaCloudProvider("123", "token").send(msg)).toEqual({ outcome: "failed", error: "Template not found", retryable: false });
  });

  it("meta provider treats network errors and 5xx as retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const r = await new MetaCloudProvider("123", "token").send(msg);
    expect(r.outcome).toBe("failed");
    expect(r.outcome === "failed" && r.retryable).toBe(true);
  });

  it("sends template parameters and the invoice document header", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "w" }] })));
    await new MetaCloudProvider("123", "token").send({ ...msg, documentUrl: "https://x/doc.pdf" });
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(body.to).toBe("919876543210");
    expect(body.template.components[0].type).toBe("header");
    expect(body.template.components[1].parameters[0].text).toBe("Rahul");
  });
});
