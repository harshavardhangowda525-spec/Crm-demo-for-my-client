"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "focus-ring relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-white/10 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-colors data-[state=checked]:bg-lime disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-1 rounded-full bg-fg shadow transition-transform duration-200 data-[state=checked]:translate-x-6 data-[state=checked]:bg-bg" />
    </SwitchPrimitive.Root>
  );
}
