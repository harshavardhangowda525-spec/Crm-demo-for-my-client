import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Customers" };
export default function Page() {
  return (
    <ModuleRoadmap phase={2} title="Customers" description="Every member and prospect in one place."
      items={["Instant phone-number search", "Add customer with duplicate detection", "Full activity timeline", "Staff notes and assignments"]} />
  );
}
