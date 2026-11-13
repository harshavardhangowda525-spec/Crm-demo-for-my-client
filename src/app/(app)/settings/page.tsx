import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { GymSettingsForm } from "@/components/settings/gym-form";
import { PlansManager } from "@/components/settings/plans-manager";
import { StaffManager } from "@/components/settings/staff-manager";
import { AccountForms, DemoDataControls } from "@/components/settings/account-and-demo";
import { getGym, getPlans, getStaffDirectory } from "@/server/queries";
import { MyReminders, TagCatalogue } from "@/components/settings/reminders";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff();
  const canManage = can(staff.role, "settings.manage");
  const [gym, plans, staffList] = await Promise.all([getGym(staff.gymId), getPlans(staff.gymId, true), getStaffDirectory()]);
  const supabase = await createClient();
  const { count: demoCount } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("gym_id", staff.gymId).eq("is_demo", true);
  const env = serverEnv();
  const [{ data: me }, { data: profile }, { data: tags }] = await Promise.all([
    supabase.from("gym_staff").select("briefing_enabled, briefing_time, evening_summary_enabled, evening_summary_time").eq("id", staff.staffId).single(),
    supabase.from("user_profiles").select("phone_e164").eq("id", staff.userId).single(),
    supabase.from("customer_tags").select("id, label, kind, active").eq("gym_id", staff.gymId).order("kind").order("sort_order").order("label"),
  ]);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Configuration" title="Settings" description="Timezone: Asia/Kolkata · Currency: INR" />

      <Card id="account" title="Your account">
        <AccountForms fullName={staff.fullName} />
      </Card>

      <Card id="reminders" title="Reminders" description="The system remembers for you and tells you who to contact, when, and why.">
        <MyReminders
          prefs={{
            briefingEnabled: !!me?.briefing_enabled,
            briefingTime: me?.briefing_time ?? "08:00",
            eveningEnabled: !!me?.evening_summary_enabled,
            eveningTime: me?.evening_summary_time ?? "20:00",
            phone: profile?.phone_e164 ?? null,
          }}
        />
      </Card>

      <Card id="tags" title="Interest & objection tags" description="The one-tap tags staff use when logging conversations.">
        <TagCatalogue tags={(tags ?? []) as { id: string; label: string; kind: "interest" | "objection"; active: boolean }[]} canEdit={canManage} />
      </Card>

      <Card id="plans" title="Membership plans" description="Prices are never hard-coded — every sale uses the plan's current price.">
        <PlansManager plans={plans} canEdit={canManage} defaultGstRate={Number(gym.default_gst_rate)} pauseMax={gym.pause_max_days} />
      </Card>

      <Card id="gym" title="Gym, GST & automation rules">
        <GymSettingsForm
          gym={gym}
          canEdit={canManage}
          metaConfigured={!!(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN)}
          aiConfigured={!!env.ANTHROPIC_API_KEY}
        />
      </Card>

      <Card id="staff" title="Staff & roles" description="Owner: everything. Admin: settings, discounts, cancellations. Staff: customers, enquiries, memberships, invoices, payments.">
        <StaffManager staff={staffList} canEdit={can(staff.role, "staff.manage")} isOwner={staff.role === "owner"} myStaffId={staff.staffId} />
      </Card>

      {staff.role === "owner" && (
        <Card id="demo" title="Demonstration data" description="100 sample customers, enquiries, memberships, invoices, payments, pauses and message logs.">
          <DemoDataControls hasDemo={(demoCount ?? 0) > 0} />
        </Card>
      )}
    </div>
  );
}

function Card({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <GlassCard id={id} className="scroll-mt-24 p-5 md:p-7">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="divider-metal my-5" />
      {children}
    </GlassCard>
  );
}
