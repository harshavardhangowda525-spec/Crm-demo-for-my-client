import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const btn =
    "focus-ring grid size-10 place-items-center rounded-xl text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04] hover:text-fg";
  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
      <p className="text-xs text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-IN")}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={btn} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className={cn(btn, "opacity-40")} aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        )}
        <span className="min-w-14 text-center text-sm tabular-nums text-fg">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={btn} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(btn, "opacity-40")} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
