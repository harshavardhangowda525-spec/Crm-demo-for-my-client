# Muscle House Gym OS — implementation checklist

Legend: ✅ done & tested · 🟡 in progress · ⬜ not started · 🔒 blocked (external)

## Phase 1 — Foundation
- ✅ Next.js 15 App Router + TypeScript + Tailwind v4 project
- ✅ Design system: tokens, glass panels, grain, ambient light, metal dividers, focus rings, reduced motion
- ✅ Fonts: Geist (UI) + Space Grotesk (metrics), self-hosted
- ✅ Database schema — all 16 required tables + counters, timeline, portal, rate limits (`supabase/migrations`)
- ✅ Row Level Security on every table; financial tables write-only via server functions
- ✅ Integrity: E.164 phones, unique phone per gym, no overlapping pauses, pause cap, immutable invoices, no deletes of invoices/payments, last-owner guard, cross-gym reference guard
- ✅ Audit log triggers + customer timeline triggers
- ✅ Private storage buckets (invoices, branding)
- ✅ Staff authentication (email + password), session middleware, route protection, safe redirects
- ✅ Role permissions (owner / admin / staff) in app + DB
- ✅ App shell: collapsible desktop sidebar, mobile bottom nav + "More" bottom sheet, header, page transitions, skeletons, error state
- ✅ Owner bootstrap script (`npm run setup:owner`)
- ✅ Tests: 19 DB security tests, 21 unit tests (phone normalisation, permissions)
- ✅ Hardening migration: pinned function search_path, extensions moved out of public
- ✅ Supabase project "Muscle House Gym OS" (ap-south-1 Mumbai) created; 3 migrations applied and checksum-verified; security advisor clean except intentional notices
- ⬜ Create owner account (needs owner email) & disable public sign-ups in dashboard

## Phase 2 — CRM
- ⬜ Customer creation with duplicate detection
- ⬜ Instant phone search (debounced, prefix index)
- ⬜ Enquiry tracking & status management
- ⬜ Staff notes / follow-ups
- ⬜ Customer timeline UI

## Phase 3 — Memberships
- ⬜ Plan management (Settings)
- ⬜ Activation RPC (idempotent, expiry calc, month-end & leap-year safe)
- ⬜ Pause RPC (7-day allowance, transaction-safe) + pause UI
- ⬜ Member portal: signed WhatsApp link + WhatsApp OTP

## Phase 4 — Invoicing
- ⬜ Invoice builder + configurable GST (CGST/SGST or IGST)
- ⬜ Sequential numbering per financial year
- ⬜ PDF generation + private storage
- ⬜ Payments, cancellation & correction

## Phase 5 — Automation
- ⬜ WhatsApp provider adapter (Meta Cloud API + clearly-marked mock)
- ⬜ Message queue, retries, delivery webhooks (signature-verified)
- ⬜ Follow-up, confirmation, invoice, expiry, pause, renewal automations
- ⬜ Automation Center UI

## Phase 6 — Polish
- ⬜ Command-center dashboard & analytics
- ⬜ Demo seed (100 customers etc., `is_demo` flagged, purgeable)
- ⬜ E2E demo workflow test, mobile checks
- ⬜ Deployment + admin guide
