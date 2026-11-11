"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Pencil, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { toggleAutomation, updateTemplate } from "@/server/automations";
import { cn } from "@/lib/utils";

export function RuleCard({
  rule,
  title,
  trigger,
  icon: Icon,
  stats,
  canManage,
  index,
}: {
  rule: { id: string; enabled: boolean; template_name: string; body: string };
  title: string;
  trigger: string;
  icon: LucideIcon;
  stats: { success: number; failed: number; skipped: number; last: string | null };
  canManage: boolean;
  index: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(rule.enabled);
  const [editing, setEditing] = React.useState(false);
  const [pending, start] = React.useTransition();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={cn("glass glass-interactive overflow-hidden p-5", !enabled && "opacity-70")}
    >
      <div aria-hidden className={cn("pointer-events-none absolute -right-12 -top-12 size-36 rounded-full blur-3xl", enabled ? "bg-lime/10" : "bg-white/5")} />
      <div className="flex items-start justify-between gap-3">
        <span className="metal grid size-11 place-items-center rounded-xl">
          <Icon className={cn("size-5", enabled ? "text-lime" : "text-muted")} />
        </span>
        <div className="flex items-center gap-2.5">
          <span className={cn("text-xs font-semibold", enabled ? "text-lime" : "text-muted")}>{enabled ? "On" : "Off"}</span>
          <Switch
            checked={enabled}
            disabled={!canManage || pending}
            aria-label={`${title} automation`}
            onCheckedChange={(v) => {
              setEnabled(v);
              start(async () => {
                const r = await toggleAutomation(rule.id, v);
                if (!r.ok) {
                  setEnabled(!v);
                  toast.error(r.error);
                } else toast.success(`${title} turned ${v ? "on" : "off"}`);
              });
            }}
          />
        </div>
      </div>
      <p className="mt-4 font-display text-lg font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-muted">{trigger}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat n={stats.success} label="Succeeded" tone="text-success" />
        <Stat n={stats.failed} label="Failed" tone={stats.failed ? "text-danger" : "text-fg"} />
        <Stat n={stats.skipped} label="Skipped" tone="text-muted" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">Last run: {stats.last ?? "never"}</p>
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil /> Template
          </Button>
        )}
      </div>

      <Sheet open={editing} onOpenChange={setEditing} title={`${title} template`} description="Must match a template approved in your WhatsApp Business account. {{1}}, {{2}}… are filled in automatically.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await updateTemplate(rule.id, String(f.get("name")), String(f.get("body")));
              if (!r.ok) return void toast.error(r.error);
              toast.success("Template saved");
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <Field label="Approved template name" htmlFor="tn">
            <Input id="tn" name="name" defaultValue={rule.template_name} />
          </Field>
          <Field label="Message text (preview & mock provider)" htmlFor="tb">
            <Textarea id="tb" name="body" defaultValue={rule.body} className="min-h-36" />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Save template
          </Button>
        </form>
      </Sheet>
    </motion.div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <p className={cn("text-metric text-xl font-semibold", tone)}>{n.toLocaleString("en-IN")}</p>
      <p className="text-[10.5px] uppercase tracking-wider text-subtle">{label}</p>
    </div>
  );
}
