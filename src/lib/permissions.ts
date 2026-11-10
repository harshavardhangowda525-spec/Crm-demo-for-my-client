export const STAFF_ROLES = ["owner", "admin", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Single source of truth for what each role may do in the app layer.
 * The database enforces the same boundaries independently through RLS.
 */
export const PERMISSIONS = {
  "customers.read": ["owner", "admin", "staff"],
  "customers.write": ["owner", "admin", "staff"],
  "customers.delete": ["owner", "admin"],
  "enquiries.write": ["owner", "admin", "staff"],
  "memberships.activate": ["owner", "admin", "staff"],
  "memberships.cancel": ["owner", "admin"],
  "memberships.discount": ["owner", "admin"],
  "pauses.create": ["owner", "admin", "staff"],
  "invoices.create": ["owner", "admin", "staff"],
  "invoices.cancel": ["owner", "admin"],
  "payments.record": ["owner", "admin", "staff"],
  "messages.retry": ["owner", "admin"],
  "automations.manage": ["owner", "admin"],
  "analytics.read": ["owner", "admin"],
  "settings.manage": ["owner", "admin"],
  "staff.manage": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}
