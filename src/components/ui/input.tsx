import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "inner-shadow h-12 w-full rounded-xl bg-bg/70 px-4 text-[15px] text-fg placeholder:text-subtle",
        "transition-shadow duration-200 outline-none",
        "focus:shadow-[inset_0_2px_6px_rgb(0_0_0/0.45),0_0_0_1px_rgb(198_255_69/0.55),0_0_0_4px_rgb(198_255_69/0.12)]",
        "aria-[invalid=true]:shadow-[inset_0_0_0_1px_rgb(255_92_122/0.6)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium tracking-wide text-muted", className)} {...props} />;
}
