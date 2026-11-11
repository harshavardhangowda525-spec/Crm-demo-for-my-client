"use client";

import { useActionState } from "react";
import { MessageCircle } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalVerify } from "@/server/portal";

export default function PortalVerifyPage() {
  const [state, action, pending] = useActionState(portalVerify, {});
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <LogoMark className="mx-auto size-12" />
        <div className="glass mt-6 p-6">
          <MessageCircle className="size-6 text-success" />
          <h1 className="mt-3 font-display text-xl font-semibold">Check WhatsApp</h1>
          <p className="mt-1 text-sm text-muted">We sent a 6-digit code to your WhatsApp number. It expires in 10 minutes.</p>
          <form action={action} className="mt-5 space-y-3">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" className="text-center font-mono text-2xl tracking-[0.5em]" autoFocus aria-label="6-digit code" />
            {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={pending}>
              Verify
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
