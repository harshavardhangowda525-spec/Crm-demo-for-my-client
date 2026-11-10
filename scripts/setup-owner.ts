/**
 * One-time bootstrap: creates the gym (if none exists) and its first owner.
 * Public sign-ups are disabled, so this is the only way the first account is
 * created. Later staff are added by the owner from Settings → Staff.
 *
 *   npm run setup:owner -- --email owner@musclehouse.in --name "Owner Name"
 *
 * The password is read from OWNER_PASSWORD or generated and printed once.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    gym: { type: "string", default: "Muscle House" },
  },
});

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  if (!values.email || !values.name) throw new Error('Usage: npm run setup:owner -- --email <email> --name "<name>"');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Gym (single-gym deployment: reuse the first non-demo gym)
  let { data: gym } = await db.from("gyms").select("id, name").order("created_at").limit(1).maybeSingle();
  if (!gym) {
    const { data, error } = await db.from("gyms").insert({ name: values.gym }).select("id, name").single();
    if (error) throw error;
    gym = data;
    console.log(`✓ Created gym "${gym.name}"`);
  } else {
    console.log(`• Using existing gym "${gym.name}"`);
  }

  // 2. Auth user
  const password = process.env.OWNER_PASSWORD || randomBytes(12).toString("base64url");
  let userId: string;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: values.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: values.name },
  });
  if (createErr) {
    if (!/already.*registered|exists/i.test(createErr.message)) throw createErr;
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const existing = list.users.find((u) => u.email?.toLowerCase() === values.email!.toLowerCase());
    if (!existing) throw createErr;
    userId = existing.id;
    console.log(`• User ${values.email} already exists — password unchanged`);
  } else {
    userId = created.user.id;
    console.log(`✓ Created user ${values.email}`);
    if (!process.env.OWNER_PASSWORD) console.log(`  Temporary password (shown once): ${password}`);
  }

  await db.from("user_profiles").upsert({ id: userId, full_name: values.name });

  // 3. Owner role
  const { error: staffErr } = await db
    .from("gym_staff")
    .upsert({ gym_id: gym.id, user_id: userId, role: "owner", active: true }, { onConflict: "gym_id,user_id" });
  if (staffErr) throw staffErr;
  console.log(`✓ ${values.email} is an owner of "${gym.name}"`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
