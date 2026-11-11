import "server-only";
import { z } from "zod";
import { AuthorizationError } from "./auth";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function zodFail(err: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".");
    fieldErrors[k] ??= issue.message;
  }
  return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please check the form.", fieldErrors };
}

type PgError = { message?: string; code?: string; details?: string; hint?: string };

/**
 * Turns database errors into messages staff can act on. Business-rule errors
 * raised by our SQL functions are already written for people; low-level
 * errors are replaced with a safe generic message.
 */
export function dbError(error: PgError | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const msg = error.message ?? "";
  switch (error.code) {
    case "P0001": // raise exception in our functions
      return msg.charAt(0).toUpperCase() + msg.slice(1);
    case "42501":
      return /only an owner|owner or admin|discount/i.test(msg) ? capital(msg) : "You do not have permission to do that.";
    case "P0002":
      return capital(msg || "Not found.");
    case "23505":
      return /phone/i.test(msg + (error.details ?? "")) ? "A customer with this mobile number already exists." : "This already exists.";
    case "23P01":
      return "This overlaps an existing pause.";
    case "23514":
      return "Some values are not allowed. Please check the form.";
    case "54000":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "22023":
      return capital(msg);
  }
  return fallback;
}

function capital(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Wraps a server action so authorization errors and crashes become results. */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthorizationError) return fail(e.message);
    // re-throw Next.js redirects / notFound
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_")) throw e;
    console.error("[action]", e);
    return fail("Something went wrong. Please try again.");
  }
}
