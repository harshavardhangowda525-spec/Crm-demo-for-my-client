-- Hardening from Supabase security advisor.
-- 1. Pin search_path on trigger functions.
alter function public.set_updated_at() set search_path = '';
alter function private.forbid_gym_change() set search_path = '';
alter function private.guard_invoice_update() set search_path = '';
alter function private.forbid_delete() set search_path = '';

-- 2. Keep extensions out of the exposed public schema.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension pg_trgm set schema extensions;
alter extension btree_gist set schema extensions;
