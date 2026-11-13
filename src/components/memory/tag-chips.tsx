import { cn } from "@/lib/utils";

export type TagLike = { label: string; kind: "interest" | "objection" | string };

/** Interests in cyan, objections in amber — always with a text prefix, never colour alone. */
export function TagChips({ tags, className, max }: { tags: TagLike[]; className?: string; max?: number }) {
  if (!tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((t) => (
        <span
          key={t.kind + t.label}
          className={cn(
            "inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium",
            t.kind === "objection"
              ? "bg-warning/10 text-warning shadow-[inset_0_0_0_1px_rgb(255_181_71/0.25)]"
              : "bg-cyan/10 text-cyan shadow-[inset_0_0_0_1px_rgb(88_217_255/0.22)]",
          )}
        >
          {t.kind === "objection" ? "Concern: " : ""}
          {t.label}
        </span>
      ))}
      {max && tags.length > max && <span className="text-[11.5px] text-subtle">+{tags.length - max}</span>}
    </div>
  );
}
