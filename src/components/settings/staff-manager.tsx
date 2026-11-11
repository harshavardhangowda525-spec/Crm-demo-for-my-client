"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { addStaff, setStaffActive } from "@/server/settings";
import type { StaffOption } from "@/server/queries";

export function StaffManager({ staff, canEdit, isOwner, myStaffId }: { staff: StaffOption[]; canEdit: boolean; isOwner: boolean; myStaffId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="space-y-5">
      <ul className="space-y-2">
        {staff.map((s) => (
          <li key={s.staff_id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {s.full_name} <Badge tone={s.role === "owner" ? "lime" : s.role === "admin" ? "cyan" : "neutral"}>{s.role}</Badge>
                {s.staff_id === myStaffId && <span className="text-xs text-subtle">(you)</span>}
              </p>
              <p className="truncate text-sm text-muted">{s.email}</p>
            </div>
            {canEdit && s.staff_id !== myStaffId && (s.role !== "owner" || isOwner) && (
              <Switch
                checked={s.active}
                aria-label={`${s.full_name} active`}
                onCheckedChange={(v) =>
                  start(async () => {
                    const r = await setStaffActive(s.staff_id, v);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(v ? "Access restored" : "Access removed");
                    router.refresh();
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="space-y-3 rounded-2xl bg-white/[0.02] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            start(async () => {
              const r = await addStaff({ email: String(f.get("email")), role: String(f.get("role")), fullName: String(f.get("fullName") ?? "") });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Staff member added");
              form.reset();
              router.refresh();
            });
          }}
        >
          <p className="text-sm font-medium">Add a staff member</p>
          <p className="text-xs text-muted">
            First create their login in Supabase → Authentication → Users (email + password), then add them here with a role.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email" htmlFor="se">
              <Input id="se" name="email" type="email" required />
            </Field>
            <Field label="Name" htmlFor="sn">
              <Input id="sn" name="fullName" />
            </Field>
            <Field label="Role" htmlFor="sr">
              <Select id="sr" name="role" defaultValue="staff">
                <option value="staff">Staff — daily operations</option>
                <option value="admin">Admin — plus settings, discounts</option>
                {isOwner && <option value="owner">Owner — full access</option>}
              </Select>
            </Field>
          </div>
          <Button type="submit" loading={pending}>
            <UserPlus /> Add staff
          </Button>
        </form>
      )}
    </div>
  );
}
