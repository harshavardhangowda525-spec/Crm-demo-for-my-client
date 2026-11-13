"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendWhatsAppTest } from "@/server/automations";
import { formatPhone } from "@/lib/phone";

/** Sends Meta's approved hello_world template to your own number via the CRM pipeline. */
export function WhatsAppTestButton() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="primary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await sendWhatsAppTest();
          if (!r.ok) return void toast.error(r.error);
          const to = formatPhone(r.data.to);
          if (r.data.status === "sent") toast.success(`Sent to ${to} via WhatsApp — check your phone`);
          else if (r.data.status === "simulated") toast.message(`Simulated only — the gym is in Sandbox mode (Settings → WhatsApp)`);
          else toast.error(`WhatsApp rejected it: ${r.data.error ?? "unknown error"}`);
          router.refresh();
        })
      }
    >
      <MessageCircle /> Send WhatsApp test
    </Button>
  );
}
