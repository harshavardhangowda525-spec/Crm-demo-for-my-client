import { formatInTimeZone } from "date-fns-tz";
import { LogoMark } from "@/components/brand/logo";
import { ProfileMenu } from "./profile-menu";

export const BUSINESS_TZ = "Asia/Kolkata";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Header({
  fullName,
  email,
  role,
  gymName,
}: {
  fullName: string;
  email: string | null;
  role: string;
  gymName: string;
}) {
  const now = new Date();
  const hour = Number(formatInTimeZone(now, BUSINESS_TZ, "H"));
  const firstName = fullName.split(" ")[0];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 md:h-20 md:px-8">
        <LogoMark className="size-9 lg:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-fg md:text-base">
            {greeting(hour)}, <span className="text-lime">{firstName}</span>
          </p>
          <p className="truncate text-xs text-muted">
            <span className="lg:hidden">{gymName} · </span>
            {formatInTimeZone(now, BUSINESS_TZ, "EEEE, d MMMM yyyy")}
          </p>
        </div>
        <ProfileMenu fullName={fullName} email={email} role={role} />
      </div>
    </header>
  );
}
