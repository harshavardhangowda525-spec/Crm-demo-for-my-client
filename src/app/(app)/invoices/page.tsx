import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Invoices" };
export default function Page() {
  return (
    <ModuleRoadmap phase={4} title="Invoices" description="GST invoices, payments and PDF delivery."
      items={["Invoice builder with GST breakdown", "Sequential invoice numbers", "Branded PDF invoices", "Payment recording and cancellations"]} />
  );
}
