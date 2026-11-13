"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  AlarmClock,
  BellRing,
  CakeSlice,
  CalendarClock,
  Check,
  ChevronRight,
  CirclePause,
  HandHeart,
  MessageCircle,
  Phone,
  RefreshCw,
  UserRoundX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { markTodayItem } from "@/server/memory";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { TagChips } from "@/components/memory/tag-chips";

export type TodayItem = {
  kind: "follow_up" | "promise" | "task" | "renewal" | "win_back" | "unpaid" | "birthday" | "pause_end";
  key: string;
  priority: number;
  label: string;
  detail: string;
  href: string;
  due: string;
  customer: { id: string; name: string; phone: string; contact_time: string | null; language: string | null } | null;
  tags: { label: string; kind: string }[];
  promises: string[];
  last_note: { body: string; at: string; by: string; kind: string } | null;
};

const KIND: Record<TodayItem["kind"], { icon: LucideIcon; tone: string; filter: string }> = {
  follow_up: { icon: CalendarClock, tone: "text-warning", filter: "Follow-ups" },
  promise: { icon: HandHeart, tone: "text-lime", filter: "Promises" },
  task: { icon: BellRing, tone: "text-cyan", filter: "Reminders" },
  renewal: { icon: RefreshCw, tone: "text-lime", filter: "Renewals" },
  win_back: { icon: UserRoundX, tone: "text-danger", filter: "Win back" },
  unpaid: { icon: Wallet, tone: "text-warning", filter: "Payments" },
  birthday: { icon: CakeSlice, tone: "text-[#f0abfc]", filter: "Birthdays" },
  pause_end: { icon: CirclePause, tone: "text-cyan", filter: "Back from pause" },
};

const PRIORITY = { 1: "Act now", 2: "Today", 3: "This week", 4: "When you have time" } as const;

/** Pre-filled WhatsApp chat text — a staff member sends it from their own phone. */
function whatsappText(it: TodayItem, gymName: string) {
  const first = it.customer?.name.split(" ")[0] ?? "";
  switch (it.kind) {
    case "birthday":
      return `Happy birthday, ${first}! Everyone at ${gymName} wishes you a great year ahead.`;
    case "renewal":
      return `Hi ${first}, your membership at ${gymName} is ending soon (${it.detail}). Shall I renew it for you?`;
    case "win_back":
      return `Hi ${first}, we miss you at ${gymName}! Would you like to restart your membership?`;
    case "unpaid":
      return `Hi ${first}, a gentle reminder about the pending balance at ${gymName} (${it.detail}).`;
    case "promise":
      return `Hi ${first}, as promised: ${it.detail}`;
    default:
      return `Hi ${first}, this is ${gymName}. Just checking in about your membership enquiry.`;
  }
}

export function TodayList({ items, gymName }: { items: TodayItem[]; gymName: string }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<string>("all");
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [, start] = React.useTransition();

  const visible = items.filter((i) => !hidden.has(i.key) && (filter === "all" || i.kind === filter));
  const counts = items.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});

  const act = (it: TodayItem, action: "done" | "snooze", days = 1) => {
    setHidden((h) => new Set(h).add(it.key));
    start(async () => {
      const r = await markTodayItem(it.key, action, days);
      if (!r.ok) {
        setHidden((h) => {
          const n = new Set(h);
          n.delete(it.key);
          return n;
        });
        toast.error(r.error);
        return;
      }
      toast.success(action === "done" ? "Done" : `Snoozed for ${days === 7 ? "a week" : `${days} day${days === 1 ? "" : "s"}`}`);
      router.refresh();
    });
  };

  const groups = ([1, 2, 3, 4] as const).map((p) => ({ p, list: visible.filter((i) => i.priority === p) })).filter((g) => g.list.length);

  return (
    <div className="space-y-5">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:px-0">
        <Chip on={filter === "all"} onClick={() => setFilter("all")} label="Everything" count={items.length - hidden.size} />
        {(Object.keys(KIND) as TodayItem["kind"][])
          .filter((k) => counts[k])
          .map((k) => (
            <Chip key={k} on={filter === k} onClick={() => setFilter(k)} label={KIND[k].filter} count={counts[k]} />
          ))}
      </div>

      {groups.length === 0 && (
        <div className="glass flex flex-col items-center p-10 text-center">
          <span className="metal grid size-14 place-items-center rounded-2xl">
            <Check className="size-6 text-lime" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">All caught up</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Nothing needs attention right now. New follow-ups, renewals, birthdays and promises will appear here automatically.
          </p>
        </div>
      )}

      {groups.map(({ p, list }) => (
        <section key={p}>
          <h2 className={cn("mb-2.5 px-1 text-xs font-semibold uppercase tracking-[0.16em]", p === 1 ? "text-danger" : p === 2 ? "text-lime" : "text-muted")}>
            {PRIORITY[p]} · {list.length}
          </h2>
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {list.map((it) => {
                const k = KIND[it.kind];
                const Icon = k.icon;
                const phone = it.customer?.phone;
                return (
                  <motion.li
                    key={it.key}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 40, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.22 }}
                    className="glass overflow-hidden p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="metal grid size-11 shrink-0 place-items-center rounded-xl">
                        <Icon className={cn("size-5", k.tone)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-xs font-semibold", k.tone)}>{it.label}</p>
                        <Link href={it.href} className="focus-ring mt-0.5 block rounded font-display text-[17px] font-semibold text-fg hover:underline">
                          {it.customer?.name ?? it.detail}
                        </Link>
                        {it.customer && <p className="text-[13px] text-muted">{it.detail}</p>}
                        {it.customer?.contact_time && (
                          <p className="mt-0.5 text-[11.5px] text-subtle">
                            Prefers {it.customer.contact_time === "any" ? "any time" : it.customer.contact_time}
                            {it.customer.language ? ` · ${it.customer.language}` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    {(it.tags.length > 0 || it.promises.length > 0 || it.last_note) && (
                      <div className="mt-3 space-y-2 rounded-xl bg-white/[0.025] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                        <TagChips tags={it.tags} max={4} />
                        {it.promises.map((pr) => (
                          <p key={pr} className="flex items-start gap-1.5 text-[13px] text-lime">
                            <HandHeart className="mt-0.5 size-3.5 shrink-0" /> Promised: {pr}
                          </p>
                        ))}
                        {it.last_note && (
                          <p className="text-[13px] text-muted">
                            <span className="text-subtle">Last time ({it.last_note.by}, {formatDateTime(it.last_note.at)}):</span> “{it.last_note.body}”
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
                      {phone ? (
                        <a href={`tel:${phone}`} className={btn} aria-label={`Call ${formatPhone(phone)}`}>
                          <Phone className="size-4" /> <span>Call</span>
                        </a>
                      ) : (
                        <span />
                      )}
                      {phone ? (
                        <a
                          href={`https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(whatsappText(it, gymName))}`}
                          target="_blank"
                          rel="noopener"
                          className={btn}
                        >
                          <MessageCircle className="size-4 text-success" /> <span>WhatsApp</span>
                        </a>
                      ) : (
                        <span />
                      )}
                      <button type="button" onClick={() => act(it, "done")} className={cn(btn, "text-lime")}>
                        <Check className="size-4" /> <span>Done</span>
                      </button>
                      <Dropdown.Root>
                        <Dropdown.Trigger className={btn}>
                          <AlarmClock className="size-4" /> <span>Snooze</span>
                        </Dropdown.Trigger>
                        <Dropdown.Portal>
                          <Dropdown.Content align="end" sideOffset={6} className="glass z-50 w-44 p-1.5">
                            {([1, 3, 7] as const).map((d) => (
                              <Dropdown.Item
                                key={d}
                                onSelect={() => act(it, "snooze", d)}
                                className="flex h-11 cursor-pointer items-center rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-white/5"
                              >
                                {d === 1 ? "Tomorrow" : d === 3 ? "In 3 days" : "Next week"}
                              </Dropdown.Item>
                            ))}
                          </Dropdown.Content>
                        </Dropdown.Portal>
                      </Dropdown.Root>
                      <Link href={it.href} className={cn(btn, "col-span-4 sm:col-span-1 sm:ml-auto")}>
                        Open <ChevronRight className="size-4" />
                      </Link>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
}

const btn =
  "focus-ring inline-flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-colors hover:bg-white/[0.04] hover:text-fg sm:h-10 sm:flex-row sm:gap-1.5 sm:px-3.5 sm:text-[13px]";

function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "focus-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium",
        on ? "bg-lime/12 text-lime shadow-[inset_0_0_0_1px_rgb(198_255_69/0.3)]" : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-fg",
      )}
    >
      {label} <span className={cn("text-[11px] tabular-nums", on ? "text-lime/80" : "text-subtle")}>{count}</span>
    </button>
  );
}
