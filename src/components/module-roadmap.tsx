import { Hammer } from "lucide-react";
import { GlassCard, SectionTitle } from "@/components/ui/card";

/**
 * Honest status panel for a module that is scheduled for a later build phase.
 * It contains no buttons or fake data — it only states what is coming.
 */
export function ModuleRoadmap({
  title,
  description,
  phase,
  items,
}: {
  title: string;
  description: string;
  phase: number;
  items: string[];
}) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={`Phase ${phase}`} title={title} description={description} />
      <GlassCard glow="cyan" className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="metal grid size-11 shrink-0 place-items-center rounded-xl">
            <Hammer className="size-5 text-cyan" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-fg">This module is being built in phase {phase}.</p>
            <p className="mt-1 text-sm text-muted">Nothing here is active yet. It will include:</p>
            <ul className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
              {items.map((it) => (
                <li key={it} className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-cyan/70" aria-hidden />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
