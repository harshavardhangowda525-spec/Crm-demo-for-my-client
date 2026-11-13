import { NextResponse, type NextRequest } from "next/server";
import { getStaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { phoneSearchPrefix } from "@/lib/phone";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id, full_name, phone_e164, lifecycle, enquiry_status, last_enquiry_date, interested_plan_name, notes, " +
  "pending_follow_ups, membership_status, membership_plan_name, membership_end_date, follow_up_date";

/** Instant search: phone prefix (E.164-normalised) or name. RLS-scoped. */
export async function GET(req: NextRequest) {
  const staff = await getStaffContext();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  const q = raw.replace(/[^\p{L}\p{N}\s+]/gu, "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  let query = supabase.from("customer_overview").select(COLUMNS).eq("gym_id", staff.gymId).limit(8);
  const digits = q.replace(/\D/g, "");
  const prefix = phoneSearchPrefix(q);
  if (prefix && digits.length >= 3 && digits.length >= q.replace(/\s/g, "").length - 1) {
    query = query.or(`phone_e164.like.${prefix}*,phone_e164.like.*${digits}*`);
  } else {
    query = query.ilike("full_name", `%${q.replace(/\s+/g, "%")}%`);
  }
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Search failed" }, { status: 500 });
  const rows = (data ?? []) as unknown as { id: string }[];
  const ids = rows.map((r) => r.id);
  // Memory context for each match: tags, open promises, last conversation.
  const [{ data: tags }, { data: promises }, { data: notes }] = ids.length
    ? await Promise.all([
        supabase.from("customer_tag_links").select("customer_id, customer_tags(label, kind)").in("customer_id", ids),
        supabase.from("customer_promises").select("customer_id, body").in("customer_id", ids).eq("status", "open"),
        supabase.from("enquiry_notes").select("customer_id, body, created_at").in("customer_id", ids).order("created_at", { ascending: false }).limit(100),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const results = rows.map((r) => ({
    ...r,
    tags: ((tags ?? []) as unknown as { customer_id: string; customer_tags: { label: string; kind: string } }[])
      .filter((t) => t.customer_id === r.id)
      .map((t) => t.customer_tags),
    promises: (promises ?? []).filter((p) => p.customer_id === r.id).map((p) => p.body),
    last_note: (notes ?? []).find((n) => n.customer_id === r.id) ?? null,
  }));
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
