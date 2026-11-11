import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/signing";
import { dispatchDueMessages } from "@/lib/whatsapp/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called every 5 minutes by pg_cron (pg_net) with the shared secret. */
export async function POST(req: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await dispatchDueMessages({ limit: 50 });
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron/dispatch]", e);
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
