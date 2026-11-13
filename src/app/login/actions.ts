"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
  next: z.string().optional(),
});

export type SignInState = { error?: string; fieldErrors?: Partial<Record<"email" | "password", string>> };

/** Only allow same-origin relative redirects to avoid open-redirect abuse. */
function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/today";
  return next;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const fe: SignInState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as "email" | "password";
      fe[k] ??= issue.message;
    }
    return { fieldErrors: fe };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Generic message: don't reveal whether the account exists.
    return {
      error:
        error.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "Incorrect email or password.",
    };
  }
  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
