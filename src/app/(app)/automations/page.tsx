import { ModuleRoadmap } from "@/components/module-roadmap";
export const metadata = { title: "Automations" };
export default function Page() {
  return (
    <ModuleRoadmap phase={5} title="Automations" description="WhatsApp messages that run themselves."
      items={["Enquiry follow-ups", "Membership confirmations and invoice delivery", "Expiry and renewal reminders", "Execution history and retries"]} />
  );
}
