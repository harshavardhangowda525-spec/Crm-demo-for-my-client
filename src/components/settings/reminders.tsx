"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { addTag, saveMyReminders, sendTestBriefing, setTagActive } from "@/server/memory";
import { cn } from "@/lib/utils";

export function MyReminders({
  prefs,
}: {
  prefs: { briefingEnabled: boolean; briefingTime: string; eveningEnabled: boolean; eveningTime: string; phone: string | null };
}) {
  const router = useRouter();
  const [briefing, setBriefing] = React.useState(prefs.briefingEnabled);
  const [evening, setEvening] = React.useState(prefs.eveningEnabled);
  const [pending, start] = React.useTransition();
  const [testing, startTest] = React.useTransition();
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveMyReminders({
            briefingEnabled: briefing,
            briefingTime: String(f.get("bt")),
            eveningEnabled: evening,
            eveningTime: String(f.get("et")),
            phone: String(f.get("phone") ?? ""),
          });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Reminder settings saved");
          router.refresh();
        });
      }}
    >
      <Field label="Your WhatsApp number" htmlFor="myphone" hint="Briefings are sent here. Only you and your gym's admins can see it.">
        <Input id="myphone" name="phone" type="tel" inputMode="tel" defaultValue={prefs.phone ?? ""} placeholder="98765 43210" />
      </Field>
      <Row title="Morning briefing" description="Today's follow-ups, renewals, unpaid invoices, birthdays and the top 5 people to contact." on={briefing} onChange={setBriefing}>
        <TimeSelect name="bt" defaultValue={prefs.briefingTime} from={5} to={12} />
      </Row>
      <Row title="Evening summary" description="What got done today and what carries over to tomorrow." on={evening} onChange={setEvening}>
        <TimeSelect name="et" defaultValue={prefs.eveningTime} from={16} to={21} />
      </Row>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={testing}
          onClick={() =>
            startTest(async () => {
              const r = await sendTestBriefing();
              if (!r.ok) return void toast.error(r.error);
              toast.success(
                r.data.sent
                  ? "Test briefing sent to your WhatsApp"
                  : r.data.simulated
                    ? "Test briefing created — simulated, because WhatsApp is not connected yet. See it in Automations."
                    : "Test briefing failed — see Automations for details",
              );
            })
          }
        >
          <Send /> Send me a test briefing
        </Button>
      </div>
    </form>
  );
}

function Row({ title, description, on, onChange, children }: { title: string; description: string; on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <Switch checked={on} onCheckedChange={onChange} aria-label={title} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <div className={cn("w-32", !on && "opacity-50")}>{children}</div>
    </div>
  );
}

function TimeSelect({ name, defaultValue, from, to }: { name: string; defaultValue: string; from: number; to: number }) {
  const opts: string[] = [];
  for (let h = from; h <= to; h++) for (const m of ["00", "30"]) if (!(h === to && m === "30")) opts.push(`${String(h).padStart(2, "0")}:${m}`);
  const v = defaultValue.slice(0, 5);
  return (
    <Select name={name} defaultValue={opts.includes(v) ? v : opts[0]} aria-label="Time">
      {opts.map((o) => {
        const [h, m] = o.split(":").map(Number);
        return (
          <option key={o} value={o}>
            {`${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`}
          </option>
        );
      })}
    </Select>
  );
}

export function TagCatalogue({ tags, canEdit }: { tags: { id: string; label: string; kind: "interest" | "objection"; active: boolean }[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {(["interest", "objection"] as const).map((kind) => (
        <div key={kind}>
          <p className="mb-2 text-sm font-medium">{kind === "interest" ? "Interests" : "Objections / concerns"}</p>
          <div className="flex flex-wrap gap-1.5">
            {tags
              .filter((t) => t.kind === kind)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit || pending}
                  title={canEdit ? (t.active ? "Tap to hide" : "Tap to show again") : undefined}
                  onClick={() =>
                    start(async () => {
                      const r = await setTagActive(t.id, !t.active);
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                    })
                  }
                  className={cn(
                    "focus-ring h-8 rounded-full px-3 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
                    t.active ? (kind === "interest" ? "text-cyan" : "text-warning") : "text-subtle line-through",
                  )}
                >
                  {t.label}
                </button>
              ))}
          </div>
          {canEdit && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const label = String(new FormData(form).get("label") ?? "");
                start(async () => {
                  const r = await addTag(kind, label);
                  if (!r.ok) return void toast.error(r.error);
                  form.reset();
                  router.refresh();
                });
              }}
            >
              <Input name="label" placeholder={kind === "interest" ? "e.g. Zumba" : "e.g. Parking"} className="h-10" maxLength={40} required />
              <Button type="submit" size="icon" variant="secondary" aria-label="Add tag" loading={pending}>
                <Plus />
              </Button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
