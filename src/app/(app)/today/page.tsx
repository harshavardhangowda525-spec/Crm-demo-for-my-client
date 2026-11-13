import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SectionTitle } from "@/components/ui/card";
import { TodayList, type TodayItem } from "@/components/today/today-list";
import { AddReminderButton } from "@/components/today/add-reminder";
import { getStaffDirectory } from "@/server/queries";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data, error }, staffList] = await Promise.all([supabase.rpc("today_feed"), getStaffDirectory()]);
  if (error) throw error;
  const items = (data ?? []) as TodayItem[];
  const urgent = items.filter((i) => i.priority === 1).length;

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Your day"
        title="Today"
        description={
          items.length
            ? `${items.length} thing${items.length === 1 ? "" : "s"} to look at${urgent ? ` · ${urgent} need${urgent === 1 ? "s" : ""} action now` : ""}. Everything you need to remember is on each card.`
            : "Nothing to remember today — the system is watching follow-ups, renewals, payments, birthdays and promises for you."
        }
        action={<AddReminderButton staff={staffList} variant="primary" label="New reminder" />}
      />
      <TodayList items={items} gymName={staff.gymName} />
    </div>
  );
}
