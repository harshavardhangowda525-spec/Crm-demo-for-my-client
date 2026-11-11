"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Textarea } from "@/components/ui/field";
import { requestPause } from "@/server/memberships";
import { addDaysISO, daysBetween, formatDate, todayISO } from "@/lib/format";
import { PauseMeter } from "./pause-meter";

export type PausableMembership = {
  id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  pause_allowance_days: number;
  pause_days_used: number;
  pauses: { start_date: string; end_date: string }[];
};

/** Shared by staff (server action) and the member portal (custom submit). */
export function PauseForm({
  membership,
  onDone,
  submit,
  showReason = true,
}: {
  membership: PausableMembership;
  onDone?: () => void;
  submit?: (input: { membershipId: string; startDate: string; endDate: string; reason: string; idempotencyKey: string }) => Promise<
    { ok: true; data: { newEndDate: string; remaining: number } } | { ok: false; error: string }
  >;
  showReason?: boolean;
}) {
  const router = useRouter();
  const today = todayISO();
  const remaining = Math.max(0, membership.pause_allowance_days - membership.pause_days_used);
  const firstStart = membership.start_date > today ? membership.start_date : today;
  const [startDate, setStartDate] = React.useState(firstStart);
  const [endDate, setEndDate] = React.useState(addDaysISO(firstStart, Math.min(remaining, 3) - 1));
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  const [key, setKey] = React.useState(() => crypto.randomUUID());

  const days = startDate && endDate && endDate >= startDate ? daysBetween(startDate, endDate) + 1 : 0;
  const overlaps = membership.pauses.some((p) => !(endDate < p.start_date || startDate > p.end_date));
  const problem =
    remaining === 0
      ? "All pause days for this membership term have been used."
      : days === 0
        ? "Choose an end date on or after the start date."
        : days > remaining
          ? `Only ${remaining} pause day${remaining === 1 ? "" : "s"} remaining.`
          : startDate < today
            ? "A pause cannot start in the past."
            : startDate > membership.end_date
              ? "The pause must start on or before the current expiry date."
              : overlaps
                ? "These dates overlap an existing pause."
                : null;
  const newEnd = days > 0 ? addDaysISO(membership.end_date, days) : membership.end_date;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    start(async () => {
      const input = { membershipId: membership.id, startDate, endDate, reason, idempotencyKey: key };
      const res = submit ? await submit(input) : await requestPause(input);
      if (!res.ok) {
        toast.error(res.error);
        setKey(crypto.randomUUID());
        return;
      }
      toast.success(`Pause approved · new expiry ${formatDate(res.data.newEndDate)} · ${res.data.remaining} days left`);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <div className="flex items-baseline justify-between">
          <p className="font-medium">{membership.plan_name}</p>
          <p className="text-sm text-muted">expires {formatDate(membership.end_date)}</p>
        </div>
        <PauseMeter className="mt-4" total={membership.pause_allowance_days} used={membership.pause_days_used} preview={problem ? 0 : days} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pause from" htmlFor="ps">
          <Input id="ps" type="date" value={startDate} min={firstStart} max={membership.end_date} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Pause until" htmlFor="pe">
          <Input id="pe" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-lime/[0.06] p-4 shadow-[inset_0_0_0_1px_rgb(198_255_69/0.18)]">
        <div>
          <p className="text-xs text-muted">Current expiry</p>
          <p className="font-medium">{formatDate(membership.end_date)}</p>
        </div>
        <ArrowRight className="size-4 text-lime" />
        <div className="text-right">
          <p className="text-xs text-muted">New expiry</p>
          <p className="text-metric text-lg font-semibold text-lime">{problem ? "—" : formatDate(newEnd)}</p>
        </div>
      </div>

      {showReason && (
        <Field label="Reason (optional)" htmlFor="pr">
          <Textarea id="pr" className="min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Travel, illness…" maxLength={500} />
        </Field>
      )}

      {problem && (
        <p className="text-sm text-warning" role="alert">
          {problem}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!!problem}>
        Approve {days > 0 && !problem ? `${days}-day ` : ""}pause
      </Button>
      <p className="text-center text-xs text-subtle">Valid requests are approved automatically and the expiry date moves by the paused days.</p>
    </form>
  );
}
