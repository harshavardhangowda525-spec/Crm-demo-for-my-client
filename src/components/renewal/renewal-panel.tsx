import Link from "next/link";
import { AlertTriangle, ArrowUpRight, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { formatDate, formatINR } from "@/lib/format";
import { memberSinceLabel, upgradeHint, type RenewalStats } from "@/lib/renewal";
import type { PlanOption } from "@/server/queries";

export function RenewalPanel({ stats, plans, today, customerId }: { stats: RenewalStats; plans: PlanOption[]; today: string; customerId: string }) {
  const hint = upgradeHint(stats, plans);
  const items = [
    ["Member since", `${formatDate(stats.member_since)}`, memberSinceLabel(stats.member_since, today)],
    ["Renewals", String(stats.renewals), `${stats.terms} term${stats.terms === 1 ? "" : "s"} in total`],
    ["Lifetime paid", formatINR(stats.lifetime_paid_paise), "Recorded payments"],
    ["Renews on time?", stats.avg_days_late == null ? "—" : Number(stats.avg_days_late) <= 1 ? "Yes" : `${Number(stats.avg_days_late)} days late`, "Average gap before renewing"],
    ["Pauses this term", `${stats.current_pause_days} days`, stats.longest_pause_days ? `Longest ${stats.longest_pause_days} days` : "None"],
    ["Last plan", stats.last_plan_name, formatINR(stats.last_price_paise)],
  ] as const;
  return (
    <GlassCard className="p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <TrendingUp className="size-5 text-lime" /> Renewal history
      </h2>
      {stats.risk && (
        <div className="mt-4 rounded-2xl bg-danger/[0.08] p-4 shadow-[inset_0_0_0_1px_rgb(255_92_122/0.25)]">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="size-4" /> Likely to drop
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-muted">
            {stats.risk_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([k, v, sub]) => (
          <div key={k} className="rounded-xl bg-white/[0.03] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-metric mt-1 truncate text-lg font-semibold">{v}</dd>
            <dd className="truncate text-[11px] text-subtle">{sub}</dd>
          </div>
        ))}
      </dl>
      {hint && (
        <Link
          href={`/customers/${customerId}?do=activate`}
          className="focus-ring mt-4 flex items-center gap-3 rounded-2xl bg-lime/[0.07] p-4 shadow-[inset_0_0_0_1px_rgb(198_255_69/0.22)] hover:bg-lime/[0.1]"
        >
          <ArrowUpRight className="size-5 shrink-0 text-lime" />
          <p className="text-sm">
            Renewed {stats.last_plan_name} {stats.same_plan_streak} times in a row. Suggest <b className="text-lime">{hint.planName}</b> — saves{" "}
            <b className="text-lime">{formatINR(hint.savingPaise)}</b> versus {hint.termsCovered} separate renewals.
          </p>
        </Link>
      )}
    </GlassCard>
  );
}
