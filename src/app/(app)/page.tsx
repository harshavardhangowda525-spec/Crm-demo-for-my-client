import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { StatTile } from "@/components/stat-tile";

export const metadata = { title: "Overview" };

/**
 * Phase 1 overview: live record counts straight from the database (RLS-scoped
 * to the signed-in staff member's gym). The full command-center dashboard is
 * built in phase 6 on top of the same data.
 */
export default async function OverviewPage() {
  const staff = await requireStaff();
  const supabase = await createClient();

  const head = { count: "exact" as const, head: true };
  const toCount = ({ count: c, error }: { count: number | null; error: unknown }) => (error ? null : (c ?? 0));

  const [customers, openEnquiries, activeMemberships, staffCount] = (
    await Promise.all([
      supabase.from("customers").select("id", head).eq("gym_id", staff.gymId),
      supabase
        .from("enquiries")
        .select("id", head)
        .eq("gym_id", staff.gymId)
        .in("status", ["new", "follow_up_pending", "interested"]),
      supabase.from("memberships").select("id", head).eq("gym_id", staff.gymId).in("status", ["active", "paused"]),
      supabase.from("gym_staff").select("id", head).eq("gym_id", staff.gymId).eq("active", true),
    ])
  ).map(toCount);

  const tiles = [
    { label: "Customers", value: customers, icon: "users" as const, hint: "Total profiles on record", accent: "cyan" as const },
    { label: "Open enquiries", value: openEnquiries, icon: "enquiries" as const, hint: "New, follow-up or interested", accent: "lime" as const },
    { label: "Active memberships", value: activeMemberships, icon: "memberships" as const, hint: "Active or currently paused", accent: "lime" as const },
    { label: "Team", value: staffCount, icon: "staff" as const, hint: "Active staff accounts", accent: "cyan" as const },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Command center" title={staff.gymName} description="Live counts from your gym's records." />
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {tiles.map((t, i) => (
          <StatTile key={t.label} index={i} {...t} />
        ))}
      </div>
      <GlassCard className="p-6">
        <p className="text-sm font-medium text-fg">Foundation is live</p>
        <p className="mt-1 text-sm text-muted">
          Sign-in, roles, database security and navigation are working. Customer search, enquiries,
          memberships and invoices arrive in the next phases; the full dashboard with revenue charts and the
          action center comes in phase 6.
        </p>
      </GlassCard>
    </div>
  );
}
