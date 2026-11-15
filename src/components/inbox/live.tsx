"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { markInboxRead } from "@/server/inbox";

/** Keeps the inbox fresh while it is open, and marks the open chat as read. */
export function InboxLive({ phone, unread }: { phone: string | null; unread: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 8000);
    return () => clearInterval(id);
  }, [router]);
  React.useEffect(() => {
    if (phone && unread > 0) void markInboxRead(phone).then(() => router.refresh());
  }, [phone, unread, router]);
  return null;
}
