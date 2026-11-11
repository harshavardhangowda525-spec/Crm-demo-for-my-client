"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAutomationsNow } from "@/server/automations";

export function RunAutomationsNow() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await runAutomationsNow();
          if (!r.ok) return void toast.error(r.error);
          const d = r.data.dispatch;
          toast.success(
            `Queued ${r.data.queued} message(s), ${r.data.statusChanges} status update(s). Sent ${d.sent}, simulated ${d.simulated}, failed ${d.failed}.`,
          );
          router.refresh();
        })
      }
    >
      <Play /> Run daily automations now
    </Button>
  );
}
