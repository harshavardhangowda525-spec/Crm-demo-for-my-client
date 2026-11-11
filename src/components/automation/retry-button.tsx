"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryMessage } from "@/server/automations";

export function RetryMessageButton({ messageId, className }: { messageId: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await retryMessage(messageId);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Message queued again");
          router.refresh();
        })
      }
    >
      <RotateCcw /> Retry
    </Button>
  );
}
