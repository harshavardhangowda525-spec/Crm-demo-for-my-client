"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type TagOption = { id: string; label: string; kind: "interest" | "objection" };

/** Toggle chips — one tap to tag what the customer said. */
export function TagPicker({ tags, selected, onChange }: { tags: TagOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="space-y-3">
      {(["interest", "objection"] as const).map((kind) => (
        <div key={kind}>
          <p className="mb-1.5 text-xs font-medium text-muted">{kind === "interest" ? "Interested in" : "Concerns / objections"}</p>
          <div className="flex flex-wrap gap-1.5">
            {tags
              .filter((t) => t.kind === kind)
              .map((t) => {
                const on = selected.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "focus-ring inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors",
                      on
                        ? kind === "interest"
                          ? "bg-cyan/15 text-cyan shadow-[inset_0_0_0_1px_rgb(88_217_255/0.4)]"
                          : "bg-warning/15 text-warning shadow-[inset_0_0_0_1px_rgb(255_181_71/0.4)]"
                        : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-fg",
                    )}
                  >
                    {on && <Check className="size-3.5" />}
                    {t.label}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
