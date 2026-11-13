"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BadgeCheck, CalendarClock, Loader2, MessageSquarePlus, NotebookPen, Phone, Search, UserPlus } from "lucide-react";
import { Badge, LIFECYCLE_TONE } from "@/components/ui/badge";
import { formatDate, LIFECYCLE, label } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { TagChips } from "@/components/memory/tag-chips";

export type SearchResult = {
  id: string;
  full_name: string;
  phone_e164: string;
  lifecycle: string;
  enquiry_status: string | null;
  last_enquiry_date: string | null;
  interested_plan_name: string | null;
  notes: string | null;
  pending_follow_ups: number;
  membership_status: string | null;
  membership_plan_name: string | null;
  membership_end_date: string | null;
  follow_up_date: string | null;
  tags: { label: string; kind: string }[];
  promises: string[];
  last_note: { body: string; created_at: string } | null;
};

function useCustomerSearch(query: string) {
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as { results: SearchResult[] };
        setResults(json.results);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search is unavailable right now.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);
  return { results, loading, error };
}

/**
 * Large phone-first search used on the Customers page and in the header
 * palette. Typing a mobile number instantly surfaces the returning customer
 * with their enquiry context and next actions.
 */
export function CustomerSearch({
  autoFocus,
  onNavigate,
  onAddNew,
  compact,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
  onAddNew?: (prefill: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const { results, loading, error } = useCustomerSearch(query);
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setActive(0), [results]);

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  const showEmpty = query.trim().length >= 2 && !loading && !error && results.length === 0;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(`/customers/${results[active].id}`);
            }
          }}
          inputMode="search"
          autoComplete="off"
          placeholder="Mobile number or name…"
          aria-label="Search customers by mobile number or name"
          className={cn(
            "inner-shadow w-full rounded-2xl bg-bg/80 pl-12 pr-12 text-fg placeholder:text-subtle outline-none transition-shadow",
            "focus:shadow-[inset_0_2px_6px_rgb(0_0_0/0.45),0_0_0_1px_rgb(198_255_69/0.55),0_0_0_5px_rgb(198_255_69/0.1)]",
            compact ? "h-12 text-[15px]" : "h-14 text-[17px] md:h-16 md:text-lg",
          )}
        />
        {loading && <Loader2 className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-muted" aria-label="Searching" />}
      </div>

      <div aria-live="polite" className="mt-3 space-y-2.5">
        {error && <p className="px-1 text-sm text-danger">{error}</p>}
        <AnimatePresence initial={false}>
          {results.map((r, idx) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, delay: idx * 0.025 }}
              onMouseEnter={() => setActive(idx)}
              className={cn(
                "rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow",
                idx === active && "shadow-[inset_0_0_0_1px_rgb(198_255_69/0.35)]",
              )}
            >
              <button type="button" onClick={() => go(`/customers/${r.id}`)} className="focus-ring block w-full rounded-lg text-left">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="font-display text-[17px] font-semibold text-fg">{r.full_name}</p>
                  <Badge tone={LIFECYCLE_TONE[r.lifecycle] ?? "neutral"} dot>
                    {label(LIFECYCLE, r.lifecycle)}
                  </Badge>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Phone className="size-3.5" /> {formatPhone(r.phone_e164)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                  <div>
                    <dt className="text-subtle">Last enquiry</dt>
                    <dd className="text-fg">{formatDate(r.last_enquiry_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Interested plan</dt>
                    <dd className="truncate text-fg">{r.interested_plan_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">{r.membership_status ? "Membership" : "Follow-ups"}</dt>
                    <dd className="text-fg">
                      {r.membership_status
                        ? `${r.membership_plan_name} · ends ${formatDate(r.membership_end_date, true)}`
                        : r.pending_follow_ups > 0
                          ? `${r.pending_follow_ups} pending`
                          : "None pending"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Next follow-up</dt>
                    <dd className="text-fg">{formatDate(r.follow_up_date)}</dd>
                  </div>
                </dl>
                {r.tags.length > 0 && <TagChips tags={r.tags} className="mt-2.5" max={5} />}
                {r.promises.map((p) => (
                  <p key={p} className="mt-2 text-[13px] text-lime">Promised: {p}</p>
                ))}
                {r.last_note ? (
                  <p className="mt-2 line-clamp-2 text-[13px] text-muted">
                    <span className="text-subtle">Last talk ({formatDate(r.last_note.created_at)}):</span> “{r.last_note.body}”
                  </p>
                ) : (
                  r.notes && <p className="mt-2.5 line-clamp-2 text-[13px] text-muted">“{r.notes}”</p>
                )}
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionLink href={`/customers/${r.id}`} icon={ArrowRight} onClick={onNavigate}>
                  View profile
                </ActionLink>
                <ActionLink href={`/customers/${r.id}?do=note`} icon={NotebookPen} onClick={onNavigate}>
                  Add note
                </ActionLink>
                {r.enquiry_status && r.enquiry_status !== "converted" && (
                  <ActionLink href={`/customers/${r.id}?do=follow-up`} icon={CalendarClock} onClick={onNavigate}>
                    Update enquiry
                  </ActionLink>
                )}
                <ActionLink href={`/customers/${r.id}?do=activate`} icon={BadgeCheck} onClick={onNavigate} primary>
                  {r.membership_status ? "Renew + invoice" : "Convert to membership"}
                </ActionLink>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {showEmpty && (
          <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/[0.02] p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">No customer matches “{query.trim()}”.</p>
            {onAddNew && (
              <button
                type="button"
                onClick={() => onAddNew(query.trim())}
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-bg"
              >
                <UserPlus className="size-4" /> Add as new enquiry
              </button>
            )}
          </div>
        )}
        {query.trim().length < 2 && !compact && (
          <p className="flex items-center gap-2 px-1 text-[13px] text-subtle">
            <MessageSquarePlus className="size-4" /> Type at least 3 digits of a mobile number, or part of a name.
          </p>
        )}
      </div>
    </div>
  );
}

function ActionLink({
  href,
  icon: Icon,
  children,
  onClick,
  primary,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors",
        primary
          ? "bg-lime/12 text-lime shadow-[inset_0_0_0_1px_rgb(198_255_69/0.3)] hover:bg-lime/20"
          : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.05] hover:text-fg",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </Link>
  );
}
