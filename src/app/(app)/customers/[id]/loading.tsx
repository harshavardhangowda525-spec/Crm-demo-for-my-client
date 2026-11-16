import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Opening customer profile">
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin text-lime" /> Opening customer profile…
      </p>
      <Skeleton className="h-44" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
