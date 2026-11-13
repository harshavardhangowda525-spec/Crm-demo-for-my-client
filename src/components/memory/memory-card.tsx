"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brain, Check, Clock, HandHeart, Languages, MessageSquareQuote, Pencil, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { GlassCard } from "@/components/ui/card";
import { addPromise, resolvePromise, setCustomerPreferences, setCustomerTags } from "@/server/memory";
import { summariseCustomer } from "@/server/ai";
import { formatDate, formatDateTime, relativeDays, todayISO, addDaysISO } from "@/lib/format";
import { TagChips } from "./tag-chips";
import { TagPicker, type TagOption } from "./tag-picker";

export type MemoryData = {
  customerId: string;
  customerName: string;
  tags: TagOption[];
  selectedTagIds: string[];
  promises: { id: string; body: string; due_date: string | null; status: string }[];
  contactTime: string | null;
  language: string | null;
  lastNote: { body: string; at: string; by: string; kind: string } | null;
  aiEnabled: boolean;
  aiSummary: string | null;
  aiSummaryAt: string | null;
};

const CONTACT = { morning: "Mornings", afternoon: "Afternoons", evening: "Evenings", any: "Any time" } as const;

/** Everything the gym should remember about this person, in one card. */
export function MemoryCard({ data }: { data: MemoryData }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<"tags" | "promise" | "prefs" | null>(null);
  const [selected, setSelected] = React.useState(data.selectedTagIds);
  const [pending, start] = React.useTransition();
  const [summarising, startSummary] = React.useTransition();
  const today = todayISO();
  const openPromises = data.promises.filter((p) => p.status === "open");
  const selectedTags = data.tags.filter((t) => data.selectedTagIds.includes(t.id));

  const done = (msg: string) => {
    toast.success(msg);
    setOpen(null);
    router.refresh();
  };

  return (
    <GlassCard glow="cyan" className="p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Brain className="size-5 text-cyan" /> Memory
        </h2>
        <span className="text-xs text-subtle">What we know about {data.customerName.split(" ")[0]}</span>
      </div>

      {data.aiEnabled && (
        <div className="mt-4 rounded-2xl bg-[#a78bfa]/[0.07] p-4 shadow-[inset_0_0_0_1px_rgb(167_139_250/0.2)]">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#c4b5fd]">
              <Sparkles className="size-3.5" /> AI summary
            </p>
            <Button
              size="sm"
              variant="ghost"
              loading={summarising}
              onClick={() =>
                startSummary(async () => {
                  const r = await summariseCustomer(data.customerId);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Summary updated");
                  router.refresh();
                })
              }
            >
              {data.aiSummary ? "Refresh" : "Summarise"}
            </Button>
          </div>
          {data.aiSummary ? (
            <>
              <p className="mt-2 whitespace-pre-line text-sm text-fg">{data.aiSummary}</p>
              <p className="mt-2 text-[11px] text-subtle">Generated {formatDateTime(data.aiSummaryAt)} · may miss details — check the timeline</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">Get a three-line summary of this customer from their notes and history.</p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <MessageSquareQuote className="size-3.5" /> Last conversation
        </p>
        {data.lastNote ? (
          <>
            <p className="mt-1.5 text-sm text-fg">“{data.lastNote.body}”</p>
            <p className="mt-1 text-xs text-subtle">
              {data.lastNote.by} · {formatDateTime(data.lastNote.at)}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-subtle">Nothing logged yet. Notes and follow-ups appear here.</p>
        )}
      </div>

      <Section
        title="Interests & concerns"
        onEdit={() => {
          setSelected(data.selectedTagIds);
          setOpen("tags");
        }}
      >
        {selectedTags.length ? <TagChips tags={selectedTags} /> : <p className="text-sm text-subtle">Tap edit to tag what they&apos;re interested in.</p>}
      </Section>

      <Section title="Promises made" icon={HandHeart} onEdit={() => setOpen("promise")} editLabel="Add">
        {openPromises.length === 0 ? (
          <p className="text-sm text-subtle">No open promises.</p>
        ) : (
          <ul className="space-y-2">
            {openPromises.map((p) => (
              <li key={p.id} className="flex items-start gap-2 rounded-xl bg-lime/[0.06] p-3 shadow-[inset_0_0_0_1px_rgb(198_255_69/0.16)]">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{p.body}</p>
                  {p.due_date && (
                    <p className={`mt-0.5 text-xs ${p.due_date <= today ? "text-warning" : "text-muted"}`}>
                      Due {formatDate(p.due_date)} ({relativeDays(p.due_date, today)})
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Promise kept"
                  title="Promise kept"
                  className="focus-ring grid size-9 place-items-center rounded-lg text-success hover:bg-success/10"
                  onClick={() =>
                    start(async () => {
                      const r = await resolvePromise(p.id, "fulfilled");
                      if (!r.ok) return void toast.error(r.error);
                      done("Marked as kept");
                    })
                  }
                >
                  <Check className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Withdraw promise"
                  title="Withdraw"
                  className="focus-ring grid size-9 place-items-center rounded-lg text-muted hover:bg-white/5"
                  onClick={() =>
                    start(async () => {
                      const r = await resolvePromise(p.id, "cancelled");
                      if (!r.ok) return void toast.error(r.error);
                      done("Promise withdrawn");
                    })
                  }
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Preferences" onEdit={() => setOpen("prefs")}>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Clock className="size-3.5" /> {data.contactTime ? CONTACT[data.contactTime as keyof typeof CONTACT] : "Best time not set"}
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <Languages className="size-3.5" /> {data.language ?? "Language not set"}
          </span>
        </div>
      </Section>

      <Sheet open={open === "tags"} onOpenChange={(o) => !o && setOpen(null)} title="Interests & concerns" description="Tap everything that applies.">
        <TagPicker tags={data.tags} selected={selected} onChange={setSelected} />
        <Button
          className="mt-5 w-full"
          size="lg"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await setCustomerTags(data.customerId, selected);
              if (!r.ok) return void toast.error(r.error);
              done("Saved");
            })
          }
        >
          Save
        </Button>
      </Sheet>

      <Sheet open={open === "promise"} onOpenChange={(o) => !o && setOpen(null)} title="Record a promise" description="It shows on Today when due and expires after its date." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await addPromise({ customerId: data.customerId, body: String(f.get("body")), dueDate: String(f.get("due") ?? "") });
              if (!r.ok) return void toast.error(r.error);
              done("Promise recorded");
            });
          }}
        >
          <Field label="What was promised" htmlFor="pb">
            <Input id="pb" name="body" required maxLength={500} placeholder="10% off if he joins before 30 Nov" autoFocus />
          </Field>
          <Field label="Valid until (optional)" htmlFor="pd">
            <Input id="pd" name="due" type="date" min={today} defaultValue={addDaysISO(today, 7)} />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            <Plus /> Save promise
          </Button>
        </form>
      </Sheet>

      <Sheet open={open === "prefs"} onOpenChange={(o) => !o && setOpen(null)} title="Contact preferences" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await setCustomerPreferences(data.customerId, String(f.get("time") ?? ""), String(f.get("lang") ?? ""));
              if (!r.ok) return void toast.error(r.error);
              done("Preferences saved");
            });
          }}
        >
          <Field label="Best time to contact" htmlFor="pt">
            <Select id="pt" name="time" defaultValue={data.contactTime ?? ""}>
              <option value="">Not set</option>
              {Object.entries(CONTACT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preferred language" htmlFor="pl">
            <Input id="pl" name="lang" defaultValue={data.language ?? ""} placeholder="Kannada, Hindi, English…" maxLength={40} />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Save
          </Button>
        </form>
      </Sheet>
    </GlassCard>
  );
}

function Section({
  title,
  icon: Icon,
  onEdit,
  editLabel = "Edit",
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  onEdit: () => void;
  editLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          {Icon && <Icon className="size-3.5" />} {title}
        </p>
        <button type="button" onClick={onEdit} className="focus-ring inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-cyan hover:bg-cyan/10">
          {editLabel === "Edit" ? <Pencil className="size-3" /> : <Plus className="size-3" />} {editLabel}
        </button>
      </div>
      {children}
    </div>
  );
}
