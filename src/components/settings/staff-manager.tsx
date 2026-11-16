"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setStaffActive } from "@/server/settings";
import type { StaffOption } from "@/server/queries";

export function StaffManager({ staff, canEdit, isOwner, myStaffId }: { staff: StaffOption[]; canEdit: boolean; isOwner: boolean; myStaffId: string }) {
  const router = useRouter();
  const [, start] = React.useTransition();
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
    </div>
  );
}
