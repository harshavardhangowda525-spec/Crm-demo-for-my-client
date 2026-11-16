"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dumbbell, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { setTrainerActive } from "@/server/trainers";
import { formatPhone } from "@/lib/phone";
import { TrainerForm } from "./trainer-form";

export type TrainerRow = {
  id: string;
  full_name: string;
  phone_e164: string | null;
  gender: string | null;
  kind: "personal_trainer" | "trainer";
  specialization: string | null;
  experience_years: number | null;
  active: boolean;
};

export function TrainersManager({ trainers, canEdit }: { trainers: TrainerRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [, start] = React.useTransition();
  return (
    <div className="space-y-4">
      {!trainers.length ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Dumbbell className="size-4 text-cyan" /> No trainers yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {trainers.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.full_name}
                  <Badge tone={t.kind === "personal_trainer" ? "lime" : "cyan"}>{t.kind === "personal_trainer" ? "Personal trainer" : "Trainer"}</Badge>
                  {!t.active && <Badge>Inactive</Badge>}
                </p>
                <p className="truncate text-sm text-muted">
                  {[t.specialization, t.experience_years != null ? `${t.experience_years} yrs` : null, t.phone_e164 ? formatPhone(t.phone_e164) : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              {canEdit && (
                <Switch
                  checked={t.active}
                  aria-label={`${t.full_name} active`}
                  onCheckedChange={(v) =>
                    start(async () => {
                      const r = await setTrainerActive(t.id, v);
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus /> Add trainer
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="Add a trainer" description="Personal trainers and floor trainers at your gym." size="lg">
        <TrainerForm onDone={() => setOpen(false)} />
      </Sheet>
    </div>
  );
}
