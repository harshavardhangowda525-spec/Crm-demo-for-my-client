"use client";

import * as React from "react";
import { motion } from "motion/react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Dumbbell, MessageSquarePlus, Plus, Search, UserCog } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { TrainerForm } from "@/components/settings/trainer-form";
import { StaffForm } from "@/components/settings/staff-form";
import { CustomerCreateForm, type CustomerFormLookups } from "./customer-form";
import { CustomerSearch } from "./customer-search";

type Ctx = {
  openAdd: (prefill?: string) => void;
  openSearch: () => void;
  openTrainer: () => void;
  openChooser: () => void;
  openStaff: () => void;
  canManageStaff: boolean;
};
const QuickAddContext = React.createContext<Ctx | null>(null);

export function useQuickAdd() {
  const ctx = React.useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd outside provider");
  return ctx;
}

/** Global "add customer" sheet + search palette (⌘K / Ctrl K, or "/"). */
export function QuickAddProvider({
  lookups,
  canManageStaff = false,
  isOwner = false,
  children,
}: {
  lookups: CustomerFormLookups;
  canManageStaff?: boolean;
  isOwner?: boolean;
  children: React.ReactNode;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [trainerOpen, setTrainerOpen] = React.useState(false);
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [staffOpen, setStaffOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<string | undefined>();
  const [searchOpen, setSearchOpen] = React.useState(false);

  const openAdd = React.useCallback((p?: string) => {
    setPrefill(p);
    setSearchOpen(false);
    setAddOpen(true);
  }, []);
  const openSearch = React.useCallback(() => setSearchOpen(true), []);
  const openTrainer = React.useCallback(() => {
    setChooserOpen(false);
    setTrainerOpen(true);
  }, []);
  const openChooser = React.useCallback(() => setChooserOpen(true), []);
  const openStaff = React.useCallback(() => {
    setChooserOpen(false);
    setStaffOpen(true);
  }, []);

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
    <QuickAddContext.Provider value={{ openAdd, openSearch, openTrainer, openChooser, openStaff, canManageStaff }}>
      {children}
      <Sheet open={trainerOpen} onOpenChange={setTrainerOpen} title="Add a trainer" description="Personal trainers and floor trainers at your gym." size="lg">
        <TrainerForm onDone={() => setTrainerOpen(false)} />
      </Sheet>
      <Sheet open={staffOpen} onOpenChange={setStaffOpen} title="Add a staff member" description="Give a colleague access to the CRM with a role.">
        <StaffForm isOwner={isOwner} onDone={() => setStaffOpen(false)} />
      </Sheet>
      <Sheet open={chooserOpen} onOpenChange={setChooserOpen} title="Add" description="What would you like to add?">
        <div className="grid gap-2">
          {ADD_OPTIONS.filter((o) => !o.admin || canManageStaff).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                setChooserOpen(false);
                if (o.key === "enquiry") openAdd();
                else if (o.key === "trainer") openTrainer();
                else openStaff();
              }}
              className="focus-ring flex items-center gap-3 rounded-2xl bg-white/[0.03] p-4 text-left shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[0.05]"
            >
              <o.icon className="size-5 text-lime" />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={addOpen} onOpenChange={setAddOpen} title="New enquiry" description="Saves the customer, their enquiry and WhatsApp consent together." size="lg">
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

const ADD_OPTIONS = [
  { key: "enquiry", label: "Enquiry", hint: "New customer and their first enquiry", icon: MessageSquarePlus, admin: false },
  { key: "staff", label: "Staff member", hint: "Give a colleague access to the CRM", icon: UserCog, admin: true },
  { key: "trainer", label: "Personal trainer / trainer", hint: "Add a trainer to your gym", icon: Dumbbell, admin: true },
] as const;

/** "Add" menu: enquiry, staff member, trainer. */
export function QuickAddButton({ className }: { className?: string }) {
  const { openAdd, openTrainer, openStaff, canManageStaff } = useQuickAdd();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className={
          className ??
          "focus-ring hidden h-11 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-bg shadow-[var(--shadow-lime)] transition-transform active:scale-[0.97] lg:inline-flex"
        }
      >
        <Plus className="size-4" /> Add <ChevronDown className="size-3.5 opacity-70" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="glass z-50 w-72 p-1.5 data-[state=open]:animate-[menu-in_180ms_var(--ease-out-expo)]">
          {ADD_OPTIONS.filter((o) => !o.admin || canManageStaff).map((o) => (
            <Dropdown.Item
              key={o.key}
              onSelect={() => {
                if (o.key === "enquiry") openAdd();
                else if (o.key === "trainer") openTrainer();
                else openStaff();
              }}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-white/[0.06]"
            >
              <o.icon className="size-4 text-lime" />
              <span>
                <span className="block font-medium text-fg">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Floating quick-add for phones, above the bottom navigation. */
export function QuickAddFab() {
  const { openChooser } = useQuickAdd();
  return (
    <motion.button
      type="button"
      onClick={() => openChooser()}
      whileTap={{ scale: 0.92 }}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.2 }}
      className="focus-ring fixed bottom-[calc(max(env(safe-area-inset-bottom),12px)+92px)] right-4 z-40 grid size-14 place-items-center rounded-2xl bg-lime text-bg shadow-[0_0_0_1px_rgb(198_255_69/0.4),0_12px_30px_-6px_rgb(198_255_69/0.55)] lg:hidden"
      aria-label="Add enquiry, staff member or trainer"
    >
      <Plus className="size-6" strokeWidth={2.5} />
    </motion.button>
  );
}
