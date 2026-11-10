import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Memberships" };
export default function Page() {
  return (
    <ModuleRoadmap phase={3} title="Memberships" description="Plans, activations, expiries and pauses."
      items={["Configurable membership plans", "One-tap activation with expiry calculation", "7-day smart pause system", "Secure member portal"]} />
  );
}
