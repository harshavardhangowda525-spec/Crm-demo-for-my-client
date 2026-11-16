"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, guard, ok, zodFail, type ActionResult } from "@/lib/actions";
import { phoneSchema } from "@/lib/validation";

const trainerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the trainer's name").max(120),
  phone: z.union([phoneSchema, z.literal("")]).transform((v) => (v ? v : null)),
  gender: z.enum(["male", "female", "other"], { error: "Choose male, female or other" }),
  kind: z.enum(["personal_trainer", "trainer"]),
  specialization: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  experienceYears: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(0, "Experience can't be negative").max(60).optional(),
  ),
});

export async function addTrainer(input: unknown): Promise<ActionResult<{ trainerId: string }>> {
  return guard(async () => {
    await authorize("staff.manage");
    const v = trainerSchema.safeParse(input);
    if (!v.success) return zodFail(v.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_trainer", {
      p_full_name: v.data.fullName,
      p_phone_e164: v.data.phone,
      p_gender: v.data.gender,
      p_kind: v.data.kind,
      p_specialization: v.data.specialization,
      p_experience_years: v.data.experienceYears ?? null,
    });
    if (error) return fail(dbError(error));
    revalidatePath("/settings");
    return ok({ trainerId: data as string });
  });
}

export async function setTrainerActive(trainerId: string, active: boolean): Promise<ActionResult<null>> {
  return guard(async () => {
    await authorize("staff.manage");
    if (!z.uuid().safeParse(trainerId).success) return fail("Invalid trainer");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_trainer_active", { p_trainer_id: trainerId, p_active: active });
    if (error) return fail(dbError(error));
    revalidatePath("/settings");
    return ok(null);
  });
}
