import { cookies } from "next/headers";
import { CalendarDays, Download, LogOut, ShieldAlert } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Badge, MEMBERSHIP_TONE, PAYMENT_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PauseMeter } from "@/components/membership/pause-meter";
import { PortalPauseButton } from "@/components/membership/portal-pause";
import { createAnonClient } from "@/lib/supabase/anon";
import { PORTAL_COOKIE } from "@/lib/portal";
import { daysBetween, formatDate, formatINR, label, MEMBERSHIP_STATUS, PAYMENT_STATUS } from "@/lib/format";
import { portalSignOut } from "@/server/portal";

export const metadata = { title: "My membership" };
export const dynamic = "force-dynamic";

type PortalData = {
  customer: { name: string };
  gym: { name: string; phone: string | null; today: string };
  memberships: {
    id: string;
    plan_name: string;
    status: string;
    start_date: string;
    end_date: string;
    original_end_date: string;
    pause_allowance_days: number;
    pause_days_used: number;
    pauses: { start_date: string; end_date: string; days: number; new_end_date: string; via: string }[];
  }[];
  invoices: { id: string; number: string; issue_date: string; total_paise: number; payment_status: string }[];
};

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-4">
      <div className="glass w-full max-w-md p-7 text-center">
        <ShieldAlert className="mx-auto size-9 text-warning" />
        <h1 className="mt-4 font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
      </div>
    </main>
  );
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: err } = await searchParams;
  const session = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!session) {
    return err === "rate" ? (
      <Message title="Too many attempts" text="Please wait 15 minutes and open your link again." />
    ) : (
      <Message title={err ? "This link has expired" : "Open your secure link"} text="For your privacy, the member portal only opens from the personal link the gym sends you on WhatsApp. Ask the front desk for a new link." />
    );
  }
  const { data, error } = await createAnonClient().rpc("portal_data", { p_session: session });
  if (error || !data) return <Message title="Session expired" text="Open the link from WhatsApp again to continue." />;
  const d = data as PortalData;
  const live = d.memberships.find((m) => ["active", "paused", "pending"].includes(m.status));
  const today = d.gym.today;

  return (
    <main className="relative z-10 mx-auto min-h-dvh w-full max-w-lg px-4 pb-16 pt-6">
      <header className="flex items-center gap-3">
        <LogoMark />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold">{d.gym.name}</p>
          <p className="text-xs text-muted">Member portal</p>
        </div>
        <form action={portalSignOut}>
          <Button size="icon-sm" variant="ghost" aria-label="Sign out">
            <LogOut />
          </Button>
        </form>
      </header>

      <h1 className="mt-8 font-display text-2xl font-semibold">Hi {d.customer.name.split(" ")[0]} 👋</h1>

      {live ? (
        <section className="glass mt-5 overflow-hidden p-5">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-lime/10 blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Your membership</p>
              <p className="mt-1 font-display text-xl font-semibold">{live.plan_name}</p>
            </div>
            <Badge tone={MEMBERSHIP_TONE[live.status]} dot>
              {label(MEMBERSHIP_STATUS, live.status)}
            </Badge>
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div className="text-sm">
              <p className="flex items-center gap-1.5 text-muted">
                <CalendarDays className="size-3.5" /> {formatDate(live.start_date)} – {formatDate(live.end_date)}
              </p>
              {live.end_date !== live.original_end_date && <p className="mt-1 text-xs text-subtle">Extended from {formatDate(live.original_end_date)} by pauses</p>}
            </div>
            <div className="text-right">
              <p className="text-metric text-4xl font-semibold leading-none text-lime">{Math.max(0, daysBetween(today, live.end_date) + 1)}</p>
              <p className="text-xs text-muted">days left</p>
            </div>
          </div>
          <div className="divider-metal my-5" />
          <p className="mb-2 text-sm text-muted">Pause allowance this term</p>
          <PauseMeter total={live.pause_allowance_days} used={live.pause_days_used} />
          {live.status !== "pending" && (
            <div className="mt-5">
              <PortalPauseButton
                membership={{
                  id: live.id,
                  plan_name: live.plan_name,
                  start_date: live.start_date,
                  end_date: live.end_date,
                  pause_allowance_days: live.pause_allowance_days,
                  pause_days_used: live.pause_days_used,
                  pauses: live.pauses,
                }}
              />
            </div>
          )}
          {live.pauses.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm text-muted">Pause history</p>
              <ul className="space-y-1.5 text-sm">
                {live.pauses.map((p, i) => (
                  <li key={i} className="flex justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                    <span>
                      {formatDate(p.start_date, true)} – {formatDate(p.end_date, true)}
                    </span>
                    <span className="text-muted">{p.days} days</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="glass mt-5 p-5 text-sm text-muted">You don&apos;t have an active membership right now. Visit the front desk to renew.</section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-semibold">Invoices</h2>
        {!d.invoices.length ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <ul className="space-y-2">
            {d.invoices.map((i) => (
              <li key={i.id}>
                <a href={`/api/portal/invoices/${i.id}/pdf`} className="focus-ring glass flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{i.number}</p>
                    <p className="text-xs text-muted">{formatDate(i.issue_date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums">{formatINR(i.total_paise)}</p>
                    <Badge tone={PAYMENT_TONE[i.payment_status]}>{label(PAYMENT_STATUS, i.payment_status)}</Badge>
                  </div>
                  <Download className="size-4 text-muted" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-10 text-center text-xs text-subtle">Your session ends automatically after 12 hours.</p>
    </main>
  );
}
