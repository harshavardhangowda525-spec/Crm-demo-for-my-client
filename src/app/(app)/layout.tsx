import { requireStaff } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";
import { Header } from "@/components/shell/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <AppShell
      gymName={staff.gymName}
      role={staff.role}
      header={<Header fullName={staff.fullName} email={staff.email} role={staff.role} gymName={staff.gymName} />}
    >
      {children}
    </AppShell>
  );
}
