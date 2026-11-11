import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./input";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  "inner-shadow w-full rounded-xl bg-bg/70 px-4 text-[15px] text-fg placeholder:text-subtle outline-none transition-shadow duration-200 " +
  "focus:shadow-[inset_0_2px_6px_rgb(0_0_0/0.45),0_0_0_1px_rgb(198_255_69/0.55),0_0_0_4px_rgb(198_255_69/0.12)] " +
  "aria-[invalid=true]:shadow-[inset_0_0_0_1px_rgb(255_92_122/0.6)] disabled:opacity-50";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-12 appearance-none pr-10 [&>option]:bg-surface", className)} {...props}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted">
        <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ),
);
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, "min-h-24 py-3 leading-relaxed", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export function Checkbox({
  label,
  description,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.025] p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <input
        type="checkbox"
        className="peer mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-md bg-bg shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.2)] transition checked:bg-lime checked:shadow-none focus-visible:outline-2 focus-visible:outline-lime"
        {...props}
      />
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none -ml-8 mt-0.5 size-5 text-bg opacity-0 peer-checked:opacity-100">
        <path d="M5 10.5l3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="ml-0 min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}
