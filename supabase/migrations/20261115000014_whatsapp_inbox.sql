-- WhatsApp inbox and menu-bot auto-replies (no AI, no extra API keys).
--
-- Members can message the gym's WhatsApp number. Incoming messages arrive via
-- the Meta webhook (secret-checked RPCs, like the dispatcher), are stored in
-- whatsapp_inbox, and — when the gym turns it on — answered by a menu bot
-- that only uses this gym's info and the sender's own membership.
-- Staff read and reply from the CRM inbox.

alter table public.gyms
  add column if not exists auto_reply_enabled boolean not null default false,
  add column if not exists auto_reply_info text check (auto_reply_info is null or length(auto_reply_info) <= 4000),
  add column if not exists whatsapp_phone_number_id text;

create table public.whatsapp_inbox (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  customer_id        uuid references public.customers(id) on delete set null,
  contact_phone_e164 text not null check (contact_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  contact_name       text,
  direction          text not null check (direction in ('in','out')),
  author             text not null check (author in ('member','bot','staff')),
  body               text not null check (length(body) between 1 and 4096),
  wa_message_id      text,
  status             text not null default 'received' check (status in ('received','sent','failed')),
  error              text,
  needs_staff        boolean not null default false,
  staff_user_id      uuid references auth.users(id) on delete set null,
  read_at            timestamptz,
  is_demo            boolean not null default false,
  -- clock time (not transaction time) so messages stored together keep their order
  created_at         timestamptz not null default clock_timestamp()
);
create unique index whatsapp_inbox_wamid_uq on public.whatsapp_inbox (gym_id, wa_message_id) where wa_message_id is not null;
create index whatsapp_inbox_thread_idx on public.whatsapp_inbox (gym_id, contact_phone_e164, created_at desc);
create index whatsapp_inbox_customer_idx on public.whatsapp_inbox (customer_id) where customer_id is not null;

alter table public.whatsapp_inbox enable row level security;
alter table public.whatsapp_inbox force row level security;
revoke all on public.whatsapp_inbox from anon;
create policy whatsapp_inbox_select on public.whatsapp_inbox for select to authenticated
  using (private.is_staff(gym_id));
create trigger whatsapp_inbox_no_gym_change before update on public.whatsapp_inbox
  for each row execute function private.forbid_gym_change();

-- ---------------------------------------------------------------------------
-- Webhook side (secret-checked; called by the app with CRON_SECRET)
-- ---------------------------------------------------------------------------

-- Store one incoming message and return everything the reply step needs.
create or replace function public.inbox_receive(
  p_secret text, p_phone_number_id text, p_from text, p_name text,
  p_wa_message_id text, p_body text, p_sent_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym public.gyms%rowtype;
  v_phone text := '+' || regexp_replace(coalesce(p_from, ''), '\D', '', 'g');
  v_id uuid;
  v_customer public.customers%rowtype;
  v_m public.memberships%rowtype;
  v_recent int;
  v_ctx jsonb;
begin
  perform private.require_secret(p_secret);
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' or coalesce(btrim(p_body), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_gym from public.gyms where whatsapp_phone_number_id = p_phone_number_id limit 1;
  if not found then
    -- Single-gym deployments: the one gym using the Cloud API owns the number.
    if (select count(*) from public.gyms where whatsapp_provider = 'meta_cloud') = 1 then
      select * into v_gym from public.gyms where whatsapp_provider = 'meta_cloud';
    else
      return jsonb_build_object('ok', false, 'reason', 'unknown_number');
    end if;
  end if;

  select * into v_customer from public.customers where gym_id = v_gym.id and phone_e164 = v_phone;

  insert into public.whatsapp_inbox (gym_id, customer_id, contact_phone_e164, contact_name, direction, author, body, wa_message_id, status)
  values (v_gym.id, v_customer.id, v_phone, left(nullif(btrim(p_name), ''), 120), 'in', 'member', left(p_body, 4096), p_wa_message_id, 'received')
  on conflict (gym_id, wa_message_id) where wa_message_id is not null do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if v_customer.id is not null then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_type, is_demo)
    values (v_gym.id, v_customer.id, 'whatsapp_message', 'WhatsApp message received',
      jsonb_build_object('purpose', 'inbox', 'status', 'received'), 'whatsapp_inbox', v_id, 'system', v_customer.is_demo);
  end if;

  -- Throttle automatic replies per contact (loops, spam).
  select count(*) into v_recent from public.whatsapp_inbox
   where gym_id = v_gym.id and contact_phone_e164 = v_phone and author = 'bot' and created_at > now() - interval '1 hour';

  select * into v_m from public.memberships
   where customer_id = v_customer.id and status in ('active','paused','pending','expired')
   order by (status in ('active','paused')) desc, end_date desc limit 1;

  v_ctx := jsonb_build_object(
    'gym', jsonb_build_object(
      'name', v_gym.name,
      'phone', v_gym.phone_e164,
      'email', v_gym.email,
      'address', concat_ws(', ', v_gym.address_line1, v_gym.address_line2, v_gym.city, v_gym.state, v_gym.postal_code),
      'info', v_gym.auto_reply_info,
      'pause_max_days', v_gym.pause_max_days,
      'gst_enabled', v_gym.gst_enabled,
      'default_gst_rate', v_gym.default_gst_rate),
    'today', private.gym_today(v_gym.id),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'name', p.name, 'price_paise', p.base_price_paise, 'duration_value', p.duration_value,
        'duration_unit', p.duration_unit, 'gst_rate', coalesce(p.gst_rate, v_gym.default_gst_rate),
        'pause_allowance_days', p.pause_allowance_days, 'description', p.description) order by p.sort_order, p.base_price_paise)
      from public.membership_plans p where p.gym_id = v_gym.id and p.active and not p.is_demo), '[]'::jsonb),
    'member', case when v_customer.id is null then null else jsonb_build_object(
      'first_name', split_part(v_customer.full_name, ' ', 1),
      'membership', case when v_m.id is null then null else jsonb_build_object(
        'plan', v_m.plan_name, 'status', v_m.status, 'start_date', v_m.start_date, 'end_date', v_m.end_date,
        'pause_days_used', v_m.pause_days_used,
        'pause_days_left', greatest(v_m.pause_allowance_days - v_m.pause_days_used, 0)) end,
      'unpaid_invoices', (select count(*) from public.invoices i where i.customer_id = v_customer.id
                            and i.status = 'issued' and i.payment_status <> 'paid'),
      'amount_due_paise', (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i
                            where i.customer_id = v_customer.id and i.status = 'issued' and i.payment_status <> 'paid'),
      'last_invoice', (select jsonb_build_object('number', i.invoice_number, 'date', i.issue_date,
                         'total_paise', i.total_paise, 'payment_status', i.payment_status)
                       from public.invoices i where i.customer_id = v_customer.id and i.status = 'issued'
                       order by i.issue_date desc, i.created_at desc limit 1)) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('author', h.author, 'body', h.body) order by h.created_at)
      from (select author, body, created_at from public.whatsapp_inbox
             where gym_id = v_gym.id and contact_phone_e164 = v_phone and id <> v_id and status <> 'failed'
             order by created_at desc limit 8) h), '[]'::jsonb));

  return jsonb_build_object(
    'ok', true,
    'inbound_id', v_id,
    'to', v_phone,
    'bot_enabled', v_gym.auto_reply_enabled,
    -- A member asked for a person and staff have not answered yet: the bot stays
    -- quiet (except for "menu"/"hi") so it does not talk over the team.
    'handoff_active', exists (select 1 from public.whatsapp_inbox w
                               where w.gym_id = v_gym.id and w.contact_phone_e164 = v_phone and w.id <> v_id
                                 and w.direction = 'in' and w.needs_staff and w.created_at > now() - interval '12 hours'),
    'reply_allowed', v_gym.auto_reply_enabled and v_recent < 30
                     and (p_sent_at is null or p_sent_at > now() - interval '15 minutes'),
    'context', v_ctx);
end $$;

-- Record the bot's reply (or its failure) for an incoming message; a null body only flags it.
create or replace function public.inbox_record_reply(
  p_secret text, p_inbound_id uuid, p_body text, p_wa_message_id text,
  p_ok boolean, p_error text default null, p_needs_staff boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.whatsapp_inbox%rowtype;
begin
  perform private.require_secret(p_secret);
  select * into r from public.whatsapp_inbox where id = p_inbound_id and direction = 'in';
  if not found then return; end if;
  if p_body is null then  -- no reply sent: only flag the message for staff
    update public.whatsapp_inbox set needs_staff = p_needs_staff where id = r.id;
    return;
  end if;
  insert into public.whatsapp_inbox (gym_id, customer_id, contact_phone_e164, contact_name, direction, author, body,
    wa_message_id, status, error)
  values (r.gym_id, r.customer_id, r.contact_phone_e164, r.contact_name, 'out', 'bot', left(p_body, 4096),
    p_wa_message_id, case when p_ok then 'sent' else 'failed' end, left(p_error, 500));
  update public.whatsapp_inbox set needs_staff = p_needs_staff or not p_ok where id = r.id;
end $$;

-- ---------------------------------------------------------------------------
-- Staff side
-- ---------------------------------------------------------------------------

create or replace function public.inbox_conversations(p_limit int default 50)
returns table (contact_phone_e164 text, customer_id uuid, display_name text, last_body text, last_author text,
               last_at timestamptz, unread int, needs_staff boolean)
language sql stable security definer set search_path = '' as $$
  with g as (select private.require_staff() as gym_id),
  t as (
    select w.contact_phone_e164,
           max(w.customer_id::text)::uuid as customer_id,
           max(w.created_at) as last_at,
           count(*) filter (where w.direction = 'in' and w.read_at is null)::int as unread,
           bool_or(w.direction = 'in' and w.needs_staff) as needs_staff
      from public.whatsapp_inbox w, g where w.gym_id = g.gym_id
     group by w.contact_phone_e164)
  select t.contact_phone_e164, t.customer_id,
         coalesce(c.full_name, (select w.contact_name from public.whatsapp_inbox w, g
                                 where w.gym_id = g.gym_id and w.contact_phone_e164 = t.contact_phone_e164
                                   and w.contact_name is not null order by w.created_at desc limit 1)),
         l.body, l.author, t.last_at, t.unread, t.needs_staff
    from t
    left join public.customers c on c.id = t.customer_id
    cross join lateral (select w.body, w.author from public.whatsapp_inbox w, g
                         where w.gym_id = g.gym_id and w.contact_phone_e164 = t.contact_phone_e164
                         order by w.created_at desc limit 1) l
   order by t.last_at desc
   limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.inbox_mark_read(p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  update public.whatsapp_inbox set read_at = now()
   where gym_id = v_gym and contact_phone_e164 = p_phone and direction = 'in' and read_at is null;
end $$;

-- Staff reply: the app sends it through WhatsApp first, then records the result.
create or replace function public.inbox_record_staff_reply(
  p_phone text, p_body text, p_wa_message_id text, p_ok boolean, p_error text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_id uuid;
  v_customer uuid;
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'invalid phone' using errcode = '22023'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'write a reply' using errcode = '22023'; end if;
  select id into v_customer from public.customers where gym_id = v_gym and phone_e164 = p_phone;
  insert into public.whatsapp_inbox (gym_id, customer_id, contact_phone_e164, direction, author, body,
    wa_message_id, status, error, staff_user_id)
  values (v_gym, v_customer, p_phone, 'out', 'staff', left(p_body, 4096), p_wa_message_id,
    case when p_ok then 'sent' else 'failed' end, left(p_error, 500), auth.uid())
  returning id into v_id;
  if p_ok then
    update public.whatsapp_inbox set needs_staff = false, read_at = coalesce(read_at, now())
     where gym_id = v_gym and contact_phone_e164 = p_phone and direction = 'in';
  end if;
  return v_id;
end $$;

-- Hours since the contact last wrote (WhatsApp allows free-form replies for 24h).
create or replace function public.inbox_window(p_phone text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('last_in_at', max(created_at),
    'open', coalesce(max(created_at) > now() - interval '24 hours', false))
    from public.whatsapp_inbox
   where gym_id = private.require_staff() and contact_phone_e164 = p_phone and direction = 'in'
$$;

create or replace function public.set_auto_reply(p_enabled boolean, p_info text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true);
begin
  if p_info is not null and length(p_info) > 4000 then
    raise exception 'keep the gym information under 4000 characters' using errcode = '22023';
  end if;
  update public.gyms set auto_reply_enabled = coalesce(p_enabled, false),
    auto_reply_info = nullif(btrim(coalesce(p_info, '')), '') where id = v_gym;
end $$;

do $$
declare f text;
begin
  foreach f in array array['inbox_receive(text,text,text,text,text,text,timestamptz)',
                           'inbox_record_reply(text,uuid,text,text,boolean,text,boolean)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['inbox_conversations(integer)', 'inbox_mark_read(text)',
                           'inbox_record_staff_reply(text,text,text,boolean,text)', 'inbox_window(text)',
                           'set_auto_reply(boolean,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
