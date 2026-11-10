import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Settings" };
export default function Page() {
  return (
    <ModuleRoadmap phase={3} title="Settings" description="Gym profile, GST, plans, staff and messaging."
      items={["Gym profile, logo and GST details", "Membership plans and pause policy", "Staff accounts and roles", "WhatsApp templates and reminder timing"]} />
  );
}
