import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Enquiries" };
export default function Page() {
  return (
    <ModuleRoadmap phase={2} title="Enquiries" description="Track walk-ins and leads until they convert."
      items={["Enquiry pipeline by status", "Follow-up scheduling", "Follow-up history and outcomes", "Convert to membership"]} />
  );
}
