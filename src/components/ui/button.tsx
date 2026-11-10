"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium " +
    "transition-[transform,background-color,box-shadow,color] duration-200 ease-[var(--ease-out-expo)] " +
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-lime text-bg shadow-[var(--shadow-lime)] hover:bg-[#d4ff6e] hover:shadow-[0_0_0_1px_rgb(198_255_69/0.5),0_10px_34px_-8px_rgb(198_255_69/0.6)]",
        secondary:
          "bg-elevated text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.07),inset_0_0_0_1px_rgb(255_255_255/0.06)] hover:bg-[#202a3c]",
        ghost: "text-muted hover:bg-white/5 hover:text-fg",
        outline: "text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04]",
        danger: "bg-danger/15 text-danger shadow-[inset_0_0_0_1px_rgb(255_92_122/0.3)] hover:bg-danger/25",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
export { buttonVariants };
