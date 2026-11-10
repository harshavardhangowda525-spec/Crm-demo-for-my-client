"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, X } from "lucide-react";
import { can, type StaffRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

export function BottomNav({ role }: { role: StaffRole }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const items = NAV_ITEMS.filter((i) => !i.permission || can(role, i.permission));
  const primary = items.filter((i) => i.primaryMobile);
  const secondary = items.filter((i) => !i.primaryMobile);
  const moreActive = secondary.some((i) => isActive(pathname, i.href));

  // close the sheet after navigating
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-between rounded-[22px] bg-[#141b27] p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(255_255_255/0.06),0_-10px_30px_-8px_rgb(0_0_0/0.8)]">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="focus-ring relative flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl"
              >
                {active && (
                  <motion.span
                    layoutId="bottom-active"
                    className="absolute inset-0 rounded-2xl bg-lime/[0.12] shadow-[inset_0_0_0_1px_rgb(198_255_69/0.2)]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <Icon className={cn("relative size-5", active ? "text-lime" : "text-muted")} />
                <span className={cn("relative text-[10.5px] font-medium", active ? "text-fg" : "text-muted")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="focus-ring relative flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl"
          >
            {moreActive && (
              <motion.span
                layoutId="bottom-active"
                className="absolute inset-0 rounded-2xl bg-lime/[0.12] shadow-[inset_0_0_0_1px_rgb(198_255_69/0.2)]"
              />
            )}
            <LayoutGrid className={cn("relative size-5", moreActive ? "text-lime" : "text-muted")} />
            <span className={cn("relative text-[10.5px] font-medium", moreActive ? "text-fg" : "text-muted")}>More</span>
          </button>
        </div>
      </nav>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="glass fixed inset-x-0 bottom-0 z-50 rounded-b-none rounded-t-[28px] p-4 pb-[max(env(safe-area-inset-bottom),20px)] lg:hidden"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.6 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 80 || info.velocity.y > 500) setOpen(false);
                  }}
                >
                  <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" aria-hidden />
                  <div className="mb-3 flex items-center justify-between px-1">
                    <Dialog.Title className="font-display text-lg font-semibold">More</Dialog.Title>
                    <Dialog.Close className="focus-ring grid size-10 place-items-center rounded-xl text-muted hover:bg-white/5">
                      <X className="size-5" />
                      <span className="sr-only">Close</span>
                    </Dialog.Close>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {secondary.map((item) => {
                      const active = isActive(pathname, item.href);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "focus-ring flex h-20 flex-col justify-between rounded-2xl bg-white/[0.03] p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]",
                            active && "bg-lime/[0.08] shadow-[inset_0_0_0_1px_rgb(198_255_69/0.25)]",
                          )}
                        >
                          <Icon className={cn("size-5", active ? "text-lime" : "text-cyan")} />
                          <span className="text-sm font-medium">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  );
}
