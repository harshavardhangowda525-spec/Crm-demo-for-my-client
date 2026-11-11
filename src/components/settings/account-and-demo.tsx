"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, KeyRound, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { changeMyPassword, loadDemoData, removeDemoData, updateMyName } from "@/server/settings";

export function AccountForms({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name") ?? "");
          start(async () => {
            const r = await updateMyName(name);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Name updated");
            router.refresh();
          });
        }}
      >
        <Field label="Your name" htmlFor="myname">
          <Input id="myname" name="name" defaultValue={fullName} />
        </Field>
        <Button type="submit" variant="secondary" loading={pending}>
          <UserRound /> Save name
        </Button>
      </form>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const a = String(f.get("pw") ?? "");
          if (a !== String(f.get("pw2") ?? "")) return void toast.error("Passwords don't match");
          start(async () => {
            const r = await changeMyPassword(a);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Password changed");
            form.reset();
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="New password" htmlFor="pw">
            <Input id="pw" name="pw" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="Repeat" htmlFor="pw2">
            <Input id="pw2" name="pw2" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={pending}>
          <KeyRound /> Change password
        </Button>
      </form>
    </div>
  );
}

export function DemoDataControls({ hasDemo }: { hasDemo: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      {!hasDemo ? (
        <Button
          variant="secondary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await loadDemoData();
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Loaded ${r.data.customers} demo customers, ${r.data.active_memberships} active memberships`);
              router.refresh();
            })
          }
        >
          <Database /> Load demo data
        </Button>
      ) : (
        <Button
          variant="danger"
          loading={pending}
          onClick={() => {
            if (!confirm("Remove all demo customers, memberships, invoices and messages? Real records are not touched.")) return;
            start(async () => {
              const r = await removeDemoData();
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Removed ${r.data.removed_customers} demo customers`);
              router.refresh();
            });
          }}
        >
          <Trash2 /> Remove demo data
        </Button>
      )}
      <p className="text-xs text-muted">Demo records are flagged and never mixed with real ones.</p>
    </div>
  );
}
