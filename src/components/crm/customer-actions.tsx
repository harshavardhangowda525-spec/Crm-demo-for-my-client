"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, CalendarClock, CirclePause, Copy, Link2, NotebookPen, Pencil, Plus, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { addNote, createEnquiry, logFollowUp, sendPortalLink, updateCustomer, updateEnquiry } from "@/server/crm";
import { cancelMembership } from "@/server/memberships";
import { ENQUIRY_SOURCES, FOLLOW_UP_KINDS, FOLLOW_UP_OUTCOMES, addDaysISO, todayISO } from "@/lib/format";
import { ActivateMembershipForm, type ActivationContext } from "@/components/membership/activate-form";
import { PauseForm, type PausableMembership } from "@/components/membership/pause-form";
import type { PlanOption, StaffOption } from "@/server/queries";

type Customer = {
  id: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  notes: string | null;
  assigned_staff_id: string | null;
  whatsapp_opt_in: boolean;
};
type OpenEnquiry = {
  id: string;
  status: string;
  follow_up_date: string | null;
  interested_plan_id: string | null;
  assigned_staff_id: string | null;
} | null;

type SheetKind = "note" | "follow-up" | "edit" | "enquiry" | "new-enquiry" | "activate" | "pause" | "cancel" | null;

export function CustomerActions({
  customer,
  enquiry,
  plans,
  staff,
  activation,
  pausable,
  canCancel,
}: {
  customer: Customer;
  enquiry: OpenEnquiry;
  plans: PlanOption[];
  staff: StaffOption[];
  activation: ActivationContext;
  pausable: PausableMembership | null;
  canCancel: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("do") as SheetKind;
  const [open, setOpen] = React.useState<SheetKind>(initial);
  const [pending, start] = React.useTransition();
  const [portalLink, setPortalLink] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (initial) router.replace(`/customers/${customer.id}`, { scroll: false });
  }, [initial, router, customer.id]);

  const close = () => setOpen(null);
  const today = todayISO();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(success);
      close();
      router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen("activate")} size="md">
          <BadgeCheck /> {pausable ? "Renew membership" : "Convert to membership"}
        </Button>
        {enquiry && (
          <Button variant="secondary" onClick={() => setOpen("follow-up")}>
            <CalendarClock /> Log follow-up
          </Button>
        )}
        <Button variant="secondary" onClick={() => setOpen("note")}>
          <NotebookPen /> Add note
        </Button>
        {pausable && (
          <Button variant="secondary" onClick={() => setOpen("pause")}>
            <CirclePause /> Pause
          </Button>
        )}
        {!enquiry && (
          <Button variant="outline" onClick={() => setOpen("new-enquiry")}>
            <Plus /> New enquiry
          </Button>
        )}
        <Button variant="outline" onClick={() => setOpen("edit")}>
          <Pencil /> Edit
        </Button>
        <Button
          variant="outline"
          loading={pending && open === null}
          onClick={() =>
            start(async () => {
              const r = await sendPortalLink(customer.id);
              if (!r.ok) return void toast.error(r.error);
              setPortalLink(r.data.link);
              toast.success(r.data.queued ? "Portal link queued for WhatsApp" : "Portal link created (customer has not opted in to WhatsApp)");
              router.refresh();
            })
          }
        >
          <Link2 /> Member portal link
        </Button>
        {pausable && canCancel && (
          <Button variant="danger" onClick={() => setOpen("cancel")}>
            <ShieldX /> Cancel membership
          </Button>
        )}
      </div>

      {portalLink && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.03] p-2 pl-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{portalLink}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(portalLink).then(() => toast.success("Link copied"));
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
      )}

      <Sheet open={open === "activate"} onOpenChange={(o) => !o && close()} title={pausable ? "Renew membership" : "Convert to membership"} description={customer.full_name} size="lg">
        <ActivateMembershipForm ctx={activation} onDone={close} />
      </Sheet>

      {pausable && (
        <Sheet open={open === "pause"} onOpenChange={(o) => !o && close()} title="Pause membership" description={customer.full_name}>
          <PauseForm membership={pausable} onDone={close} />
        </Sheet>
      )}

      <Sheet open={open === "note"} onOpenChange={(o) => !o && close()} title="Add note" description={customer.full_name} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const body = String(new FormData(e.currentTarget).get("body") ?? "");
            run(() => addNote({ customerId: customer.id, enquiryId: enquiry?.id ?? "", body }), "Note added");
          }}
        >
          <Textarea name="body" autoFocus required maxLength={4000} placeholder="What did the customer say?" />
          <Button type="submit" className="w-full" loading={pending}>
            Save note
          </Button>
        </form>
      </Sheet>

      {enquiry && (
        <Sheet open={open === "follow-up"} onOpenChange={(o) => !o && close()} title="Update enquiry" description="Log the follow-up and set what happens next.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const s = (k: string) => String(f.get(k) ?? "");
              run(
                () =>
                  logFollowUp({
                    enquiryId: enquiry.id,
                    kind: s("kind"),
                    outcome: s("outcome"),
                    body: s("body"),
                    nextFollowUpDate: s("next"),
                    newStatus: s("status"),
                  }),
                "Follow-up logged",
              );
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="How" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="follow_up_call">
                  {Object.entries(FOLLOW_UP_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Outcome" htmlFor="outcome">
                <Select id="outcome" name="outcome" defaultValue="reached">
                  {Object.entries(FOLLOW_UP_OUTCOMES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Summary" htmlFor="body">
              <Textarea id="body" name="body" required maxLength={4000} placeholder="e.g. Will join after salary on the 1st." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Enquiry status" htmlFor="status">
                <Select id="status" name="status" defaultValue={enquiry.status}>
                  <option value="new">New enquiry</option>
                  <option value="follow_up_pending">Follow-up pending</option>
                  <option value="interested">Interested</option>
                  <option value="not_interested">Not interested</option>
                </Select>
              </Field>
              <Field label="Next follow-up" htmlFor="next">
                <Input id="next" name="next" type="date" min={today} defaultValue={addDaysISO(today, 3)} />
              </Field>
            </div>
            <Button type="submit" className="w-full" loading={pending}>
              Save follow-up
            </Button>
            <div className="divider-metal" />
            <EnquiryQuickEdit enquiry={enquiry} plans={plans} staff={staff} onDone={close} />
          </form>
        </Sheet>
      )}

      <Sheet open={open === "new-enquiry"} onOpenChange={(o) => !o && close()} title="New enquiry" description="For a returning customer asking about a plan again.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const s = (k: string) => String(f.get(k) ?? "");
            run(
              () =>
                createEnquiry({ customerId: customer.id, interestedPlanId: s("plan"), source: s("source"), followUpDate: s("follow"), notes: s("notes") }),
              "Enquiry created",
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interested plan" htmlFor="plan">
              <Select id="plan" name="plan" defaultValue="">
                <option value="">Not decided</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source" htmlFor="source">
              <Select id="source" name="source" defaultValue="walk_in">
                {Object.entries(ENQUIRY_SOURCES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Follow-up date" htmlFor="follow">
            <Input id="follow" name="follow" type="date" min={today} defaultValue={addDaysISO(today, 3)} />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" maxLength={4000} />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Create enquiry
          </Button>
        </form>
      </Sheet>

      <Sheet open={open === "edit"} onOpenChange={(o) => !o && close()} title="Edit customer" description="Changes are recorded on the timeline.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const s = (k: string) => String(f.get(k) ?? "");
            run(
              () =>
                updateCustomer({
                  customerId: customer.id,
                  fullName: s("fullName"),
                  phone: s("phone"),
                  email: s("email"),
                  dateOfBirth: s("dob"),
                  gender: s("gender"),
                  assignedStaffId: s("staff"),
                  notes: s("notes"),
                  whatsappOptIn: f.get("optin") === "on",
                }),
              "Customer updated",
            );
          }}
        >
          <Field label="Full name" htmlFor="fullName">
            <Input id="fullName" name="fullName" defaultValue={customer.full_name} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={customer.phone_e164} required />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={customer.email ?? ""} />
            </Field>
            <Field label="Date of birth" htmlFor="dob">
              <Input id="dob" name="dob" type="date" defaultValue={customer.date_of_birth ?? ""} max={today} />
            </Field>
            <Field label="Gender" htmlFor="gender">
              <Select id="gender" name="gender" defaultValue={customer.gender ?? ""}>
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </Select>
            </Field>
          </div>
          <Field label="Assigned staff" htmlFor="staff">
            <Select id="staff" name="staff" defaultValue={customer.assigned_staff_id ?? ""}>
              <option value="">Unassigned</option>
              {staff
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.staff_id} value={s.staff_id}>
                    {s.full_name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Profile notes" htmlFor="pnotes">
            <Textarea id="pnotes" name="notes" defaultValue={customer.notes ?? ""} maxLength={4000} />
          </Field>
          <Checkbox name="optin" defaultChecked={customer.whatsapp_opt_in} label="Receives WhatsApp updates" description="Untick to opt the customer out of all automated messages." />
          <Button type="submit" className="w-full" loading={pending}>
            Save changes
          </Button>
        </form>
      </Sheet>

      {pausable && (
        <Sheet open={open === "cancel"} onOpenChange={(o) => !o && close()} title="Cancel membership" description="This cannot be undone. The invoice stays on record." size="sm">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              run(() => cancelMembership(pausable.id, reason), "Membership cancelled");
            }}
          >
            <Textarea name="reason" required minLength={3} placeholder="Reason for cancelling" />
            <Button type="submit" variant="danger" className="w-full" loading={pending}>
              Cancel membership
            </Button>
          </form>
        </Sheet>
      )}
    </>
  );
}

function EnquiryQuickEdit({
  enquiry,
  plans,
  staff,
  onDone,
}: {
  enquiry: NonNullable<OpenEnquiry>;
  plans: PlanOption[];
  staff: StaffOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [plan, setPlan] = React.useState(enquiry.interested_plan_id ?? "");
  const [assignee, setAssignee] = React.useState(enquiry.assigned_staff_id ?? "");
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Or just change details</p>
      <div className="grid grid-cols-2 gap-3">
        <Select aria-label="Interested plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">No plan chosen</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Assigned staff" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.staff_id} value={s.staff_id}>
              {s.full_name}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await updateEnquiry({
              enquiryId: enquiry.id,
              status: enquiry.status,
              followUpDate: enquiry.follow_up_date ?? "",
              interestedPlanId: plan,
              assignedStaffId: assignee,
            });
            if (!r.ok) return void toast.error(r.error);
            toast.success("Enquiry updated");
            onDone();
            router.refresh();
          })
        }
      >
        Update plan & assignee
      </Button>
    </div>
  );
}
