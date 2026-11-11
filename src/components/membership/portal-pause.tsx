"use client";

import * as React from "react";
import { CirclePause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { portalRequestPause } from "@/server/portal";
import { PauseForm, type PausableMembership } from "./pause-form";

export function PortalPauseButton({ membership }: { membership: PausableMembership }) {
  const [open, setOpen] = React.useState(false);
  const remaining = membership.pause_allowance_days - membership.pause_days_used;
  return (
    <>
      <Button size="lg" className="w-full" disabled={remaining <= 0} onClick={() => setOpen(true)}>
        <CirclePause /> {remaining > 0 ? "Request a pause" : "No pause days left"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Pause your membership" description="Valid requests are approved instantly.">
        <PauseForm membership={membership} onDone={() => setOpen(false)} submit={portalRequestPause} showReason={false} />
      </Sheet>
    </>
  );
}
