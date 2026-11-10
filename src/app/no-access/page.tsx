import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-4">
      <div className="glass w-full max-w-md p-7 text-center">
        <ShieldAlert className="mx-auto size-10 text-warning" />
        <h1 className="mt-4 font-display text-xl font-semibold">No gym access yet</h1>
        <p className="mt-2 text-sm text-muted">
          You&apos;re signed in, but this account isn&apos;t an active staff member of any gym. Ask the gym owner
          to add you from Settings → Staff.
        </p>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
