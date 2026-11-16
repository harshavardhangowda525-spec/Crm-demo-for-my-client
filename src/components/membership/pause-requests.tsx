"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { decidePauseRequest } from "@/server/pause-requests";
import { addDaysISO, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export type PauseRequestRow = {
  id: string;
  customer_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  created_at: string;
  customers: { full_name: string; phone_e164: string } | null;
  memberships: { plan_name: string; end_date: string; pause_allowance_days: number; pause_days_used: number } | null;
};

function RequestItem({ r }: { r: PauseRequestRow }) {
  const router = useRouter();
  const [declining, setDeclining] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [pending, start] = React.useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const res = await decidePauseRequest({ requestId: r.id, approve, note: approve ? undefined : note });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        approve
          ? `Pause approved${res.data.newEndDate ? ` · new expiry ${formatDate(res.data.newEndDate)}` : ""} · WhatsApp confirmation sent`
          : "Request declined · the member sees your note in their portal",
      );
      router.refresh();
    });
  const m = r.memberships;
  const left = m ? m.pause_allowance_days - m.pause_days_used : null;
  return (
    <li className="rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/customers/${r.customer_id}`} className="font-medium hover:text-lime">
            {r.customers?.full_name ?? "Member"}
          </Link>
          <p className="text-xs text-subtle">
            {r.customers ? formatPhone(r.customers.phone_e164) : ""} · requested {formatDateTime(r.created_at)}
          </p>
        </div>
        <Badge tone="amber">
          {formatDate(r.start_date, true)} – {formatDate(r.end_date, true)} · {r.days} day{r.days === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="mt-2.5 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
        <span className="text-muted">Reason: </span>
        {r.reason}
      </p>
      {m && (
        <p className="mt-2 text-xs text-muted">
          {m.plan_name} · expires {formatDate(m.end_date)} → <span className="text-lime">{formatDate(addDaysISO(m.end_date, r.days))}</span> if approved ·{" "}
          {left} pause day{left === 1 ? "" : "s"} left
        </p>
      )}
      {declining ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-16"
            maxLength={500}
            placeholder="Why it can't be approved (the member sees this), e.g. please choose dates after the 20th."
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={pending} disabled={note.trim().length < 3} onClick={() => decide(false)}>
              Decline request
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" loading={pending} onClick={() => decide(true)}>
            <Check /> Approve pause
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDeclining(true)}>
            <X /> Decline
          </Button>
        </div>
      )}
    </li>
  );
}

/** Member pause requests from the portal, waiting for a staff decision. */
export function PauseRequests({ requests }: { requests: PauseRequestRow[] }) {
  if (!requests.length) return null;
  return (
    <GlassCard className="p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="size-5 text-warning" />
        <h2 className="font-display text-lg font-semibold">Pause requests</h2>
        <Badge tone="amber">{requests.length} waiting</Badge>
      </div>
      <ul className="space-y-3">
        {requests.map((r) => (
          <RequestItem key={r.id} r={r} />
        ))}
      </ul>
    </GlassCard>
  );
}
