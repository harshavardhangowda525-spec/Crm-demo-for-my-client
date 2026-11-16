"use client";

import * as React from "react";
import { CirclePause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { portalRequestPause } from "@/server/portal";
import { PauseForm, type PausableMembership } from "./pause-form";

export function PortalPauseButton({ membership, reservedDays = 0 }: { membership: PausableMembership; reservedDays?: number }) {
  const [open, setOpen] = React.useState(false);
  const remaining = membership.pause_allowance_days - membership.pause_days_used - reservedDays;
  return (
    <>
      <Button size="lg" className="w-full" disabled={remaining <= 0} onClick={() => setOpen(true)}>
        <CirclePause /> {remaining > 0 ? "Request a pause" : reservedDays > 0 ? "Pause request waiting for approval" : "No pause days left"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Request a pause" description="Tell the gym when and why. Your expiry date moves only after they approve.">
        <PauseForm membership={membership} onDone={() => setOpen(false)} submit={portalRequestPause} mode="request" reservedDays={reservedDays} />
      </Sheet>
    </>
  );
}
