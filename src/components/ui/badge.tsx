import { cn } from "@/lib/utils";

const tones = {
  lime: "bg-lime/12 text-lime shadow-[inset_0_0_0_1px_rgb(198_255_69/0.25)]",
  cyan: "bg-cyan/12 text-cyan shadow-[inset_0_0_0_1px_rgb(88_217_255/0.25)]",
  amber: "bg-warning/12 text-warning shadow-[inset_0_0_0_1px_rgb(255_181_71/0.25)]",
  red: "bg-danger/12 text-danger shadow-[inset_0_0_0_1px_rgb(255_92_122/0.25)]",
  green: "bg-success/12 text-success shadow-[inset_0_0_0_1px_rgb(62_230_160/0.25)]",
  violet: "bg-[#a78bfa]/12 text-[#c4b5fd] shadow-[inset_0_0_0_1px_rgb(167_139_250/0.25)]",
  neutral: "bg-white/[0.05] text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const LIFECYCLE_TONE: Record<string, Tone> = {
  new: "cyan",
  follow_up_pending: "amber",
  interested: "violet",
  converted: "green",
  not_interested: "neutral",
  active_member: "lime",
  expired_member: "red",
  no_enquiry: "neutral",
};
export const MEMBERSHIP_TONE: Record<string, Tone> = {
  pending: "amber",
  active: "lime",
  paused: "cyan",
  expired: "red",
  cancelled: "neutral",
};
export const PAYMENT_TONE: Record<string, Tone> = { paid: "green", partial: "amber", unpaid: "red" };
export const MESSAGE_TONE: Record<string, Tone> = {
  queued: "neutral",
  sending: "cyan",
  sent: "cyan",
  delivered: "green",
  read: "green",
  failed: "red",
  cancelled: "neutral",
  simulated: "violet",
};
