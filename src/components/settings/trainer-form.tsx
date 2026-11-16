"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { addTrainer } from "@/server/trainers";
import { normalizePhone } from "@/lib/phone";

export function TrainerForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "");
        start(async () => {
          const r = await addTrainer({
            fullName: s("fullName"),
            phone: s("phone"),
            gender: s("gender"),
            kind: s("kind"),
            specialization: s("specialization"),
            experienceYears: s("experienceYears"),
          });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Trainer added");
          onDone?.();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="t-name" error={errors.fullName} className="sm:col-span-2">
          <Input id="t-name" name="fullName" required autoComplete="off" />
        </Field>
        <Field label="Role" htmlFor="t-kind">
          <Select id="t-kind" name="kind" defaultValue="personal_trainer">
            <option value="personal_trainer">Personal trainer</option>
            <option value="trainer">Trainer (floor / group)</option>
          </Select>
        </Field>
        <Field label="Gender" htmlFor="t-gender" error={errors.gender}>
          <Select id="t-gender" name="gender" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Mobile number (optional)" htmlFor="t-phone" error={errors.phone}>
          <Input
            id="t-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="98765 43210"
            onBlur={(e) => {
              const n = normalizePhone(e.currentTarget.value);
              if (n) e.currentTarget.value = n;
            }}
          />
        </Field>
        <Field label="Experience (years)" htmlFor="t-exp" error={errors.experienceYears}>
          <Input id="t-exp" name="experienceYears" type="number" inputMode="numeric" min={0} max={60} />
        </Field>
        <Field label="Specialisation (optional)" htmlFor="t-spec" className="sm:col-span-2">
          <Input id="t-spec" name="specialization" placeholder="e.g. Strength, weight loss, yoga" maxLength={200} />
        </Field>
      </div>
      <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
        Save trainer
      </Button>
    </form>
  );
}
