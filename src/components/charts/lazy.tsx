"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Recharts is loaded only when a chart is on screen. */
export const LazyRevenueChart = dynamic(() => import("./revenue-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full md:h-72" />,
});
