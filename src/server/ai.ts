"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, type ActionResult } from "@/lib/actions";
import { formatDate, formatINR, label, LIFECYCLE } from "@/lib/format";

const SYSTEM = `You summarise a gym CRM record for busy front-desk staff.
Write exactly three short lines in plain English, no bullets or headings:
1. Who they are and where they stand (member or enquiry, plan, renewal habits).
2. What they care about and any concerns or objections.
3. The single most useful next step, including any open promise.
Use only the facts provided. Do not invent prices, dates, discounts or policies, and do not
restate amounts unless they appear in the facts. Keep the whole summary under 70 words.`;

/**
 * Optional, feature-flagged summary. Never used for prices, dates, pauses or
 * invoices — those always come from the database.
 */
export async function summariseCustomer(customerId: string): Promise<ActionResult<{ summary: string }>> {
  return guard(async () => {
    const staff = await authorize("customers.read");
    if (!z.uuid().safeParse(customerId).success) return fail("Invalid customer");
    const key = serverEnv().ANTHROPIC_API_KEY;
    if (!key) return fail("AI summaries are not configured on the server (ANTHROPIC_API_KEY).");

    const supabase = await createClient();
    const [{ data: gym }, { data: c }, { data: tags }, { data: promises }, { data: notes }, { data: stats }] = await Promise.all([
      supabase.from("gyms").select("ai_summary_enabled").eq("id", staff.gymId).single(),
      supabase.from("customer_overview").select("*").eq("id", customerId).eq("gym_id", staff.gymId).maybeSingle(),
      supabase.from("customer_tag_links").select("customer_tags(label, kind)").eq("customer_id", customerId),
      supabase.from("customer_promises").select("body, due_date, status").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(10),
      supabase.from("enquiry_notes").select("kind, outcome, body, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(15),
      supabase.rpc("renewal_stats", { p_customer_ids: [customerId] }),
    ]);
    if (!gym?.ai_summary_enabled) return fail("AI summaries are turned off. An admin can enable them in Settings.");
    if (!c) return fail("Customer not found");

    const s = (stats as { terms: number; renewals: number; last_plan_name: string; avg_days_late: number | null; lifetime_paid_paise: number; risk_reasons: string[] }[] | null)?.[0];
    const facts = [
      `Name: ${c.full_name}`,
      `Status: ${label(LIFECYCLE, c.lifecycle)}`,
      c.interested_plan_name ? `Interested plan: ${c.interested_plan_name}` : null,
      c.membership_plan_name ? `Current/last membership: ${c.membership_plan_name}, ends ${formatDate(c.membership_end_date)} (${c.membership_status})` : null,
      s ? `Terms: ${s.terms}, renewals: ${s.renewals}, average days late to renew: ${s.avg_days_late ?? "n/a"}, lifetime paid: ${formatINR(s.lifetime_paid_paise)}` : null,
      s?.risk_reasons?.length ? `Risk signals: ${s.risk_reasons.join("; ")}` : null,
      c.preferred_contact_time ? `Prefers contact: ${c.preferred_contact_time}` : null,
      c.preferred_language ? `Language: ${c.preferred_language}` : null,
      `Tags: ${((tags ?? []) as unknown as { customer_tags: { label: string; kind: string } }[]).map((t) => `${t.customer_tags.kind === "objection" ? "concern" : "interest"}: ${t.customer_tags.label}`).join(", ") || "none"}`,
      `Promises: ${(promises ?? []).map((p) => `${p.body} (${p.status}${p.due_date ? `, by ${formatDate(p.due_date)}` : ""})`).join(" | ") || "none"}`,
      c.notes ? `Profile note: ${c.notes}` : null,
      `Recent notes (newest first):\n${(notes ?? []).map((n) => `- ${formatDate(n.created_at)} ${n.kind}${n.outcome ? ` (${n.outcome})` : ""}: ${n.body}`).join("\n") || "none"}`,
    ]
      .filter(Boolean)
      .join("\n");

    const client = new Anthropic({ apiKey: key });
    let summary = "";
    try {
      const response = await client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: `<customer_record>\n${facts}\n</customer_record>` }],
      });
      if (response.stop_reason === "refusal") return fail("The summary could not be generated for this record.");
      summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return fail("The AI service is busy. Try again in a minute.");
      if (e instanceof Anthropic.AuthenticationError) return fail("The AI API key is invalid.");
      if (e instanceof Anthropic.APIError) return fail(`AI service error (${e.status ?? "network"}).`);
      throw e;
    }
    if (!summary) return fail("The AI service returned an empty summary.");

    const { error } = await supabase.rpc("save_ai_summary", { p_customer_id: customerId, p_summary: summary });
    if (error) return fail(dbError(error));
    revalidatePath(`/customers/${customerId}`);
    return ok({ summary });
  });
}
