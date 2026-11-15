"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/card";
import { saveAutoReply } from "@/server/inbox";

const EXAMPLE = `🕒 Timings: Mon–Sat 5:00 AM – 10:00 PM, Sunday 6:00 AM – 12:00 PM
🏋️ Facilities: cardio, strength, personal training, steam bath
🅿️ Parking available. Locker deposit ₹500 (refundable).`;

export function BotSettings({ enabled, info, canEdit }: { enabled: boolean; info: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = React.useState(enabled);
  const [text, setText] = React.useState(info ?? "");
  const [pending, start] = React.useTransition();
  const save = (next = on) =>
    start(async () => {
      const r = await saveAutoReply({ enabled: next, info: text });
      if (!r.ok) return void toast.error(r.error);
      toast.success(next ? "WhatsApp bot is on" : "Saved — bot is off, messages wait for staff");
      router.refresh();
    });
  return (
    <GlassCard className="p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="metal grid size-10 shrink-0 place-items-center rounded-xl">
          <Bot className="size-5 text-cyan" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-fg">WhatsApp menu bot</p>
              <p className="text-sm text-muted">
                Answers members instantly: membership & expiry, plans & prices, timings, dues, pause days. Anything else comes to this inbox.
              </p>
            </div>
            <Switch
              checked={on}
              disabled={!canEdit || pending}
              onCheckedChange={(v) => {
                setOn(v);
                save(v);
              }}
              aria-label="Turn the WhatsApp bot on or off"
            />
          </div>
          <label className="mt-4 block text-[13px] font-medium text-fg" htmlFor="bot-info">
            Gym information the bot shares (timings, facilities, rules)
          </label>
          <Textarea
            id="bot-info"
            className="mt-1.5"
            rows={4}
            maxLength={4000}
            value={text}
            disabled={!canEdit}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-subtle">Plans, prices and member details come from the CRM automatically — update them in Settings.</p>
            {canEdit && (
              <Button size="sm" variant="secondary" loading={pending} onClick={() => save()}>
                Save information
              </Button>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
