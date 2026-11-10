import { ModuleRoadmap } from "@/components/module-roadmap";
import { requirePermission } from "@/lib/auth";
export const metadata = { title: "Analytics" };
export default async function Page() {
  await requirePermission("analytics.read");
  return (
    <ModuleRoadmap phase={6} title="Analytics" description="Revenue, conversions and renewals from real records."
      items={["Collected revenue by day, week, month", "Enquiry-to-member conversion", "Plan popularity", "Outstanding invoices"]} />
  );
}
