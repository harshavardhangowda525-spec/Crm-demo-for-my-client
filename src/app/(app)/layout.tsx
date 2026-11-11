import { requireStaff } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import { AppShell } from "@/components/shell/app-shell";
import { Header } from "@/components/shell/header";
import { QuickAddFab, QuickAddProvider } from "@/components/crm/quick-add";
import { getActionCounts, getPlans, getStaffDirectory } from "@/server/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const [plans, staffList, counts] = await Promise.all([
    getPlans(staff.gymId),
    getStaffDirectory(),
    getActionCounts(staff.gymId, todayISO()),
  ]);
  return (
    <QuickAddProvider lookups={{ plans, staff: staffList, currentStaffId: staff.staffId }}>
      <AppShell
        gymName={staff.gymName}
        role={staff.role}
        header={<Header fullName={staff.fullName} email={staff.email} role={staff.role} gymName={staff.gymName} counts={counts} />}
      >
        {children}
      </AppShell>
      <QuickAddFab />
    </QuickAddProvider>
  );
}
