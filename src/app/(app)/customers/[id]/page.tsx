import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, FileText, Mail, MessageCircle, Phone, ReceiptIndianRupee, UserRound } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { GlassCard } from "@/components/ui/card";
import { Badge, PAYMENT_TONE } from "@/components/ui/badge";
import { LifecycleBadge, MembershipBadge } from "@/components/crm/lifecycle-badge";
import { Timeline, type TimelineEvent } from "@/components/crm/timeline";
import { CustomerActions } from "@/components/crm/customer-actions";
import { PauseMeter } from "@/components/membership/pause-meter";
import { addDaysISO, daysBetween, ENQUIRY_SOURCES, formatDate, formatINR, label, PAYMENT_STATUS, todayISO } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getGym, getPlans, getStaffDirectory } from "@/server/queries";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const today = todayISO();

  const [{ data: c }, { data: pref }, { data: enquiries }, { data: memberships }, { data: invoices }, { data: events }, gym, plans, staffList] =
    await Promise.all([
      supabase.from("customer_overview").select("*").eq("id", id).eq("gym_id", staff.gymId).maybeSingle(),
      supabase.from("notification_preferences").select("whatsapp_opt_in").eq("customer_id", id).maybeSingle(),
      supabase
        .from("enquiries")
        .select("id, status, source, enquiry_date, follow_up_date, interested_plan_id, assigned_staff_id, membership_plans(name)")
        .eq("customer_id", id)
        .order("enquiry_date", { ascending: false }),
      supabase
        .from("memberships")
        .select(
          "id, plan_name, status, start_date, end_date, original_end_date, pause_allowance_days, pause_days_used, membership_pauses(start_date, end_date, days, status, requested_via)",
        )
        .eq("customer_id", id)
        .order("start_date", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, issue_date, total_paise, amount_paid_paise, payment_status, status")
        .eq("customer_id", id)
        .order("issue_date", { ascending: false }),
      supabase
        .from("activity_events")
        .select("id, type, title, details, occurred_at, actor_type, actor_user_id")
        .eq("customer_id", id)
        .order("occurred_at", { ascending: false })
        .limit(60),
      getGym(staff.gymId),
      getPlans(staff.gymId),
      getStaffDirectory(),
    ]);
  if (!c) notFound();

  const staffName = new Map(staffList.map((s) => [s.user_id, s.full_name]));
  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    ...e,
    details: (e.details ?? {}) as Record<string, unknown>,
    actor_name: e.actor_user_id ? (staffName.get(e.actor_user_id) ?? null) : null,
  }));

  const live = (memberships ?? []).find((m) => ["active", "paused", "pending"].includes(m.status)) ?? null;
  const openEnquiry = (enquiries ?? []).find((e) => ["new", "follow_up_pending", "interested"].includes(e.status)) ?? null;
  const latestEnd = (memberships ?? []).filter((m) => m.status !== "cancelled").map((m) => m.end_date).sort().at(-1);
  const assigned = staffList.find((s) => s.staff_id === c.assigned_staff_id);

  return (
    <div className="space-y-6">
      <Link href="/customers" className="focus-ring inline-flex items-center gap-1 rounded-lg text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> Customers
      </Link>

      <GlassCard glow="lime" className="p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <span className="metal grid size-14 shrink-0 place-items-center rounded-2xl font-display text-lg font-semibold">
              {c.full_name
                .split(" ")
                .map((p: string) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-semibold tracking-tight">{c.full_name}</h1>
                <LifecycleBadge lifecycle={c.lifecycle} />
                {c.is_demo && <Badge>Demo</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
                <a href={`tel:${c.phone_e164}`} className="inline-flex items-center gap-1.5 hover:text-fg">
                  <Phone className="size-3.5" /> {formatPhone(c.phone_e164)}
                </a>
                {c.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="size-3.5" /> {c.email}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="size-3.5" /> WhatsApp {pref?.whatsapp_opt_in ? "opted in" : "not opted in"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5" /> {assigned ? assigned.full_name : "Unassigned"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> Customer since {formatDate(c.created_at)}
                </span>
              </div>
              {c.notes && <p className="mt-3 max-w-2xl text-sm text-muted">“{c.notes}”</p>}
            </div>
          </div>
        </div>
        <div className="divider-metal my-5" />
        <CustomerActions
          customer={{
            id: c.id,
            full_name: c.full_name,
            phone_e164: c.phone_e164,
            email: c.email,
            date_of_birth: c.date_of_birth,
            gender: c.gender,
            notes: c.notes,
            assigned_staff_id: c.assigned_staff_id,
            whatsapp_opt_in: !!pref?.whatsapp_opt_in,
          }}
          enquiry={
            openEnquiry
              ? {
                  id: openEnquiry.id,
                  status: openEnquiry.status,
                  follow_up_date: openEnquiry.follow_up_date,
                  interested_plan_id: openEnquiry.interested_plan_id,
                  assigned_staff_id: openEnquiry.assigned_staff_id,
                }
              : null
          }
          plans={plans}
          staff={staffList}
          canCancel={can(staff.role, "memberships.cancel")}
          activation={{
            customerId: c.id,
            customerName: c.full_name,
            plans,
            defaultPlanId: openEnquiry?.interested_plan_id ?? null,
            gstEnabled: gym.gst_enabled,
            defaultGstRate: Number(gym.default_gst_rate),
            pauseMaxDays: gym.pause_max_days,
            activationRule: gym.activation_rule,
            canDiscount: can(staff.role, "memberships.discount"),
            earliestStart: live && latestEnd && latestEnd >= today ? addDaysISO(latestEnd, 1) : null,
          }}
          pausable={
            live && ["active", "paused", "pending"].includes(live.status)
              ? {
                  id: live.id,
                  plan_name: live.plan_name,
                  start_date: live.start_date,
                  end_date: live.end_date,
                  pause_allowance_days: live.pause_allowance_days,
                  pause_days_used: live.pause_days_used,
                  pauses: (live.membership_pauses ?? []).filter((p) => p.status === "approved"),
                }
              : null
          }
        />
      </GlassCard>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          {live && (
            <GlassCard className="p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Current membership</p>
                  <p className="mt-1 font-display text-xl font-semibold">{live.plan_name}</p>
                  <p className="text-sm text-muted">
                    {formatDate(live.start_date)} – {formatDate(live.end_date)}
                    {live.end_date !== live.original_end_date && ` (originally ${formatDate(live.original_end_date)})`}
                  </p>
                </div>
                <div className="text-right">
                  <MembershipBadge status={live.status} />
                  <p className="text-metric mt-2 text-4xl font-semibold text-lime">{Math.max(0, daysBetween(today, live.end_date) + 1)}</p>
                  <p className="text-xs text-muted">days remaining</p>
                </div>
              </div>
              <div className="mt-5">
                <p className="mb-2 text-sm text-muted">Pause allowance</p>
                <PauseMeter total={live.pause_allowance_days} used={live.pause_days_used} />
              </div>
              {(live.membership_pauses ?? []).filter((p) => p.status === "approved").length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm">
                  {(live.membership_pauses ?? [])
                    .filter((p) => p.status === "approved")
                    .map((p, i) => (
                      <li key={i} className="flex justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                        <span>
                          {formatDate(p.start_date)} – {formatDate(p.end_date)}
                        </span>
                        <span className="text-muted">
                          {p.days} days · {p.requested_via === "member_portal" ? "member" : "staff"}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </GlassCard>
          )}

          <GlassCard className="p-5 md:p-6">
            <h2 className="mb-2 font-display text-lg font-semibold">Activity timeline</h2>
            <Timeline events={timeline} />
          </GlassCard>
        </div>

        <div className="space-y-6">
          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Enquiries</h2>
            {!enquiries?.length ? (
              <p className="text-sm text-muted">No enquiries.</p>
            ) : (
              <ul className="space-y-2">
                {enquiries.map((e) => (
                  <li key={e.id} className="rounded-xl bg-white/[0.03] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    <div className="flex items-center justify-between gap-2">
                      <LifecycleBadge lifecycle={e.status} />
                      <span className="text-xs text-muted">{formatDate(e.enquiry_date)}</span>
                    </div>
                    <p className="mt-2 text-sm">
                      {(e.membership_plans as unknown as { name: string } | null)?.name ?? "No plan chosen"} ·{" "}
                      <span className="text-muted">{label(ENQUIRY_SOURCES, e.source)}</span>
                    </p>
                    {e.follow_up_date && <p className="mt-1 text-xs text-warning">Follow-up {formatDate(e.follow_up_date)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Invoices</h2>
            {!invoices?.length ? (
              <p className="text-sm text-muted">No invoices yet. Converting to a membership generates one.</p>
            ) : (
              <ul className="space-y-2">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/invoices/${i.id}`}
                      className="focus-ring flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[0.05]"
                    >
                      <ReceiptIndianRupee className="size-4 shrink-0 text-cyan" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{i.invoice_number}</p>
                        <p className="text-xs text-muted">{formatDate(i.issue_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm tabular-nums">{formatINR(i.total_paise)}</p>
                        {i.status === "cancelled" ? (
                          <Badge tone="neutral">Cancelled</Badge>
                        ) : (
                          <Badge tone={PAYMENT_TONE[i.payment_status]}>{label(PAYMENT_STATUS, i.payment_status)}</Badge>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {(memberships ?? []).length > (live ? 1 : 0) && (
            <GlassCard className="p-5">
              <h2 className="mb-3 font-display text-lg font-semibold">Membership history</h2>
              <ul className="space-y-2">
                {(memberships ?? [])
                  .filter((m) => m.id !== live?.id)
                  .map((m) => (
                    <li key={m.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 text-sm">
                      <span className="flex items-center gap-2">
                        <FileText className="size-4 text-muted" /> {m.plan_name}
                      </span>
                      <span className="flex items-center gap-2 text-muted">
                        {formatDate(m.end_date, true)} <MembershipBadge status={m.status} />
                      </span>
                    </li>
                  ))}
              </ul>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
