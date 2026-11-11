"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { saveGymSettings } from "@/server/settings";
import type { GymSettings } from "@/server/queries";

export function GymSettingsForm({ gym, canEdit, metaConfigured }: { gym: GymSettings; canEdit: boolean; metaConfigured: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "");
        const n = (k: string) => Number(f.get(k));
        start(async () => {
          const r = await saveGymSettings({
            name: s("name"),
            legalName: s("legalName"),
            addressLine1: s("addressLine1"),
            addressLine2: s("addressLine2"),
            city: s("city"),
            state: s("state"),
            stateCode: s("stateCode"),
            postalCode: s("postalCode"),
            phone: s("phone"),
            email: s("email"),
            gstin: s("gstin"),
            gstEnabled: f.get("gstEnabled") === "on",
            defaultGstRate: n("defaultGstRate"),
            sacCode: s("sacCode"),
            invoicePrefix: s("invoicePrefix"),
            pauseMaxDays: n("pauseMaxDays"),
            reminderOffsets: s("reminderOffsets")
              .split(/[,\s]+/)
              .filter(Boolean)
              .map(Number),
            activationRule: s("activationRule"),
            renewalFollowUpDays: n("renewalFollowUpDays"),
            whatsappProvider: s("whatsappProvider"),
          });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          setErrors({});
          toast.success("Settings saved");
          router.refresh();
        });
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-8 disabled:opacity-70">
        <Section title="Business details" description="Printed on every invoice.">
          <Field label="Gym name" htmlFor="name" error={errors.name}>
            <Input id="name" name="name" defaultValue={gym.name} required />
          </Field>
          <Field label="Legal / business name" htmlFor="legalName">
            <Input id="legalName" name="legalName" defaultValue={gym.legal_name ?? ""} />
          </Field>
          <Field label="Address line 1" htmlFor="addressLine1">
            <Input id="addressLine1" name="addressLine1" defaultValue={gym.address_line1 ?? ""} />
          </Field>
          <Field label="Address line 2" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" defaultValue={gym.address_line2 ?? ""} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" defaultValue={gym.city ?? ""} />
          </Field>
          <Field label="State" htmlFor="state">
            <Input id="state" name="state" defaultValue={gym.state ?? ""} />
          </Field>
          <Field label="GST state code" htmlFor="stateCode" error={errors.stateCode} hint="e.g. 29 for Karnataka">
            <Input id="stateCode" name="stateCode" defaultValue={gym.state_code ?? ""} inputMode="numeric" maxLength={2} />
          </Field>
          <Field label="PIN code" htmlFor="postalCode">
            <Input id="postalCode" name="postalCode" defaultValue={gym.postal_code ?? ""} inputMode="numeric" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={gym.phone_e164 ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={gym.email ?? ""} />
          </Field>
        </Section>

        <Section title="GST & invoices" description="Confirm the applicable rate and treatment with your accountant.">
          <div className="sm:col-span-2">
            <Checkbox name="gstEnabled" defaultChecked={gym.gst_enabled} label="Charge GST on invoices" description="Split as CGST + SGST (intra-state supply)." />
          </div>
          <Field label="GSTIN" htmlFor="gstin" error={errors.gstin}>
            <Input id="gstin" name="gstin" defaultValue={gym.gstin ?? ""} maxLength={15} className="uppercase" />
          </Field>
          <Field label="Default GST rate (%)" htmlFor="defaultGstRate" hint="Plans can override this">
            <Input id="defaultGstRate" name="defaultGstRate" type="number" step="0.01" min={0} max={40} defaultValue={gym.default_gst_rate} />
          </Field>
          <Field label="SAC code" htmlFor="sacCode" hint="999723 — health club & fitness centre services">
            <Input id="sacCode" name="sacCode" defaultValue={gym.sac_code} />
          </Field>
          <Field label="Invoice prefix" htmlFor="invoicePrefix" error={errors.invoicePrefix} hint="Numbers look like MH/2026-27/0001 and restart each financial year">
            <Input id="invoicePrefix" name="invoicePrefix" defaultValue={gym.invoice_prefix} className="uppercase" />
          </Field>
        </Section>

        <Section title="Membership rules">
          <Field label="When does a membership activate?" htmlFor="activationRule">
            <Select id="activationRule" name="activationRule" defaultValue={gym.activation_rule}>
              <option value="full_payment">After full payment</option>
              <option value="any_payment">After any payment</option>
              <option value="immediate">Immediately on the start date</option>
            </Select>
          </Field>
          <Field label="Maximum pause days per term" htmlFor="pauseMaxDays" hint="Caps every plan's pause allowance">
            <Input id="pauseMaxDays" name="pauseMaxDays" type="number" min={0} max={60} defaultValue={gym.pause_max_days} />
          </Field>
          <Field label="Expiry reminders (days before)" htmlFor="reminderOffsets" error={errors.reminderOffsets} hint="Comma separated, 0 = on the expiry day">
            <Input id="reminderOffsets" name="reminderOffsets" defaultValue={gym.reminder_offsets.join(", ")} />
          </Field>
          <Field label="Renewal follow-up (days after expiry)" htmlFor="renewalFollowUpDays">
            <Input id="renewalFollowUpDays" name="renewalFollowUpDays" type="number" min={1} max={60} defaultValue={gym.renewal_follow_up_days} />
          </Field>
        </Section>

        <Section title="WhatsApp integration">
          <Field
            label="Provider"
            htmlFor="whatsappProvider"
            hint={
              metaConfigured
                ? "Cloud API credentials are configured on the server."
                : "Cloud API credentials are not configured on the server yet — keep Sandbox until they are."
            }
          >
            <Select id="whatsappProvider" name="whatsappProvider" defaultValue={gym.whatsapp_provider}>
              <option value="mock">Sandbox — simulate (nothing is delivered)</option>
              <option value="meta_cloud">WhatsApp Business Platform (Cloud API)</option>
            </Select>
          </Field>
          <p className="self-end pb-1 text-xs text-muted">With the Cloud API, members also get a one-time WhatsApp code when opening their portal link.</p>
        </Section>
      </fieldset>
      {canEdit ? (
        <Button type="submit" size="lg" loading={pending}>
          Save settings
        </Button>
      ) : (
        <p className="text-sm text-muted">Only owners and admins can change these settings.</p>
      )}
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description && <p className="text-xs text-muted">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
