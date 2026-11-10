"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";

export function ProfileMenu({ fullName, email, role }: { fullName: string; email: string | null; role: string }) {
  const initials = fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="focus-ring flex items-center gap-3 rounded-2xl p-1 pr-1 hover:bg-white/[0.04] md:pr-3"
        aria-label="Account menu"
      >
        <span className="metal grid size-10 place-items-center rounded-xl font-display text-sm font-semibold text-fg">
          {initials || "?"}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-40 truncate text-sm font-medium">{fullName}</span>
          <span className="block text-[11px] capitalize text-muted">{role}</span>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="glass z-50 w-64 p-1.5 data-[state=open]:animate-[menu-in_180ms_var(--ease-out-expo)]"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{fullName}</p>
            {email && <p className="truncate text-xs text-muted">{email}</p>}
            <p className="mt-1.5 inline-flex rounded-md bg-lime/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-lime">
              {role}
            </p>
          </div>
          <div className="divider-metal my-1" />
          <form action={signOut}>
            <Dropdown.Item asChild>
              <button
                type="submit"
                className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm text-muted outline-none data-[highlighted]:bg-white/5 data-[highlighted]:text-fg"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </Dropdown.Item>
          </form>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
