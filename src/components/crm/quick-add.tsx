"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Plus, Search } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { CustomerCreateForm, type CustomerFormLookups } from "./customer-form";
import { CustomerSearch } from "./customer-search";

type Ctx = { openAdd: (prefill?: string) => void; openSearch: () => void };
const QuickAddContext = React.createContext<Ctx | null>(null);

export function useQuickAdd() {
  const ctx = React.useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd outside provider");
  return ctx;
}

/** Global "add customer" sheet + search palette (⌘K / Ctrl K, or "/"). */
export function QuickAddProvider({ lookups, children }: { lookups: CustomerFormLookups; children: React.ReactNode }) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<string | undefined>();
  const [searchOpen, setSearchOpen] = React.useState(false);

  const openAdd = React.useCallback((p?: string) => {
    setPrefill(p);
    setSearchOpen(false);
    setAddOpen(true);
  }, []);
  const openSearch = React.useCallback(() => setSearchOpen(true), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <QuickAddContext.Provider value={{ openAdd, openSearch }}>
      {children}
      <Sheet open={addOpen} onOpenChange={setAddOpen} title="New customer enquiry" description="Saves the customer, their enquiry and WhatsApp consent together." size="lg">
        <CustomerCreateForm key={prefill ?? "new"} lookups={lookups} prefill={prefill} onDone={() => setAddOpen(false)} />
      </Sheet>
      <Sheet open={searchOpen} onOpenChange={setSearchOpen} title="Find a customer" description="Search by mobile number or name" size="lg">
        <CustomerSearch autoFocus compact onNavigate={() => setSearchOpen(false)} onAddNew={openAdd} />
      </Sheet>
    </QuickAddContext.Provider>
  );
}

export function SearchTrigger() {
  const { openSearch } = useQuickAdd();
  return (
    <button
      type="button"
      onClick={openSearch}
      className="focus-ring flex h-11 items-center gap-2.5 rounded-xl px-3 text-sm text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04] hover:text-fg md:w-72 md:px-4"
      aria-label="Search customers"
    >
      <Search className="size-[18px]" />
      <span className="hidden md:inline">Search mobile or name…</span>
      <kbd className="ml-auto hidden rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-subtle md:inline">/</kbd>
    </button>
  );
}

export function QuickAddButton({ className }: { className?: string }) {
  const { openAdd } = useQuickAdd();
  return (
    <button
      type="button"
      onClick={() => openAdd()}
      className={
        className ??
        "focus-ring hidden h-11 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-bg shadow-[var(--shadow-lime)] transition-transform active:scale-[0.97] lg:inline-flex"
      }
    >
      <Plus className="size-4" /> New enquiry
    </button>
  );
}

/** Floating quick-add for phones, above the bottom navigation. */
export function QuickAddFab() {
  const { openAdd } = useQuickAdd();
  return (
    <motion.button
      type="button"
      onClick={() => openAdd()}
      whileTap={{ scale: 0.92 }}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.2 }}
      className="focus-ring fixed bottom-[calc(max(env(safe-area-inset-bottom),12px)+92px)] right-4 z-40 grid size-14 place-items-center rounded-2xl bg-lime text-bg shadow-[0_0_0_1px_rgb(198_255_69/0.4),0_12px_30px_-6px_rgb(198_255_69/0.55)] lg:hidden"
      aria-label="Add new customer enquiry"
    >
      <Plus className="size-6" strokeWidth={2.5} />
    </motion.button>
  );
}
