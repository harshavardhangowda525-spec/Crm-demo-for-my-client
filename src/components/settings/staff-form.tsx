"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { addStaff } from "@/server/settings";

/** Gives an existing login access to this gym with a role. */
export function StaffForm({ isOwner, onDone }: { isOwner: boolean; onDone?: () => void }) {
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
        start(async () => {
          const r = await addStaff({ email: String(f.get("email") ?? ""), role: String(f.get("role")), fullName: String(f.get("fullName") ?? "") });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Staff member added");
          onDone?.();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="sf-name" error={errors.fullName} className="sm:col-span-2">
          <Input id="sf-name" name="fullName" autoComplete="off" />
        </Field>
        <Field label="Login email" htmlFor="sf-email" error={errors.email}>
          <Input id="sf-email" name="email" type="email" inputMode="email" required autoComplete="off" />
        </Field>
        <Field label="Role" htmlFor="sf-role">
          <Select id="sf-role" name="role" defaultValue="staff">
            <option value="staff">Staff — daily operations</option>
            <option value="admin">Admin — plus settings, discounts</option>
            {isOwner && <option value="owner">Owner — full access</option>}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-muted">The email must already have a login for this CRM. They sign in with their own password.</p>
      <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
        <UserPlus /> Add staff member
      </Button>
    </form>
  );
}
