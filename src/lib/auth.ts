import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission, type StaffRole } from "@/lib/permissions";

export type StaffContext = {
  userId: string;
  email: string | null;
  fullName: string;
  gymId: string;
  gymName: string;
  staffId: string;
  role: StaffRole;
};

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Resolves the signed-in staff member and their gym from the database.
 * The gym is always derived from auth.uid() → gym_staff, never from input.
 * Returns null when signed in but not (or no longer) an active staff member.
 */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: staff }, { data: profile }] = await Promise.all([
    supabase.rpc("current_staff"),
    supabase.from("user_profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const row = staff?.[0];
  if (!row) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name || user.email?.split("@")[0] || "there",
    gymId: row.gym_id,
    gymName: row.gym_name,
    staffId: row.staff_id,
    role: row.role as StaffRole,
  };
});

/** For pages/layouts: redirect when not signed in or not staff. */
export async function requireStaff(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/no-access");
  return ctx;
}

/** For server actions / route handlers: throw when the permission is missing. */
export async function authorize(permission: Permission): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) throw new AuthorizationError("Please sign in again.");
  if (!can(ctx.role, permission)) throw new AuthorizationError();
  return ctx;
}

/** For pages: send users without the permission back to the overview. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!can(ctx.role, permission)) redirect("/");
  return ctx;
}
