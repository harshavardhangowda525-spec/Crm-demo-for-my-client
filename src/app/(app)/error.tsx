"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="glass mx-auto mt-10 max-w-lg p-7 text-center">
      <AlertTriangle className="mx-auto size-9 text-warning" />
      <h2 className="mt-4 font-display text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted">
        The page couldn&apos;t load. Your data is safe — try again, and if it keeps happening share this reference
        with support: <span className="font-mono text-fg">{error.digest ?? "n/a"}</span>
      </p>
      <Button onClick={reset} variant="secondary" className="mt-6">
        Try again
      </Button>
    </div>
  );
}
