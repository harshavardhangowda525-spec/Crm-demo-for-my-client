import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-14 rounded-2xl [&_svg]:size-7" />
          <h1 className="mt-5 font-display text-[28px] font-semibold tracking-tight">Muscle House</h1>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">Gym OS</p>
        </div>
        <div className="glass p-6 md:p-7">
          <h2 className="text-lg font-semibold">Staff sign in</h2>
          <p className="mt-1 text-sm text-muted">Use the account your gym owner created for you.</p>
          <div className="divider-metal my-5" />
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-center text-xs text-subtle">
          Members: open the secure link sent to you on WhatsApp.
        </p>
      </div>
    </main>
  );
}
