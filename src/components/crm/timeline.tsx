import {
  BadgeCheck,
  CalendarClock,
  CircleDollarSign,
  CirclePause,
  FilePlus2,
  FileX2,
  MessageCircle,
  NotebookPen,
  RefreshCw,
  ShieldX,
  Sparkles,
  UserPen,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { formatDate, formatDateTime, formatINR, label, LIFECYCLE, MESSAGE_PURPOSE } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineEvent = {
  id: number;
  type: string;
  title: string;
  details: Record<string, unknown>;
  occurred_at: string;
  actor_type: string;
  actor_name: string | null;
};

const ICON: Record<string, [LucideIcon, string]> = {
  customer_created: [UserPlus, "text-cyan"],
  customer_updated: [UserPen, "text-muted"],
  enquiry_created: [Sparkles, "text-cyan"],
  enquiry_updated: [CalendarClock, "text-muted"],
  status_changed: [RefreshCw, "text-[#c4b5fd]"],
  note_added: [NotebookPen, "text-muted"],
  follow_up: [CalendarClock, "text-warning"],
  membership_created: [BadgeCheck, "text-lime"],
  membership_activated: [BadgeCheck, "text-lime"],
  renewal: [RefreshCw, "text-lime"],
  membership_cancelled: [ShieldX, "text-danger"],
  membership_expired: [ShieldX, "text-danger"],
  invoice_issued: [FilePlus2, "text-cyan"],
  invoice_cancelled: [FileX2, "text-danger"],
  payment_recorded: [CircleDollarSign, "text-success"],
  pause_approved: [CirclePause, "text-cyan"],
  whatsapp_message: [MessageCircle, "text-success"],
};

function describe(e: TimelineEvent): string | null {
  const d = e.details ?? {};
  const s = (k: string) => (d[k] == null ? "" : String(d[k]));
  switch (e.type) {
    case "status_changed":
      return `${label(LIFECYCLE, s("from"))} → ${label(LIFECYCLE, s("to"))}`;
    case "note_added":
    case "follow_up":
      return s("body");
    case "membership_created":
    case "membership_activated":
    case "renewal":
      return `${s("plan")} · ${formatDate(s("start_date"))} – ${formatDate(s("end_date"))}`;
    case "invoice_issued":
      return `${s("number")} · ${formatINR(Number(d.total_paise ?? 0), { decimals: true })}`;
    case "invoice_cancelled":
      return `${s("number")} · ${s("reason")}`;
    case "payment_recorded":
      return `${formatINR(Number(d.amount_paise ?? 0), { decimals: true })} via ${s("method").toUpperCase()} · ${s("invoice_number")}`;
    case "pause_approved":
      return `${formatDate(s("start_date"))} – ${formatDate(s("end_date"))} (${s("days")} days) · ${s("remaining")} left · new expiry ${formatDate(s("new_end_date"))}`;
    case "whatsapp_message":
      return `${label(MESSAGE_PURPOSE, s("purpose"))}${d.error ? ` · ${s("error")}` : ""}`;
    case "customer_updated":
      return Array.isArray(d.fields) ? `Changed ${(d.fields as string[]).join(", ")}` : null;
    case "enquiry_created":
      return d.follow_up_date ? `Follow-up on ${formatDate(s("follow_up_date"))}` : null;
    case "enquiry_updated":
      return d.follow_up_date ? `Next follow-up ${formatDate(s("follow_up_date"))}` : null;
    case "membership_cancelled":
      return s("reason");
    default:
      return null;
  }
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="py-6 text-center text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="relative space-y-1">
      <span aria-hidden className="absolute bottom-3 left-[19px] top-3 w-px bg-gradient-to-b from-white/15 via-white/8 to-transparent" />
      {events.map((e) => {
        const [Icon, tone] = ICON[e.type] ?? [Sparkles, "text-muted"];
        const text = describe(e);
        return (
          <li key={e.id} className="relative flex gap-3.5 py-2.5">
            <span className="metal relative z-10 grid size-10 shrink-0 place-items-center rounded-xl">
              <Icon className={cn("size-4", tone)} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-fg">{e.title}</p>
                <time className="text-[11.5px] text-subtle" dateTime={e.occurred_at}>
                  {formatDateTime(e.occurred_at)}
                </time>
              </div>
              {text && <p className="mt-0.5 whitespace-pre-line break-words text-[13px] text-muted">{text}</p>}
              <p className="mt-0.5 text-[11px] text-subtle">
                {e.actor_type === "system" ? "Automatic" : e.actor_type === "member" ? "By member (portal)" : e.actor_name ? `By ${e.actor_name}` : "Staff"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
