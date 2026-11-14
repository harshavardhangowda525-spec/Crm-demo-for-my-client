import { Workflow } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { Badge, MESSAGE_TONE } from "@/components/ui/badge";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { RuleCard } from "@/components/automation/rule-card";
import { RunAutomationsNow } from "@/components/automation/run-now";
import { WhatsAppTestButton } from "@/components/automation/whatsapp-test";
import { RetryMessageButton } from "@/components/automation/retry-button";
import { formatDateTime, label, MESSAGE_PURPOSE, MESSAGE_STATUS } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getGym } from "@/server/queries";

export const metadata = { title: "Automations" };
const PAGE_SIZE = 25;

const RULES = [
  { key: "enquiry_follow_up", title: "Enquiry follow-up", trigger: "Daily at 9:00 AM for open enquiries whose follow-up date is today." },
  { key: "membership_confirmation", title: "Membership confirmation", trigger: "When a membership becomes active. Includes the secure member-portal link." },
  { key: "invoice_delivery", title: "Invoice delivery", trigger: "When an invoice is generated. Attaches the PDF via a signed, expiring link." },
  { key: "expiry_reminder", title: "Expiry reminder", trigger: "Daily at 9:00 AM — days before expiry are set in Settings." },
  { key: "pause_confirmation", title: "Pause confirmation", trigger: "When a pause is approved, with days used, days left and the new expiry." },
  { key: "renewal_follow_up", title: "Renewal follow-up", trigger: "Daily — a few days after a membership expires without renewal." },
  { key: "enquiry_thanks", title: "Enquiry thank-you", trigger: "Instantly when an enquiry is saved for a customer who opted in." },
  { key: "birthday", title: "Birthday wishes", trigger: "Daily at 9:00 AM for customers whose birthday is today." },
  { key: "anniversary", title: "Membership anniversary", trigger: "Daily — on the yearly anniversary of a current member's first membership." },
  { key: "win_back", title: "We haven't heard from you", trigger: "14 days after a membership expires without renewal." },
  { key: "owner_daily_briefing", title: "Morning briefing (to staff)", trigger: "Each staff member's chosen time — today's follow-ups, renewals, dues and birthdays." },
  { key: "owner_evening_summary", title: "Evening summary (to staff)", trigger: "Optional, each staff member's chosen time — what was done and what slipped." },
] as const;

const STATUS_VIEWS = [
  ["all", "All"],
  ["failed", "Failed"],
  ["simulated", "Simulated"],
  ["sent", "Sent"],
  ["delivered", "Delivered"],
  ["queued", "Queued"],
] as const;

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ status?: string; rule?: string; page?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const status = STATUS_VIEWS.some(([k]) => k === sp.status) ? sp.status! : "all";
  const rule = RULES.some((r) => r.key === sp.rule) ? sp.rule! : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const gym = await getGym(staff.gymId);

  const { data: rules } = await supabase.from("automation_rules").select("id, key, enabled, template_name, config").eq("gym_id", staff.gymId);
  const stats = await Promise.all(
    RULES.map(async (r) => {
      const base = () => supabase.from("automation_executions").select("id", { count: "exact", head: true }).eq("gym_id", staff.gymId).eq("rule_key", r.key);
      const [s, f, k, last] = await Promise.all([
        base().eq("status", "success"),
        base().eq("status", "failed"),
        base().eq("status", "skipped"),
        supabase.from("automation_executions").select("executed_at").eq("gym_id", staff.gymId).eq("rule_key", r.key).order("executed_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { success: s.count ?? 0, failed: f.count ?? 0, skipped: k.count ?? 0, last: last.data ? formatDateTime(last.data.executed_at) : null };
    }),
  );

  let mq = supabase
    .from("whatsapp_messages")
    .select("id, purpose, status, simulated, to_phone_e164, body_preview, last_error, delivery_note, attempts, created_at, customer_id, customers(full_name)", { count: "exact" })
    .eq("gym_id", staff.gymId);
  if (status !== "all") mq = mq.eq("status", status);
  if (rule) mq = mq.eq("purpose", rule);
  const { data: messages, count } = await mq.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const canManage = can(staff.role, "automations.manage");

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="WhatsApp"
        title="Automation Center"
        description="Deterministic, template-based messages. Every send is logged; nothing is reported as delivered unless WhatsApp confirms it."
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <WhatsAppTestButton />
              <RunAutomationsNow />
            </div>
          ) : undefined
        }
      />

      <GlassCard className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <Workflow className="size-5 text-cyan" />
        <span className="text-muted">Provider:</span>
        {gym.whatsapp_provider === "mock" ? (
          <>
            <Badge tone="violet">Sandbox (simulated)</Badge>
            <span className="text-muted">WhatsApp is not connected yet — messages are recorded as simulated and not delivered. Connect it in Settings.</span>
          </>
        ) : (
          <Badge tone="green">WhatsApp Business Platform</Badge>
        )}
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {RULES.map((r, i) => {
          const row = rules?.find((x) => x.key === r.key);
          if (!row) return null;
          return (
            <RuleCard
              key={r.key}
              index={i}
              title={r.title}
              trigger={r.trigger}
              ruleKey={r.key}
              canManage={canManage}
              stats={stats[i]}
              rule={{ id: row.id, enabled: row.enabled, template_name: row.template_name, body: String((row.config as { body?: string })?.body ?? "") }}
            />
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Execution history</h2>
        <FilterChips active={status} items={STATUS_VIEWS.map(([k, l]) => ({ key: k, label: l, href: `/automations?status=${k}${rule ? `&rule=${rule}` : ""}` }))} />
        <GlassCard className="p-2 md:p-3">
          {!messages?.length ? (
            <EmptyState icon={Workflow} title="No messages yet" description="Messages appear here as automations run." />
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {messages.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-3 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{(m.customers as unknown as { full_name: string } | null)?.full_name ?? formatPhone(m.to_phone_e164)}</p>
                      <Badge tone={MESSAGE_TONE[m.status]}>{label(MESSAGE_STATUS, m.status)}</Badge>
                      <span className="text-xs text-muted">{label(MESSAGE_PURPOSE, m.purpose)}</span>
                      {m.delivery_note && <Badge tone="amber">{m.delivery_note}</Badge>}
                    </div>
                    {m.body_preview && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{m.body_preview}</p>}
                    {m.last_error && <p className="mt-1 text-xs text-danger">{m.last_error}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-subtle">
                    <span>{formatDateTime(m.created_at)}</span>
                    {m.status === "failed" && can(staff.role, "messages.retry") && <RetryMessageButton messageId={m.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="px-3 pb-2">
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/automations?status=${status}${rule ? `&rule=${rule}` : ""}&page=${p}`} />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
