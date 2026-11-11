"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Responsive modal: a draggable bottom sheet on phones, a centred glass dialog
 * on larger screens. Content scrolls; the header stays put.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const reduce = useReducedMotion();
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const width = size === "sm" ? "md:max-w-md" : size === "lg" ? "md:max-w-3xl" : "md:max-w-xl";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                className={cn(
                  "fixed z-50 flex max-h-[92dvh] w-full flex-col bg-[#121925] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(255_255_255/0.06),0_30px_80px_-20px_rgb(0_0_0/0.8)]",
                  "inset-x-0 bottom-0 rounded-t-[26px] md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:rounded-[22px]",
                  width,
                )}
                initial={reduce ? { opacity: 0 } : isDesktop ? { opacity: 0, scale: 0.97, x: "-50%", y: "-48%" } : { y: "100%" }}
                animate={isDesktop ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" } : { y: 0, opacity: 1 }}
                exit={reduce ? { opacity: 0 } : isDesktop ? { opacity: 0, scale: 0.97, x: "-50%", y: "-48%" } : { y: "100%" }}
                transition={{ type: "spring", stiffness: 440, damping: 40 }}
                drag={isDesktop ? false : "y"}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.5 }}
                dragListener={false}
                dragControls={undefined}
              >
                <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden" aria-hidden />
                <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4 md:px-6 md:pt-6">
                  <div className="min-w-0">
                    <Dialog.Title className="font-display text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                    {description && <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>}
                  </div>
                  <Dialog.Close className="focus-ring -mr-2 grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg">
                    <X className="size-5" />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </div>
                <div className="divider-metal mx-5 shrink-0 md:mx-6" />
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 md:px-6">{children}</div>
                {footer && (
                  <div className="shrink-0 border-t border-line px-5 py-4 pb-[max(env(safe-area-inset-bottom),16px)] md:px-6">
                    {footer}
                  </div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
