import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: () => ({}) }));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({}) }));

import { parseInbound } from "./inbound";

describe("parseInbound", () => {
  it("extracts text messages with the sender's name and ignores status updates", () => {
    const out = parseInbound({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1476411765553675" },
                contacts: [{ wa_id: "916360471652", profile: { name: "Harsha" } }],
                messages: [{ from: "916360471652", id: "wamid.A", timestamp: "1763190000", type: "text", text: { body: "  Hi  " } }],
              },
            },
            { value: { statuses: [{ id: "wamid.B", status: "delivered" }] } as never },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { phoneNumberId: "1476411765553675", from: "916360471652", name: "Harsha", id: "wamid.A", timestamp: 1763190000, text: "Hi", isText: true },
    ]);
  });

  it("keeps non-text messages for staff with a placeholder", () => {
    const [m] = parseInbound({ entry: [{ changes: [{ value: { messages: [{ from: "919900419971", id: "wamid.C", type: "image" }] } }] }] });
    expect(m).toMatchObject({ text: "[image message]", isText: false });
  });

  it("reads quick-reply button taps as text", () => {
    const [m] = parseInbound({ entry: [{ changes: [{ value: { messages: [{ from: "91990", id: "x", type: "button", button: { text: "Menu" } }] } }] }] });
    expect(m).toMatchObject({ text: "Menu", isText: true });
  });
});
