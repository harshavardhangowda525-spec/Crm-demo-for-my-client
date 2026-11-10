"use client";

import * as React from "react";
import type { StaffRole } from "@/lib/permissions";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";

const STORAGE_KEY = "mh.sidebar.collapsed";

export function AppShell({
  gymName,
  role,
  header,
  children,
}: {
  gymName: string;
  role: StaffRole;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar gymName={gymName} role={role} collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-32 pt-4 md:px-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav role={role} />
    </div>
  );
}
