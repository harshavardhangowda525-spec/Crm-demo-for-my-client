-- Muscle House Gym OS — core schema
-- Money is stored as integer paise (bigint) to avoid floating point errors.
-- Dates that are "business days" (membership start/end, enquiry dates) are
-- plain `date` values interpreted in the gym's timezone (default Asia/Kolkata).

create extension if not exists pg_trgm;
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Gyms & people
-- ---------------------------------------------------------------------------
create table public.gyms (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) between 1 and 120),
  legal_name         text,
  logo_path          text,
  address_line1      text,
  address_line2      text,
  city               text,
  state              text,
  state_code         text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  postal_code        text,
  phone_e164         text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email              text,
  gstin              text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  gst_enabled        boolean not null default true,
  default_gst_rate   numeric(5,2) not null default 18.00 check (default_gst_rate between 0 and 40),
  sac_code           text not null default '999723',
  invoice_prefix     text not null default 'MH' check (invoice_prefix ~ '^[A-Z0-9-]{1,10}$'),
  currency           text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  timezone           text not null default 'Asia/Kolkata',
  pause_max_days     int  not null default 7 check (pause_max_days between 0 and 60),
  reminder_offsets   int[] not null default '{7,3,1,0}',
  whatsapp_provider  text not null default 'mock' check (whatsapp_provider in ('mock','meta_cloud')),
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger gyms_updated_at before update on public.gyms
  for each row execute function public.set_updated_at();

create table public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone_e164  text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  avatar_path text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger user_profiles_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

create table public.gym_staff (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','staff')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (gym_id, user_id)
);
create index gym_staff_user_idx on public.gym_staff(user_id) where active;
create trigger gym_staff_updated_at before update on public.gym_staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  full_name          text not null check (length(trim(full_name)) between 1 and 120),
  phone_e164         text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  date_of_birth      date check (date_of_birth is null or date_of_birth > '1900-01-01'),
  gender             text check (gender is null or gender in ('male','female','other','prefer_not_to_say')),
  notes              text,
  assigned_staff_id  uuid references public.gym_staff(id) on delete set null,
  is_demo            boolean not null default false,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (gym_id, phone_e164)
);
-- prefix search on phone ("+9198..." typed progressively)
create index customers_phone_prefix_idx on public.customers (gym_id, phone_e164 text_pattern_ops);
create index customers_name_trgm_idx on public.customers using gin (full_name gin_trgm_ops);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.membership_plans (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 80),
  duration_value       int  not null check (duration_value between 1 and 1000),
  duration_unit        text not null check (duration_unit in ('day','month')),
  base_price_paise     bigint not null check (base_price_paise >= 0),
  gst_rate             numeric(5,2) check (gst_rate is null or gst_rate between 0 and 40), -- null = gym default
  description          text,
  pause_allowance_days int  not null default 7 check (pause_allowance_days between 0 and 60),
  active               boolean not null default true,
  sort_order           int not null default 0,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (gym_id, name)
);
create trigger membership_plans_updated_at before update on public.membership_plans
  for each row execute function public.set_updated_at();

-- Enquiry lifecycle is deliberately separate from membership status.
create table public.enquiries (
  id                      uuid primary key default gen_random_uuid(),
  gym_id                  uuid not null references public.gyms(id) on delete cascade,
  customer_id             uuid not null references public.customers(id) on delete cascade,
  interested_plan_id      uuid references public.membership_plans(id) on delete set null,
  source                  text not null default 'walk_in'
                          check (source in ('walk_in','phone','instagram','facebook','website','referral','google','other')),
  enquiry_date            date not null default (now() at time zone 'Asia/Kolkata')::date,
  status                  text not null default 'new'
                          check (status in ('new','follow_up_pending','interested','converted','not_interested')),
  follow_up_date          date,
  assigned_staff_id       uuid references public.gym_staff(id) on delete set null,
  converted_membership_id uuid,
  is_demo                 boolean not null default false,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index enquiries_customer_idx on public.enquiries (customer_id, enquiry_date desc);
create index enquiries_followup_idx on public.enquiries (gym_id, follow_up_date)
  where status in ('new','follow_up_pending','interested');
create trigger enquiries_updated_at before update on public.enquiries
  for each row execute function public.set_updated_at();

create table public.enquiry_notes (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  enquiry_id  uuid references public.enquiries(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        text not null default 'note'
              check (kind in ('note','follow_up_call','follow_up_whatsapp','visit')),
  outcome     text check (outcome is null or outcome in ('reached','no_answer','call_back','interested','not_interested')),
  body        text not null check (length(trim(body)) between 1 and 4000),
  author_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index enquiry_notes_customer_idx on public.enquiry_notes (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Memberships & pauses
-- ---------------------------------------------------------------------------
create table public.memberships (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  customer_id          uuid not null references public.customers(id) on delete restrict,
  plan_id              uuid references public.membership_plans(id) on delete set null,
  -- snapshot of the plan at purchase time
  plan_name            text not null,
  duration_value       int  not null check (duration_value > 0),
  duration_unit        text not null check (duration_unit in ('day','month')),
  start_date           date not null,
  original_end_date    date not null,
  end_date             date not null,
  status               text not null default 'pending'
                       check (status in ('pending','active','paused','expired','cancelled')),
  pause_allowance_days int  not null check (pause_allowance_days >= 0),
  pause_days_used      int  not null default 0,
  price_paise          bigint not null check (price_paise >= 0),
  discount_paise       bigint not null default 0 check (discount_paise >= 0),
  idempotency_key      uuid not null unique,
  renewed_from_id      uuid references public.memberships(id) on delete set null,
  cancelled_at         timestamptz,
  cancel_reason        text,
  is_demo              boolean not null default false,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (original_end_date >= start_date),
  check (end_date >= original_end_date),
  check (pause_days_used between 0 and pause_allowance_days),
  check (discount_paise <= price_paise)
);
create index memberships_customer_idx on public.memberships (customer_id, start_date desc);
create index memberships_expiry_idx on public.memberships (gym_id, end_date)
  where status in ('active','paused');
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

alter table public.enquiries
  add constraint enquiries_converted_membership_fk
  foreign key (converted_membership_id) references public.memberships(id) on delete set null;

create table public.membership_pauses (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  membership_id     uuid not null references public.memberships(id) on delete cascade,
  start_date        date not null,
  end_date          date not null,
  days              int generated always as (end_date - start_date + 1) stored,
  status            text not null default 'approved' check (status in ('approved','cancelled')),
  requested_via     text not null check (requested_via in ('staff','member_portal')),
  requested_by      uuid references auth.users(id) on delete set null,
  reason            text,
  previous_end_date date not null,
  new_end_date      date not null,
  idempotency_key   uuid not null unique,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (end_date >= start_date),
  -- approved pauses of the same membership can never overlap
  constraint membership_pauses_no_overlap exclude using gist (
    membership_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status = 'approved')
);
create index membership_pauses_membership_idx on public.membership_pauses (membership_id, start_date);

-- ---------------------------------------------------------------------------
-- Invoicing & payments
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  financial_year  text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_value      int  not null default 0 check (last_value >= 0),
  primary key (gym_id, financial_year)
);

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  membership_id       uuid references public.memberships(id) on delete set null,
  invoice_number      text not null,
  financial_year      text not null,
  sequence_no         int  not null check (sequence_no > 0),
  issue_date          date not null,
  status              text not null default 'issued' check (status in ('issued','cancelled')),
  payment_status      text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  subtotal_paise      bigint not null check (subtotal_paise >= 0),
  discount_paise      bigint not null default 0 check (discount_paise >= 0),
  taxable_paise       bigint not null check (taxable_paise >= 0),
  gst_rate            numeric(5,2) not null default 0,
  cgst_paise          bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise          bigint not null default 0 check (sgst_paise >= 0),
  igst_paise          bigint not null default 0 check (igst_paise >= 0),
  total_paise         bigint not null check (total_paise >= 0),
  amount_paid_paise   bigint not null default 0 check (amount_paid_paise >= 0),
  customer_snapshot   jsonb not null,
  gym_snapshot        jsonb not null,
  pdf_path            text,
  notes               text,
  replaces_invoice_id uuid references public.invoices(id) on delete set null,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  idempotency_key     uuid not null unique,
  is_demo             boolean not null default false,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (gym_id, invoice_number),
  unique (gym_id, financial_year, sequence_no),
  check (taxable_paise = subtotal_paise - discount_paise),
  check (total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise),
  check (amount_paid_paise <= total_paise),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index invoices_customer_idx on public.invoices (customer_id, issue_date desc);
create index invoices_gym_date_idx on public.invoices (gym_id, issue_date desc);
create index invoices_outstanding_idx on public.invoices (gym_id) where status = 'issued' and payment_status <> 'paid';
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  description      text not null,
  sac_code         text,
  quantity         int not null default 1 check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  amount_paise     bigint not null check (amount_paise >= 0),
  check (amount_paise = unit_price_paise * quantity)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete restrict,
  customer_id     uuid not null references public.customers(id) on delete restrict,
  amount_paise    bigint not null check (amount_paise > 0),
  method          text not null check (method in ('cash','upi','card','bank_transfer','other')),
  reference       text,
  paid_at         timestamptz not null default now(),
  idempotency_key uuid not null unique,
  is_demo         boolean not null default false,
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index payments_gym_paid_at_idx on public.payments (gym_id, paid_at);
create index payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- Automation & messaging
-- ---------------------------------------------------------------------------
create table public.automation_rules (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  key           text not null check (key in (
                  'enquiry_follow_up','membership_confirmation','invoice_delivery',
                  'expiry_reminder','pause_confirmation','renewal_follow_up')),
  enabled       boolean not null default true,
  template_name text not null,
  config        jsonb not null default '{}'::jsonb,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (gym_id, key)
);
create trigger automation_rules_updated_at before update on public.automation_rules
  for each row execute function public.set_updated_at();

create table public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  customer_id         uuid references public.customers(id) on delete set null,
  to_phone_e164       text not null check (to_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  purpose             text not null,
  template_name       text not null,
  template_language   text not null default 'en',
  template_params     jsonb not null default '[]'::jsonb,
  document_path       text,
  related_entity_type text,
  related_entity_id   uuid,
  provider            text not null,
  simulated           boolean not null default false,
  provider_message_id text,
  status              text not null default 'queued'
                      check (status in ('queued','sending','sent','delivered','read','failed','cancelled')),
  attempts            int not null default 0,
  max_attempts        int not null default 3,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  dedupe_key          text not null,
  is_demo             boolean not null default false,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  unique (gym_id, dedupe_key)
);
create unique index whatsapp_messages_provider_id_idx on public.whatsapp_messages (provider, provider_message_id)
  where provider_message_id is not null;
create index whatsapp_messages_queue_idx on public.whatsapp_messages (next_attempt_at) where status = 'queued';
create index whatsapp_messages_customer_idx on public.whatsapp_messages (customer_id, created_at desc);
create trigger whatsapp_messages_updated_at before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

create table public.automation_executions (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  rule_key      text not null,
  dedupe_key    text not null,
  status        text not null check (status in ('queued','success','failed','skipped')),
  customer_id   uuid references public.customers(id) on delete set null,
  membership_id uuid references public.memberships(id) on delete set null,
  message_id    uuid references public.whatsapp_messages(id) on delete set null,
  detail        text,
  is_demo       boolean not null default false,
  executed_at   timestamptz not null default now(),
  unique (gym_id, dedupe_key)
);
create index automation_executions_rule_idx on public.automation_executions (gym_id, rule_key, executed_at desc);

create table public.notification_preferences (
  customer_id    uuid primary key references public.customers(id) on delete cascade,
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  whatsapp_opt_in boolean not null default false,
  opt_in_source  text,
  opted_in_at    timestamptz,
  opted_out_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Timeline, audit, portal, rate limiting
-- ---------------------------------------------------------------------------
create table public.activity_events (
  id            bigint generated always as identity primary key,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  type          text not null check (type in (
                  'enquiry_created','enquiry_updated','note_added','follow_up','status_changed',
                  'membership_created','membership_activated','membership_cancelled','membership_expired',
                  'payment_recorded','invoice_issued','invoice_cancelled','whatsapp_message',
                  'pause_approved','pause_cancelled','renewal','customer_created','customer_updated')),
  title         text not null,
  details       jsonb not null default '{}'::jsonb,
  entity_type   text,
  entity_id     uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type    text not null default 'staff' check (actor_type in ('staff','member','system')),
  is_demo       boolean not null default false,
  occurred_at   timestamptz not null default now()
);
create index activity_events_customer_idx on public.activity_events (customer_id, occurred_at desc);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  gym_id        uuid references public.gyms(id) on delete cascade,
  actor_user_id uuid,
  actor_type    text not null default 'staff' check (actor_type in ('staff','member','system')),
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_gym_idx on public.audit_logs (gym_id, created_at desc);

-- Member portal: single-use magic links + WhatsApp OTP + short sessions.
-- Only hashes are stored. Accessed exclusively by the server (service role).
create table public.member_portal_tokens (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.member_portal_otps (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_id    uuid references public.member_portal_tokens(id) on delete cascade,
  code_hash   text not null,
  attempts    int not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index member_portal_otps_customer_idx on public.member_portal_otps (customer_id, created_at desc);

create table public.member_sessions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  session_hash text not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);
