# Muscle House Gym OS

Mobile-first CRM, membership and WhatsApp-automation platform for Muscle House gym.
Built by Infinity Web & Apps.

**Status:** Phases 1–6 plus the Member Memory & Owner Reminders upgrade — see [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

- Daily use: [`docs/OWNER_GUIDE.md`](docs/OWNER_GUIDE.md)
- WhatsApp templates for Meta approval: [`docs/WHATSAPP_TEMPLATES.md`](docs/WHATSAPP_TEMPLATES.md)

## Stack
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Radix primitives · Motion · Lucide · Recharts
Supabase (Postgres, Auth, RLS, Storage) · Vercel (hosting + cron)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + keys
```

1. **Apply database migrations** in order from `supabase/migrations/` (Supabase SQL editor or `supabase db push`).
2. **Disable public sign-ups** in Supabase → Authentication → Providers → Email ("Allow new users to sign up" off).
3. **Create the owner account:**
   ```bash
   npm run setup:owner -- --email owner@example.com --name "Owner Name"
   ```
   A temporary password is printed once (or set `OWNER_PASSWORD`).
4. `npm run dev` → http://localhost:3000

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Applies migrations to a throwaway local Postgres and runs SQL security tests (`PG_HOST`, `PG_PORT`) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run setup:owner` | Bootstrap gym + first owner |

## Security model (summary)
- Staff sign in with Supabase Auth; their gym and role are resolved from `gym_staff` on the server — client-supplied gym IDs are never trusted.
- Every table has Row Level Security. Memberships, pauses, invoices, payments and messages have **no client write policies**; they change only through validated server functions.
- Issued invoices are immutable (cancel + re-issue); invoices and payments cannot be deleted; every sensitive change is written to `audit_logs`.
- The service-role key is only importable from server code (`server-only`).
- Members never get a database session: the portal is served by the server after a signed WhatsApp link + WhatsApp OTP check.

## External services that need credentials
| Service | Needed for | Without it |
|---|---|---|
| Supabase project | Everything | — |
| Meta WhatsApp Business Platform (phone number ID, access token, app secret, approved templates) | Real WhatsApp messages & portal OTP | Mock provider; messages clearly marked **SIMULATED** |
| Render | Hosting (free plan sleeps after 15 min idle) | Run locally |
| Anthropic API key (`ANTHROPIC_API_KEY`) | Optional "Summarise this customer" | Button hidden; everything else works |

GST: rate and registration details are configured per gym in Settings. The 18% default is illustrative — confirm the applicable treatment with the gym's accountant.
