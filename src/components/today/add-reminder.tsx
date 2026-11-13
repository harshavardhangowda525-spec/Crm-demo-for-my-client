"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { addStaffTask } from "@/server/memory";
import { addDaysISO, todayISO } from "@/lib/format";
import { VoiceInput } from "@/components/memory/voice-input";

export function AddReminderButton({
  customerId,
  customerName,
  staff,
  variant = "secondary",
  label = "Remind me",
}: {
  customerId?: string;
  customerName?: string;
  staff: { staff_id: string; full_name: string; active: boolean }[];
  variant?: "primary" | "secondary" | "outline";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [pending, start] = React.useTransition();
  const today = todayISO();
  const quick = [
    ["Tomorrow", addDaysISO(today, 1)],
    ["In 3 days", addDaysISO(today, 3)],
    ["Next week", addDaysISO(today, 7)],
  ] as const;
  const [due, setDue] = React.useState(addDaysISO(today, 1));

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <BellPlus /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Set a reminder" description={customerName ? `About ${customerName}` : "Shows up on your Today list and in the morning briefing."} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await addStaffTask({ customerId: customerId ?? "", title, dueDate: due, assignedStaffId: String(f.get("assignee") ?? "") });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Reminder set");
              setOpen(false);
              setTitle("");
              router.refresh();
            });
          }}
        >
          <Field label="Remind me to…" htmlFor="rt">
            <Input id="rt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call about the PT slot on Saturday" autoFocus required maxLength={200} />
          </Field>
          <VoiceInput onText={(t) => setTitle((v) => (v ? v + " " : "") + t)} />
          <div className="flex flex-wrap gap-2">
            {quick.map(([l, d]) => (
              <button
                key={l}
                type="button"
                onClick={() => setDue(d)}
                className={`focus-ring h-9 rounded-full px-3 text-[13px] font-medium ${due === d ? "bg-lime/15 text-lime shadow-[inset_0_0_0_1px_rgb(198_255_69/0.35)]" : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)]"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="rd">
              <Input id="rd" type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} required />
            </Field>
            <Field label="For" htmlFor="ra">
              <Select id="ra" name="assignee" defaultValue="">
                <option value="">Anyone</option>
                {staff
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>
                      {s.full_name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Save reminder
          </Button>
        </form>
      </Sheet>
    </>
  );
}
