"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { createCustomer } from "@/server/crm";
import { ENQUIRY_SOURCES, todayISO, addDaysISO } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import type { PlanOption, StaffOption } from "@/server/queries";

export type CustomerFormLookups = { plans: PlanOption[]; staff: StaffOption[]; currentStaffId: string };

/** New customer + first enquiry. Duplicate numbers open the existing profile. */
export function CustomerCreateForm({
  lookups,
  prefill,
  onDone,
  formId = "customer-create",
}: {
  lookups: CustomerFormLookups;
  prefill?: string;
  onDone?: () => void;
  formId?: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = React.useState<string | null>(null);
  const isPhone = prefill && /\d{3,}/.test(prefill);
  const today = todayISO();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    setDuplicate(null);
    start(async () => {
      const res = await createCustomer({
        fullName: s("fullName"),
        phone: s("phone"),
        email: s("email"),
        dateOfBirth: s("dateOfBirth"),
        gender: s("gender") as "",
        interestedPlanId: s("interestedPlanId"),
        source: s("source") as "walk_in",
        enquiryDate: s("enquiryDate"),
        status: s("status") as "new",
        followUpDate: s("followUpDate"),
        assignedStaffId: s("assignedStaffId"),
        notes: s("notes"),
        whatsappOptIn: f.get("whatsappOptIn") === "on",
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      if (res.data.duplicate) {
        setDuplicate(res.data.customerId);
        return;
      }
      toast.success("Customer and enquiry saved");
      onDone?.();
      router.push(`/customers/${res.data.customerId}`);
    });
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
      {duplicate && (
        <div className="flex flex-col gap-3 rounded-2xl bg-warning/10 p-4 shadow-[inset_0_0_0_1px_rgb(255_181_71/0.3)] sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> This mobile number already belongs to a customer.
          </p>
          <Link
            href={`/customers/${duplicate}`}
            onClick={onDone}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-warning px-4 text-sm font-semibold text-bg"
          >
            Open existing profile <ArrowRight className="size-4" />
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="fullName" error={errors.fullName} className="sm:col-span-2">
          <Input id="fullName" name="fullName" required autoComplete="off" defaultValue={isPhone ? "" : prefill} aria-invalid={!!errors.fullName} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            placeholder="98765 43210"
            defaultValue={isPhone ? prefill : ""}
            aria-invalid={!!errors.phone}
            onBlur={(e) => {
              const n = normalizePhone(e.currentTarget.value);
              if (n) e.currentTarget.value = n;
            }}
          />
        </Field>
        <Field label="Email (optional)" htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" inputMode="email" aria-invalid={!!errors.email} />
        </Field>
        <Field label="Interested plan" htmlFor="interestedPlanId" hint={lookups.plans.length ? undefined : "Add plans in Settings → Plans"}>
          <Select id="interestedPlanId" name="interestedPlanId" defaultValue="">
            <option value="">Not decided</option>
            {lookups.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enquiry source" htmlFor="source">
          <Select id="source" name="source" defaultValue="walk_in">
            {Object.entries(ENQUIRY_SOURCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enquiry date" htmlFor="enquiryDate">
          <Input id="enquiryDate" name="enquiryDate" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue="interested">
            <option value="new">New enquiry</option>
            <option value="follow_up_pending">Follow-up pending</option>
            <option value="interested">Interested</option>
            <option value="not_interested">Not interested</option>
          </Select>
        </Field>
        <Field label="Follow-up date" htmlFor="followUpDate" error={errors.followUpDate}>
          <Input id="followUpDate" name="followUpDate" type="date" min={today} defaultValue={addDaysISO(today, 3)} />
        </Field>
        <Field label="Assigned staff" htmlFor="assignedStaffId">
          <Select id="assignedStaffId" name="assignedStaffId" defaultValue={lookups.currentStaffId}>
            <option value="">Unassigned</option>
            {lookups.staff
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.staff_id} value={s.staff_id}>
                  {s.full_name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Date of birth (optional)" htmlFor="dateOfBirth">
          <Input id="dateOfBirth" name="dateOfBirth" type="date" max={today} />
        </Field>
        <Field label="Gender (optional)" htmlFor="gender">
          <Select id="gender" name="gender" defaultValue="">
            <option value="">Not specified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </Select>
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" placeholder="e.g. Asked about personal training and evening availability." maxLength={4000} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            name="whatsappOptIn"
            defaultChecked
            label="Customer agreed to receive WhatsApp updates"
            description="Required before any automated WhatsApp message is sent. They can opt out any time."
          />
        </div>
      </div>
      <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
        Save customer & enquiry
      </Button>
    </form>
  );
}
