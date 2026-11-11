"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { savePlan } from "@/server/settings";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { durationLabel, priceBreakdown } from "@/lib/membership";
import type { PlanOption } from "@/server/queries";

export function PlansManager({ plans, canEdit, defaultGstRate, pauseMax }: { plans: PlanOption[]; canEdit: boolean; defaultGstRate: number; pauseMax: number }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<PlanOption | "new" | null>(null);
  const [pending, start] = React.useTransition();
  const plan = editing === "new" ? null : editing;

  return (
    <div className="space-y-3">
      {canEdit && (
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add plan
        </Button>
      )}
      {!plans.length && <p className="text-sm text-muted">No plans yet. Add Monthly, Quarterly, Half-yearly and Annual plans with your prices.</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {plans.map((p) => {
          const rate = Number(p.gst_rate ?? defaultGstRate);
          return (
            <li key={p.id} className="rounded-2xl bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {p.name} {!p.active && <Badge>Inactive</Badge>} {p.is_demo && <Badge tone="violet">Demo</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {durationLabel(p.duration_value, p.duration_unit)} · {formatINR(p.base_price_paise)} + {rate}% GST ={" "}
                    {formatINR(priceBreakdown(p.base_price_paise, 0, rate).total)} · {Math.min(p.pause_allowance_days, pauseMax)} pause days
                  </p>
                  {p.description && <p className="mt-1 text-xs text-subtle">{p.description}</p>}
                </div>
                {canEdit && (
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={plan ? `Edit ${plan.name}` : "New plan"} description="Price changes apply to new memberships only; existing invoices never change.">
        <form
          key={plan?.id ?? "new"}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const price = rupeesToPaise(String(f.get("price")));
            if (price === null) return void toast.error("Enter a valid price");
            const gst = String(f.get("gst") ?? "").trim();
            start(async () => {
              const r = await savePlan({
                planId: plan?.id ?? "",
                name: String(f.get("name")),
                durationValue: Number(f.get("dv")),
                durationUnit: String(f.get("du")),
                basePricePaise: price,
                gstRate: gst === "" ? null : Number(gst),
                description: String(f.get("desc") ?? ""),
                pauseAllowanceDays: Number(f.get("pause")),
                active: f.get("active") === "on",
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Plan saved");
              setEditing(null);
              router.refresh();
            });
          }}
        >
          <Field label="Plan name" htmlFor="pn">
            <Input id="pn" name="name" defaultValue={plan?.name ?? ""} required placeholder="Quarterly" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration" htmlFor="dv">
              <Input id="dv" name="dv" type="number" min={1} defaultValue={plan?.duration_value ?? 1} />
            </Field>
            <Field label="Unit" htmlFor="du">
              <Select id="du" name="du" defaultValue={plan?.duration_unit ?? "month"}>
                <option value="month">Months</option>
                <option value="day">Days</option>
              </Select>
            </Field>
            <Field label="Base price (₹, before GST)" htmlFor="price">
              <Input id="price" name="price" inputMode="decimal" defaultValue={plan ? (plan.base_price_paise / 100).toString() : ""} required />
            </Field>
            <Field label="GST rate % (blank = default)" htmlFor="gst">
              <Input id="gst" name="gst" type="number" step="0.01" min={0} max={40} defaultValue={plan?.gst_rate ?? ""} placeholder={String(defaultGstRate)} />
            </Field>
            <Field label="Pause allowance (days)" htmlFor="pause" hint={`Capped at ${pauseMax} by gym settings`}>
              <Input id="pause" name="pause" type="number" min={0} max={60} defaultValue={plan?.pause_allowance_days ?? 7} />
            </Field>
          </div>
          <Field label="Description" htmlFor="desc">
            <Textarea id="desc" name="desc" defaultValue={plan?.description ?? ""} className="min-h-16" />
          </Field>
          <Checkbox name="active" defaultChecked={plan?.active ?? true} label="Active" description="Inactive plans can't be sold but stay on old memberships." />
          <Button type="submit" className="w-full" loading={pending}>
            Save plan
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
