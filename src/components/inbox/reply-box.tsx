"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { sendInboxReply } from "@/server/inbox";

export function ReplyBox({ phone, windowOpen }: { phone: string; windowOpen: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [pending, start] = React.useTransition();
  const send = () =>
    start(async () => {
      const r = await sendInboxReply({ phone, body });
      if (!r.ok) return void toast.error(r.error);
      setBody("");
      router.refresh();
    });
  if (!windowOpen) {
    return (
      <p className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs text-muted">
        More than 24 hours since this contact last wrote. WhatsApp only allows approved templates until they message again.
      </p>
    );
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send();
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && body.trim()) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Type a reply…"
        maxLength={4000}
        className="min-h-12 flex-1 resize-none"
        rows={2}
        aria-label="Reply"
      />
      <Button type="submit" size="icon" loading={pending} disabled={!body.trim()} aria-label="Send reply">
        <SendHorizontal />
      </Button>
    </form>
  );
}
