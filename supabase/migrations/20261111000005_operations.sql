-- Phases 3–6: memberships, pauses, invoices, payments, WhatsApp queue,
-- automations, member portal, settings helpers and analytics.
--
-- Every write below goes through a function that checks authorization
-- itself. Staff functions derive the gym from auth.uid(); machine functions
-- (dispatcher, webhooks) require a secret stored only in private.app_secrets;
-- member-portal functions require a hashed single-use link or session token.

-- ---------------------------------------------------------------------------
-- Configuration additions
-- ---------------------------------------------------------------------------
alter table public.gyms
  add column activation_rule text not null default 'full_payment'
    check (activation_rule in ('full_payment','any_payment','immediate')),
  add column renewal_follow_up_days int not null default 3 check (renewal_follow_up_days between 1 and 60),
  add column portal_link_days int not null default 30 check (portal_link_days between 1 and 365);

alter table public.whatsapp_messages drop constraint whatsapp_messages_status_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_status_check
  check (status in ('queued','sending','sent','delivered','read','failed','cancelled','simulated'));
alter table public.whatsapp_messages add column body_preview text;

create table private.app_secrets (
  name  text primary key,
  value text not null
);
revoke all on private.app_secrets from public, anon, authenticated;
insert into private.app_secrets (name, value) values
  ('dispatch', encode(extensions.gen_random_bytes(32), 'hex')),
  ('app_url', 'https://muscle-house-gym-os.onrender.com')
on conflict (name) do nothing;

create or replace function private.secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_secrets where name = p_name
$$;

create or replace function private.require_secret(p_value text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_value is null or p_value <> private.secret('dispatch') then
    raise exception 'invalid secret' using errcode = '42501';
  end if;
end $$;

create or replace function private.sha256_hex(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function private.gym_today(p_gym uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.gyms where id = p_gym), 'Asia/Kolkata'))::date
$$;

create or replace function private.require_staff(p_admin boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_gym uuid := private.caller_gym();
begin
  if v_gym is null then raise exception 'not an active staff member' using errcode = '42501'; end if;
  if p_admin and not private.is_admin(v_gym) then
    raise exception 'only an owner or admin can do this' using errcode = '42501';
  end if;
  return v_gym;
end $$;

-- ---------------------------------------------------------------------------
-- Date maths
-- Month terms end the day before the same date N months later; when the
-- target month is shorter (31 Jan + 1 month) the term ends on its last day.
-- ---------------------------------------------------------------------------
create or replace function public.membership_end_date(p_start date, p_value int, p_unit text)
returns date language plpgsql immutable set search_path = '' as $$
declare t date;
begin
  if p_unit = 'day' then return p_start + p_value - 1; end if;
  t := (p_start + make_interval(months => p_value))::date;
  if extract(day from t) < extract(day from p_start) then
    return t;            -- clamped to month end (e.g. 31 Jan → 28/29 Feb)
  end if;
  return t - 1;
end $$;

create or replace function private.financial_year(p_date date)
returns text language sql immutable set search_path = '' as $$
  select case when extract(month from p_date) >= 4
    then extract(year from p_date)::int || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_date)::int - 1) || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0')
  end
$$;

-- GST split for intra-state supply: half CGST, half SGST (rounded to paise,
-- SGST takes the remainder so the two always add up exactly).
create or replace function public.gst_breakdown(p_taxable bigint, p_rate numeric)
returns table (cgst bigint, sgst bigint, total_tax bigint) language sql immutable set search_path = '' as $$
  with t as (select round(p_taxable * p_rate / 100.0)::bigint as tax)
  select (t.tax / 2) + (t.tax % 2), t.tax / 2, t.tax from t
$$;

-- ---------------------------------------------------------------------------
-- Timeline helper
-- ---------------------------------------------------------------------------
create or replace function private.add_event(
  p_gym uuid, p_customer uuid, p_type text, p_title text, p_details jsonb,
  p_entity_type text, p_entity_id uuid, p_actor_type text default 'staff', p_is_demo boolean default false)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id,
                                      actor_user_id, actor_type, is_demo)
  values (p_gym, p_customer, p_type, p_title, coalesce(p_details, '{}'::jsonb), p_entity_type, p_entity_id,
          auth.uid(), p_actor_type, p_is_demo);
$$;

-- ---------------------------------------------------------------------------
-- Automation rules (seeded per gym)
-- ---------------------------------------------------------------------------
create or replace function private.ensure_automation_rules(p_gym uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.automation_rules (gym_id, key, template_name, config) values
    (p_gym, 'enquiry_follow_up', 'enquiry_follow_up',
     '{"body":"Hi {{1}}, thank you for visiting {{2}}! We wanted to check whether you had any questions about our membership plans. We''d be happy to help."}'),
    (p_gym, 'membership_confirmation', 'membership_confirmation',
     '{"body":"Hi {{1}}, welcome to {{2}}! Your {{3}} membership is active from {{4}} to {{5}}. View your membership, invoices and pauses: {{6}}"}'),
    (p_gym, 'invoice_delivery', 'invoice_delivery',
     '{"body":"Hi {{1}}, here is your invoice {{2}} from {{3}} for {{4}}. Payment status: {{5}}."}'),
    (p_gym, 'expiry_reminder', 'expiry_reminder',
     '{"body":"Hi {{1}}, your {{2}} membership at {{3}} ends on {{4}} ({{5}}). Renew at the front desk to keep training without a break."}'),
    (p_gym, 'pause_confirmation', 'pause_confirmation',
     '{"body":"Hi {{1}}, your membership pause from {{2}} to {{3}} is confirmed. {{4}} pause days used, {{5}} remaining. New expiry date: {{6}}."}'),
    (p_gym, 'renewal_follow_up', 'renewal_follow_up',
     '{"body":"Hi {{1}}, we miss you at {{2}}! Your {{3}} membership ended on {{4}}. Renew today and get back on track."}')
  on conflict (gym_id, key) do nothing;
$$;

create or replace function private.gyms_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_automation_rules(new.id);
  return new;
end $$;
create trigger gyms_seed_rules after insert on public.gyms
  for each row execute function private.gyms_after_insert();

select private.ensure_automation_rules(id) from public.gyms;

-- ---------------------------------------------------------------------------
-- WhatsApp queue
-- ---------------------------------------------------------------------------
create or replace function private.render_template(p_body text, p_params jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := p_body;
  i int;
begin
  for i in 1 .. coalesce(jsonb_array_length(p_params), 0) loop
    v := replace(v, '{{' || i || '}}', coalesce(p_params->>(i - 1), ''));
  end loop;
  return v;
end $$;

-- Queues a template message unless the rule is disabled or the customer has
-- not opted in. Duplicate keys are ignored (idempotent). Every decision is
-- logged in automation_executions.
create or replace function private.queue_message(
  p_gym uuid, p_customer uuid, p_rule text, p_params jsonb, p_dedupe text,
  p_related_type text default null, p_related_id uuid default null, p_membership uuid default null,
  p_document_path text default null, p_require_opt_in boolean default true, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.automation_rules%rowtype;
  v_phone text;
  v_opt boolean;
  v_provider text;
  v_id uuid;
  v_template text;
  v_body text;
begin
  if p_rule = 'portal_otp' then
    v_template := 'portal_otp';
    v_body := 'Your member portal code is {{1}}. It expires in 10 minutes. Do not share it with anyone.';
  elsif p_rule = 'portal_link' then
    v_template := 'portal_link';
    v_body := 'Hi {{1}}, here is your secure {{2}} member portal link: {{3}} It is valid for {{4}} days.';
  else
    select * into v_rule from public.automation_rules where gym_id = p_gym and key = p_rule;
    if not found or not v_rule.enabled then
      insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, detail, is_demo)
      values (p_gym, p_rule, p_dedupe, 'skipped', p_customer, p_membership, 'Automation is turned off', p_is_demo)
      on conflict (gym_id, dedupe_key) do nothing;
      return null;
    end if;
    v_template := v_rule.template_name;
    v_body := v_rule.config->>'body';
  end if;

  select c.phone_e164, coalesce(np.whatsapp_opt_in, false) into v_phone, v_opt
  from public.customers c left join public.notification_preferences np on np.customer_id = c.id
  where c.id = p_customer and c.gym_id = p_gym;
  if v_phone is null then return null; end if;

  if p_require_opt_in and not v_opt then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, detail, is_demo)
    values (p_gym, p_rule, p_dedupe, 'skipped', p_customer, p_membership, 'Customer has not opted in to WhatsApp', p_is_demo)
    on conflict (gym_id, dedupe_key) do nothing;
    return null;
  end if;

  select whatsapp_provider into v_provider from public.gyms where id = p_gym;

  insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name, template_params,
    document_path, related_entity_type, related_entity_id, provider, simulated, dedupe_key, body_preview, created_by, is_demo)
  values (p_gym, p_customer, v_phone, p_rule, v_template, p_params, p_document_path, p_related_type, p_related_id,
    v_provider, v_provider = 'mock', p_dedupe, private.render_template(v_body, p_params), auth.uid(), p_is_demo)
  on conflict (gym_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and p_rule not in ('portal_otp','portal_link') then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, message_id, detail, is_demo)
    values (p_gym, p_rule, p_dedupe, 'queued', p_customer, p_membership, v_id, 'Message queued', p_is_demo)
    on conflict (gym_id, dedupe_key) do nothing;
  end if;
  return v_id;
end $$;

-- Dispatcher API (called by the Next.js server with the dispatch secret).
create or replace function public.dispatch_claim(p_secret text, p_limit int default 20, p_message_id uuid default null)
returns setof public.whatsapp_messages
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_secret(p_secret);
  return query
  update public.whatsapp_messages m
     set status = 'sending', attempts = m.attempts + 1, updated_at = now()
   where m.id in (
     select id from public.whatsapp_messages
      where status = 'queued' and next_attempt_at <= now()
        and (p_message_id is null or id = p_message_id)
      order by next_attempt_at
      limit least(greatest(p_limit, 1), 100)
      for update skip locked)
  returning m.*;
end $$;

create or replace function public.dispatch_complete(
  p_secret text, p_message_id uuid, p_outcome text, p_provider_message_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.whatsapp_messages%rowtype;
  v_exec_status text;
begin
  perform private.require_secret(p_secret);
  if p_outcome not in ('sent','simulated','failed') then raise exception 'bad outcome'; end if;
  select * into m from public.whatsapp_messages where id = p_message_id for update;
  if not found or m.status <> 'sending' then return; end if;

  if p_outcome = 'failed' then
    if m.attempts < m.max_attempts then
      update public.whatsapp_messages set status = 'queued', last_error = p_error,
        next_attempt_at = now() + make_interval(mins => (power(4, m.attempts))::int) where id = m.id;
      return;
    end if;
    update public.whatsapp_messages set status = 'failed', last_error = p_error where id = m.id;
    v_exec_status := 'failed';
  else
    update public.whatsapp_messages set status = p_outcome, provider_message_id = p_provider_message_id,
      sent_at = now(), last_error = null where id = m.id;
    v_exec_status := 'success';
  end if;

  update public.automation_executions set status = v_exec_status,
    detail = case when p_outcome = 'simulated' then 'Simulated (mock provider) — not delivered to WhatsApp'
                  when p_outcome = 'sent' then 'Accepted by WhatsApp'
                  else coalesce(p_error, 'Failed') end,
    executed_at = now()
  where message_id = m.id;

  if m.customer_id is not null and m.purpose <> 'portal_otp' then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_type, is_demo)
    values (m.gym_id, m.customer_id, 'whatsapp_message',
      case p_outcome when 'simulated' then 'WhatsApp message simulated' when 'sent' then 'WhatsApp message sent'
                     else 'WhatsApp message failed' end,
      jsonb_build_object('purpose', m.purpose, 'status', p_outcome, 'error', p_error),
      'whatsapp_message', m.id, 'system', m.is_demo);
  end if;
end $$;

-- Delivery status webhooks (provider → app → here).
create or replace function public.dispatch_status_update(
  p_secret text, p_provider text, p_provider_message_id text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_secret(p_secret);
  if p_status not in ('sent','delivered','read','failed') then return; end if;
  update public.whatsapp_messages
     set status = case
           when p_status = 'failed' then 'failed'
           -- never move backwards (read → delivered) on out-of-order webhooks
           when status = 'read' then 'read'
           when status = 'delivered' and p_status = 'sent' then 'delivered'
           else p_status end,
         delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, now()) else delivered_at end,
         read_at = case when p_status = 'read' then coalesce(read_at, now()) else read_at end,
         last_error = case when p_status = 'failed' then coalesce(p_error, 'Delivery failed') else last_error end
   where provider = p_provider and provider_message_id = p_provider_message_id
     and status <> 'simulated';
  if p_status = 'failed' then
    update public.automation_executions e set status = 'failed', detail = coalesce(p_error, 'Delivery failed')
      from public.whatsapp_messages m
     where m.provider = p_provider and m.provider_message_id = p_provider_message_id and e.message_id = m.id;
  end if;
end $$;

-- Staff: retry a failed message (admin) / cancel a queued one.
create or replace function public.retry_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true);
begin
  update public.whatsapp_messages
     set status = 'queued', next_attempt_at = now(), max_attempts = attempts + 3, last_error = null
   where id = p_message_id and gym_id = v_gym and status = 'failed';
  if not found then raise exception 'only failed messages can be retried'; end if;
  update public.automation_executions set status = 'queued', detail = 'Retry requested by staff'
   where message_id = p_message_id;
end $$;

-- ---------------------------------------------------------------------------
-- Member portal links
-- ---------------------------------------------------------------------------
create or replace function private.new_portal_link(p_gym uuid, p_customer uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.member_portal_tokens (gym_id, customer_id, token_hash, expires_at)
  values (p_gym, p_customer, private.sha256_hex(v_token),
          now() + make_interval(days => (select portal_link_days from public.gyms where id = p_gym)));
  return private.secret('app_url') || '/portal/t/' || v_token;
end $$;

create or replace function public.send_portal_link(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_name text;
  v_link text;
  v_msg uuid;
begin
  select full_name into v_name from public.customers where id = p_customer_id and gym_id = v_gym;
  if v_name is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  v_link := private.new_portal_link(v_gym, p_customer_id);
  v_msg := private.queue_message(v_gym, p_customer_id, 'portal_link',
    jsonb_build_array(split_part(v_name, ' ', 1), (select name from public.gyms where id = v_gym), v_link,
      (select portal_link_days from public.gyms where id = v_gym)::text),
    'portal_link:' || p_customer_id || ':' || extract(epoch from now())::bigint, 'customer', p_customer_id);
  return jsonb_build_object('link', v_link, 'message_id', v_msg);
end $$;

-- ---------------------------------------------------------------------------
-- Membership status refresh (pending → active, active ↔ paused, → expired)
-- ---------------------------------------------------------------------------
create or replace function private.refresh_memberships(p_gym uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  v_today date;
  v_paused boolean;
  v_target text;
begin
  for r in
    select m.*, g.activation_rule,
           coalesce(i.payment_status, 'unpaid') as pay_status,
           coalesce(i.amount_paid_paise, 0) as paid
    from public.memberships m
    join public.gyms g on g.id = m.gym_id
    left join lateral (select payment_status, amount_paid_paise from public.invoices
                        where membership_id = m.id and status = 'issued' order by created_at desc limit 1) i on true
    where m.status in ('pending','active','paused') and (p_gym is null or m.gym_id = p_gym)
    for update of m
  loop
    v_today := private.gym_today(r.gym_id);
    v_paused := exists (select 1 from public.membership_pauses p where p.membership_id = r.id
                         and p.status = 'approved' and v_today between p.start_date and p.end_date);
    if r.end_date < v_today then
      v_target := 'expired';
    elsif r.status = 'pending' then
      if r.start_date <= v_today and (r.activation_rule = 'immediate'
           or (r.activation_rule = 'any_payment' and r.paid > 0)
           or (r.activation_rule = 'full_payment' and r.pay_status = 'paid')) then
        v_target := case when v_paused then 'paused' else 'active' end;
      else
        v_target := 'pending';
      end if;
    else
      v_target := case when v_paused then 'paused' else 'active' end;
    end if;

    if v_target <> r.status then
      update public.memberships set status = v_target where id = r.id;
      n := n + 1;
      if v_target = 'expired' then
        perform private.add_event(r.gym_id, r.customer_id, 'membership_expired', 'Membership expired',
          jsonb_build_object('plan', r.plan_name, 'end_date', r.end_date), 'membership', r.id, 'system', r.is_demo);
      elsif v_target = 'active' and r.status = 'pending' then
        perform private.add_event(r.gym_id, r.customer_id, 'membership_activated', 'Membership activated',
          jsonb_build_object('plan', r.plan_name, 'start_date', r.start_date, 'end_date', r.end_date),
          'membership', r.id, 'system', r.is_demo);
        perform private.queue_confirmation(r.id);
      end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function private.queue_confirmation(p_membership uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select ms.*, c.full_name, g.name as gym_name into m
  from public.memberships ms join public.customers c on c.id = ms.customer_id join public.gyms g on g.id = ms.gym_id
  where ms.id = p_membership;
  perform private.queue_message(m.gym_id, m.customer_id, 'membership_confirmation',
    jsonb_build_array(split_part(m.full_name, ' ', 1), m.gym_name, m.plan_name,
      to_char(m.start_date, 'DD Mon YYYY'), to_char(m.end_date, 'DD Mon YYYY'),
      private.new_portal_link(m.gym_id, m.customer_id)),
    'confirm:' || m.id, 'membership', m.id, m.id, null, true, m.is_demo);
end $$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create or replace function private.issue_invoice(
  p_gym uuid, p_customer uuid, p_membership uuid, p_items jsonb, p_discount bigint,
  p_gst_rate numeric, p_issue_date date, p_key uuid, p_replaces uuid default null,
  p_notes text default null, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  g public.gyms%rowtype;
  c public.customers%rowtype;
  v_subtotal bigint;
  v_taxable bigint;
  v_tax record;
  v_fy text := private.financial_year(p_issue_date);
  v_seq int;
  v_id uuid;
  it jsonb;
begin
  select * into g from public.gyms where id = p_gym;
  select * into c from public.customers where id = p_customer and gym_id = p_gym;
  if c.id is null then raise exception 'customer not found'; end if;

  select coalesce(sum((x->>'unit_price_paise')::bigint * coalesce((x->>'quantity')::int, 1)), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  if p_discount < 0 or p_discount > v_subtotal then raise exception 'discount must be between 0 and the subtotal'; end if;
  v_taxable := v_subtotal - p_discount;
  select * into v_tax from public.gst_breakdown(v_taxable, case when g.gst_enabled then p_gst_rate else 0 end);

  insert into public.invoice_counters (gym_id, financial_year, last_value) values (p_gym, v_fy, 1)
  on conflict (gym_id, financial_year) do update set last_value = public.invoice_counters.last_value + 1
  returning last_value into v_seq;

  insert into public.invoices (gym_id, customer_id, membership_id, invoice_number, financial_year, sequence_no,
    issue_date, subtotal_paise, discount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise,
    total_paise, customer_snapshot, gym_snapshot, idempotency_key, replaces_invoice_id, notes, created_by, is_demo)
  values (p_gym, p_customer, p_membership, g.invoice_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0'),
    v_fy, v_seq, p_issue_date, v_subtotal, p_discount, v_taxable,
    case when g.gst_enabled then p_gst_rate else 0 end, v_tax.cgst, v_tax.sgst, 0,
    v_taxable + v_tax.total_tax,
    jsonb_build_object('name', c.full_name, 'phone', c.phone_e164, 'email', c.email),
    jsonb_build_object('name', g.name, 'legal_name', g.legal_name, 'address_line1', g.address_line1,
      'address_line2', g.address_line2, 'city', g.city, 'state', g.state, 'state_code', g.state_code,
      'postal_code', g.postal_code, 'gstin', g.gstin, 'phone', g.phone_e164, 'email', g.email,
      'sac_code', g.sac_code, 'gst_enabled', g.gst_enabled),
    p_key, p_replaces, p_notes, auth.uid(), p_is_demo)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.invoice_items (gym_id, invoice_id, description, sac_code, quantity, unit_price_paise, amount_paise)
    values (p_gym, v_id, it->>'description', g.sac_code, coalesce((it->>'quantity')::int, 1),
            (it->>'unit_price_paise')::bigint,
            (it->>'unit_price_paise')::bigint * coalesce((it->>'quantity')::int, 1));
  end loop;

  perform private.add_event(p_gym, p_customer, 'invoice_issued', 'Invoice issued',
    jsonb_build_object('invoice_id', v_id, 'number', (select invoice_number from public.invoices where id = v_id),
                       'total_paise', v_taxable + v_tax.total_tax), 'invoice', v_id, 'staff', p_is_demo);
  return v_id;
end $$;

create or replace function private.apply_payment(
  p_invoice uuid, p_amount bigint, p_method text, p_reference text, p_key uuid, p_paid_at timestamptz default now(),
  p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices%rowtype;
  v_id uuid;
  v_paid bigint;
begin
  select id into v_id from public.payments where idempotency_key = p_key;
  if found then return v_id; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if i.status <> 'issued' then raise exception 'cannot record a payment on a cancelled invoice'; end if;
  if p_amount <= 0 then raise exception 'payment amount must be positive'; end if;
  if p_amount > i.total_paise - i.amount_paid_paise then
    raise exception 'payment exceeds the outstanding amount (₹%)', round((i.total_paise - i.amount_paid_paise) / 100.0, 2);
  end if;
  insert into public.payments (gym_id, invoice_id, customer_id, amount_paise, method, reference, paid_at,
                               idempotency_key, recorded_by, is_demo)
  values (i.gym_id, i.id, i.customer_id, p_amount, p_method, nullif(trim(p_reference), ''), p_paid_at, p_key,
          auth.uid(), p_is_demo)
  returning id into v_id;
  v_paid := i.amount_paid_paise + p_amount;
  update public.invoices set amount_paid_paise = v_paid,
    payment_status = case when v_paid >= i.total_paise then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end
  where id = i.id;
  perform private.add_event(i.gym_id, i.customer_id, 'payment_recorded', 'Payment recorded',
    jsonb_build_object('amount_paise', p_amount, 'method', p_method, 'invoice_number', i.invoice_number),
    'payment', v_id, 'staff', p_is_demo);
  return v_id;
end $$;

create or replace function public.record_payment(
  p_invoice_id uuid, p_amount_paise bigint, p_method text, p_reference text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_pay uuid;
  v_membership uuid;
begin
  if not exists (select 1 from public.invoices where id = p_invoice_id and gym_id = v_gym) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  v_pay := private.apply_payment(p_invoice_id, p_amount_paise, p_method, p_reference, p_idempotency_key);
  select membership_id into v_membership from public.invoices where id = p_invoice_id;
  if v_membership is not null then perform private.refresh_memberships(v_gym); end if;
  return jsonb_build_object('payment_id', v_pay);
end $$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  i public.invoices%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'a cancellation reason is required'; end if;
  select * into i from public.invoices where id = p_invoice_id and gym_id = v_gym for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if i.status = 'cancelled' then raise exception 'invoice is already cancelled'; end if;
  if i.amount_paid_paise > 0 then
    raise exception 'this invoice has payments recorded; re-issue a corrected invoice instead of cancelling';
  end if;
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason) where id = i.id;
  perform private.add_event(v_gym, i.customer_id, 'invoice_cancelled', 'Invoice cancelled',
    jsonb_build_object('number', i.invoice_number, 'reason', trim(p_reason)), 'invoice', i.id);
end $$;

-- Correction: cancel the original (any payments move to the replacement) and
-- issue a new sequentially-numbered invoice with the corrected discount.
create or replace function public.reissue_invoice(p_invoice_id uuid, p_discount_paise bigint, p_reason text,
                                                  p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  i public.invoices%rowtype;
  v_new uuid;
  v_items jsonb;
begin
  select id into v_new from public.invoices where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('invoice_id', v_new); end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a correction reason is required'; end if;
  select * into i from public.invoices where id = p_invoice_id and gym_id = v_gym for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if i.status = 'cancelled' then raise exception 'invoice is already cancelled'; end if;

  select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity,
                                      'unit_price_paise', unit_price_paise))
    into v_items from public.invoice_items where invoice_id = i.id;
  v_new := private.issue_invoice(v_gym, i.customer_id, i.membership_id, v_items, p_discount_paise, i.gst_rate,
                                 private.gym_today(v_gym), p_idempotency_key, i.id, 'Replaces ' || i.invoice_number);
  if (select total_paise from public.invoices where id = v_new) < i.amount_paid_paise then
    raise exception 'the corrected total is lower than the amount already paid';
  end if;
  -- move recorded payments to the replacement invoice
  update public.invoices set amount_paid_paise = 0, payment_status = 'unpaid' where id = i.id;
  update public.invoices n set amount_paid_paise = i.amount_paid_paise,
    payment_status = case when i.amount_paid_paise >= n.total_paise then 'paid'
                          when i.amount_paid_paise > 0 then 'partial' else 'unpaid' end
  where n.id = v_new;
  update public.payments set invoice_id = v_new where invoice_id = i.id;
  insert into public.audit_logs (gym_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (v_gym, auth.uid(), 'reassign_payments', 'payments', v_new,
          jsonb_build_object('from_invoice', i.id), jsonb_build_object('to_invoice', v_new));
  update public.invoices set status = 'cancelled', cancelled_at = now(),
    cancelled_reason = 'Corrected: ' || trim(p_reason) where id = i.id;
  perform private.add_event(v_gym, i.customer_id, 'invoice_cancelled', 'Invoice corrected and re-issued',
    jsonb_build_object('number', i.invoice_number, 'reason', trim(p_reason), 'replacement_id', v_new), 'invoice', i.id);
  return jsonb_build_object('invoice_id', v_new);
end $$;

-- ---------------------------------------------------------------------------
-- Membership activation / renewal
-- ---------------------------------------------------------------------------
create or replace function public.activate_membership(
  p_customer_id uuid,
  p_plan_id uuid,
  p_start_date date,
  p_discount_paise bigint,
  p_amount_paid_paise bigint,
  p_payment_method text,
  p_payment_reference text,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  g public.gyms%rowtype;
  p public.membership_plans%rowtype;
  c public.customers%rowtype;
  v_existing public.memberships%rowtype;
  v_prev uuid;
  v_id uuid;
  v_invoice uuid;
  v_end date;
  v_rate numeric;
  v_status text;
  v_today date := private.gym_today(v_gym);
begin
  -- idempotency: a repeated click returns the membership already created
  select * into v_existing from public.memberships where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('membership_id', v_existing.id, 'status', v_existing.status,
      'invoice_id', (select id from public.invoices where membership_id = v_existing.id order by created_at limit 1),
      'duplicate', true);
  end if;

  if coalesce(p_discount_paise, 0) > 0 and not private.is_admin(v_gym) then
    raise exception 'only an owner or admin can give discounts' using errcode = '42501';
  end if;
  select * into g from public.gyms where id = v_gym;
  select * into c from public.customers where id = p_customer_id and gym_id = v_gym for update;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  select * into p from public.membership_plans where id = p_plan_id and gym_id = v_gym;
  if not found or not p.active then raise exception 'plan not found or inactive'; end if;
  if p_start_date is null or p_start_date < v_today - 7 then
    raise exception 'start date cannot be more than 7 days in the past';
  end if;
  if p_amount_paid_paise < 0 then raise exception 'amount paid cannot be negative'; end if;

  -- overlapping live membership? (renewals must start after the current one)
  select id into v_prev from public.memberships
   where customer_id = c.id and status in ('pending','active','paused') and end_date >= p_start_date
   order by end_date desc limit 1;
  if v_prev is not null then
    raise exception 'customer already has a membership running until %; start the renewal on or after %',
      to_char((select end_date from public.memberships where id = v_prev), 'DD Mon YYYY'),
      to_char((select end_date from public.memberships where id = v_prev) + 1, 'DD Mon YYYY');
  end if;
  select id into v_prev from public.memberships where customer_id = c.id and status in ('active','paused','expired')
   order by end_date desc limit 1;

  v_end := public.membership_end_date(p_start_date, p.duration_value, p.duration_unit);
  v_rate := coalesce(p.gst_rate, g.default_gst_rate);

  insert into public.memberships (gym_id, customer_id, plan_id, plan_name, duration_value, duration_unit, start_date,
    original_end_date, end_date, status, pause_allowance_days, price_paise, discount_paise, idempotency_key,
    renewed_from_id, created_by)
  values (v_gym, c.id, p.id, p.name, p.duration_value, p.duration_unit, p_start_date, v_end, v_end, 'pending',
    least(p.pause_allowance_days, g.pause_max_days), p.base_price_paise, coalesce(p_discount_paise, 0),
    p_idempotency_key, v_prev, auth.uid())
  returning id into v_id;

  perform private.add_event(v_gym, c.id, case when v_prev is null then 'membership_created' else 'renewal' end,
    case when v_prev is null then 'Membership purchased' else 'Membership renewed' end,
    jsonb_build_object('plan', p.name, 'start_date', p_start_date, 'end_date', v_end), 'membership', v_id);

  v_invoice := private.issue_invoice(v_gym, c.id, v_id,
    jsonb_build_array(jsonb_build_object('description',
      p.name || ' membership (' || to_char(p_start_date, 'DD Mon YYYY') || ' – ' || to_char(v_end, 'DD Mon YYYY') || ')',
      'quantity', 1, 'unit_price_paise', p.base_price_paise)),
    coalesce(p_discount_paise, 0), v_rate, v_today, gen_random_uuid());

  if p_amount_paid_paise > 0 then
    perform private.apply_payment(v_invoice, p_amount_paid_paise, p_payment_method, p_payment_reference,
                                  gen_random_uuid());
  end if;

  -- convert open enquiries
  update public.enquiries set status = 'converted', converted_membership_id = v_id, follow_up_date = null
   where customer_id = c.id and status in ('new','follow_up_pending','interested');

  perform private.refresh_memberships(v_gym);
  select status into v_status from public.memberships where id = v_id;

  perform private.queue_message(v_gym, c.id, 'invoice_delivery',
    jsonb_build_array(split_part(c.full_name, ' ', 1),
      (select invoice_number from public.invoices where id = v_invoice), g.name,
      '₹' || to_char((select total_paise from public.invoices where id = v_invoice) / 100.0, 'FM99,99,99,990.00'),
      (select payment_status from public.invoices where id = v_invoice)),
    'invoice:' || v_invoice, 'invoice', v_invoice, v_id, 'invoice:' || v_invoice);

  return jsonb_build_object('membership_id', v_id, 'status', v_status, 'invoice_id', v_invoice, 'duplicate', false);
end $$;

create or replace function public.cancel_membership(p_membership_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  m public.memberships%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into m from public.memberships where id = p_membership_id and gym_id = v_gym for update;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  if m.status in ('cancelled','expired') then raise exception 'membership is already %', m.status; end if;
  update public.memberships set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason) where id = m.id;
  perform private.add_event(v_gym, m.customer_id, 'membership_cancelled', 'Membership cancelled',
    jsonb_build_object('plan', m.plan_name, 'reason', trim(p_reason)), 'membership', m.id);
end $$;

-- ---------------------------------------------------------------------------
-- Pauses — automatic approval of valid requests, transaction-safe
-- ---------------------------------------------------------------------------
create or replace function private.do_pause(
  p_gym uuid, p_membership uuid, p_start date, p_end date, p_via text, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships%rowtype;
  v_existing public.membership_pauses%rowtype;
  v_days int;
  v_today date := private.gym_today(p_gym);
  v_new_end date;
  v_pause uuid;
  v_name text;
begin
  select * into v_existing from public.membership_pauses where idempotency_key = p_key;
  if found then
    return jsonb_build_object('pause_id', v_existing.id, 'new_end_date', v_existing.new_end_date, 'duplicate', true);
  end if;

  -- row lock serialises concurrent requests for the same membership
  select * into m from public.memberships where id = p_membership and gym_id = p_gym for update;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  if m.status in ('expired','cancelled') then
    raise exception 'pauses are not available for % memberships', m.status;
  end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid pause period'; end if;
  if p_start < v_today then raise exception 'a pause cannot start in the past'; end if;
  if p_start < m.start_date then raise exception 'a pause cannot start before the membership starts'; end if;
  if p_start > m.end_date then raise exception 'a pause must start on or before the current expiry date'; end if;
  v_days := p_end - p_start + 1;
  if v_days > m.pause_allowance_days - m.pause_days_used then
    raise exception 'only % pause day(s) remaining for this membership term',
      m.pause_allowance_days - m.pause_days_used;
  end if;
  if exists (select 1 from public.membership_pauses where membership_id = m.id and status = 'approved'
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'this pause overlaps an existing pause';
  end if;

  v_new_end := m.end_date + v_days;
  insert into public.membership_pauses (gym_id, membership_id, start_date, end_date, status, requested_via,
    requested_by, reason, previous_end_date, new_end_date, idempotency_key)
  values (p_gym, m.id, p_start, p_end, 'approved', p_via, auth.uid(), nullif(trim(p_reason), ''),
          m.end_date, v_new_end, p_key)
  returning id into v_pause;
  update public.memberships set end_date = v_new_end, pause_days_used = pause_days_used + v_days where id = m.id;

  perform private.add_event(p_gym, m.customer_id, 'pause_approved', 'Membership pause approved',
    jsonb_build_object('start_date', p_start, 'end_date', p_end, 'days', v_days,
      'remaining', m.pause_allowance_days - m.pause_days_used - v_days, 'new_end_date', v_new_end, 'via', p_via),
    'membership_pause', v_pause, case when p_via = 'member_portal' then 'member' else 'staff' end);

  select full_name into v_name from public.customers where id = m.customer_id;
  perform private.queue_message(p_gym, m.customer_id, 'pause_confirmation',
    jsonb_build_array(split_part(v_name, ' ', 1), to_char(p_start, 'DD Mon YYYY'), to_char(p_end, 'DD Mon YYYY'),
      (m.pause_days_used + v_days)::text, (m.pause_allowance_days - m.pause_days_used - v_days)::text,
      to_char(v_new_end, 'DD Mon YYYY')),
    'pause:' || v_pause, 'membership_pause', v_pause, m.id);

  perform private.refresh_memberships(p_gym);
  return jsonb_build_object('pause_id', v_pause, 'new_end_date', v_new_end, 'days', v_days,
    'remaining', m.pause_allowance_days - m.pause_days_used - v_days, 'duplicate', false);
end $$;

create or replace function public.request_pause(p_membership_id uuid, p_start date, p_end date, p_reason text,
                                                p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.do_pause(private.require_staff(), p_membership_id, p_start, p_end, 'staff', p_reason,
                          p_idempotency_key);
end $$;

-- ---------------------------------------------------------------------------
-- Member portal (anon callers; every function proves identity by token)
-- ---------------------------------------------------------------------------
create or replace function private.rate_limit(p_key text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01');
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  if v_count > p_max then raise exception 'too many attempts, please wait and try again' using errcode = '54000'; end if;
end $$;

create or replace function public.portal_open(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.member_portal_tokens%rowtype;
  v_provider text;
  v_code text;
  v_otp uuid;
  v_session text;
begin
  perform private.rate_limit('portal_open:' || left(private.sha256_hex(coalesce(p_token, '')), 16), 10, interval '15 minutes');
  select * into t from public.member_portal_tokens where token_hash = private.sha256_hex(coalesce(p_token, ''));
  if not found or t.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired. Ask the gym for a new one.');
  end if;
  select whatsapp_provider into v_provider from public.gyms where id = t.gym_id;

  if v_provider = 'mock' then
    -- WhatsApp not connected yet: the signed link alone opens the portal.
    v_session := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.member_sessions (customer_id, session_hash, expires_at)
    values (t.customer_id, private.sha256_hex(v_session), now() + interval '12 hours');
    update public.member_portal_tokens set used_at = coalesce(used_at, now()) where id = t.id;
    return jsonb_build_object('ok', true, 'mode', 'link', 'session', v_session);
  end if;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.member_portal_otps (customer_id, token_id, code_hash, expires_at)
  values (t.customer_id, t.id, private.sha256_hex(t.id::text || ':' || v_code), now() + interval '10 minutes')
  returning id into v_otp;
  perform private.queue_message(t.gym_id, t.customer_id, 'portal_otp', jsonb_build_array(v_code),
    'otp:' || v_otp, 'member_portal_otp', v_otp, null, null, false);
  return jsonb_build_object('ok', true, 'mode', 'otp', 'otp_id', v_otp);
end $$;

create or replace function public.portal_verify(p_token text, p_otp_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.member_portal_tokens%rowtype;
  o public.member_portal_otps%rowtype;
  v_session text;
begin
  perform private.rate_limit('portal_verify:' || coalesce(p_otp_id::text, 'x'), 8, interval '15 minutes');
  select * into t from public.member_portal_tokens where token_hash = private.sha256_hex(coalesce(p_token, ''));
  if not found or t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'Link expired.'); end if;
  select * into o from public.member_portal_otps where id = p_otp_id and token_id = t.id for update;
  if not found or o.consumed_at is not null or o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired. Request a new one.');
  end if;
  if o.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Request a new code.'); end if;
  if o.code_hash <> private.sha256_hex(t.id::text || ':' || coalesce(p_code, '')) then
    update public.member_portal_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'Incorrect code.');
  end if;
  update public.member_portal_otps set consumed_at = now() where id = o.id;
  update public.member_portal_tokens set used_at = coalesce(used_at, now()) where id = t.id;
  v_session := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.member_sessions (customer_id, session_hash, expires_at)
  values (t.customer_id, private.sha256_hex(v_session), now() + interval '12 hours');
  return jsonb_build_object('ok', true, 'session', v_session);
end $$;

create or replace function private.portal_customer(p_session text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select customer_id into v from public.member_sessions
   where session_hash = private.sha256_hex(coalesce(p_session, '')) and expires_at > now() and revoked_at is null;
  if v is null then raise exception 'session expired' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.portal_data(p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := private.portal_customer(p_session);
begin
  perform private.refresh_memberships((select gym_id from public.customers where id = v_customer));
  return (
    select jsonb_build_object(
      'customer', jsonb_build_object('name', c.full_name, 'phone', c.phone_e164),
      'gym', jsonb_build_object('name', g.name, 'phone', g.phone_e164, 'today', private.gym_today(g.id)),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'plan_name', m.plan_name, 'status', m.status, 'start_date', m.start_date,
          'end_date', m.end_date, 'original_end_date', m.original_end_date,
          'pause_allowance_days', m.pause_allowance_days, 'pause_days_used', m.pause_days_used,
          'pauses', coalesce((select jsonb_agg(jsonb_build_object('start_date', p.start_date, 'end_date', p.end_date,
                      'days', p.days, 'new_end_date', p.new_end_date, 'via', p.requested_via, 'created_at', p.created_at)
                      order by p.start_date) from public.membership_pauses p
                      where p.membership_id = m.id and p.status = 'approved'), '[]'::jsonb))
          order by m.start_date desc)
        from public.memberships m where m.customer_id = c.id and m.status <> 'cancelled'), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number,
          'issue_date', i.issue_date, 'total_paise', i.total_paise, 'payment_status', i.payment_status,
          'status', i.status) order by i.issue_date desc)
        from public.invoices i where i.customer_id = c.id and i.status = 'issued'), '[]'::jsonb))
    from public.customers c join public.gyms g on g.id = c.gym_id where c.id = v_customer);
end $$;

create or replace function public.portal_request_pause(p_session text, p_membership_id uuid, p_start date,
                                                       p_end date, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.portal_customer(p_session);
  v_gym uuid;
begin
  perform private.rate_limit('portal_pause:' || v_customer, 10, interval '1 hour');
  select gym_id into v_gym from public.memberships where id = p_membership_id and customer_id = v_customer;
  if v_gym is null then raise exception 'membership not found' using errcode = 'P0002'; end if;
  perform set_config('app.actor_type', 'member', true);
  return private.do_pause(v_gym, p_membership_id, p_start, p_end, 'member_portal', null, p_idempotency_key);
end $$;

-- Invoice document data for an authenticated member, the dispatcher, or staff.
create or replace function private.invoice_document(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('invoice', to_jsonb(i) - 'idempotency_key',
    'items', (select jsonb_agg(to_jsonb(it) order by it.description) from public.invoice_items it where it.invoice_id = i.id),
    'membership', (select jsonb_build_object('plan_name', plan_name, 'start_date', start_date, 'end_date', end_date)
                     from public.memberships where id = i.membership_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount_paise', amount_paise, 'method', method,
                     'paid_at', paid_at, 'reference', reference) order by paid_at)
                     from public.payments where invoice_id = i.id), '[]'::jsonb))
  from public.invoices i where i.id = p_invoice
$$;

create or replace function public.portal_invoice(p_session text, p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := private.portal_customer(p_session);
begin
  if not exists (select 1 from public.invoices where id = p_invoice_id and customer_id = v_customer) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return private.invoice_document(p_invoice_id);
end $$;

create or replace function public.portal_sign_out(p_session text)
returns void language sql security definer set search_path = '' as $$
  update public.member_sessions set revoked_at = now() where session_hash = private.sha256_hex(coalesce(p_session, ''));
$$;

create or replace function public.document_invoice(p_secret text, p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_secret(p_secret);
  return private.invoice_document(p_invoice_id);
end $$;

create or replace function public.staff_invoice_document(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  if not exists (select 1 from public.invoices where id = p_invoice_id and gym_id = v_gym) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return private.invoice_document(p_invoice_id);
end $$;

-- ---------------------------------------------------------------------------
-- Daily automations (scheduled with pg_cron; also callable by the app)
-- ---------------------------------------------------------------------------
create or replace function private.run_daily_automations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g record;
  r record;
  v_today date;
  v_queued int := 0;
  v_status int := 0;
  v_off int;
begin
  v_status := private.refresh_memberships(null);
  for g in select * from public.gyms loop
    v_today := private.gym_today(g.id);

    -- expiry reminders
    foreach v_off in array g.reminder_offsets loop
      for r in select m.*, c.full_name from public.memberships m join public.customers c on c.id = m.customer_id
               where m.gym_id = g.id and m.status in ('active','paused') and m.end_date = v_today + v_off
                 and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                                 and n.start_date > m.start_date and n.status <> 'cancelled')
      loop
        if private.queue_message(g.id, r.customer_id, 'expiry_reminder',
             jsonb_build_array(split_part(r.full_name, ' ', 1), r.plan_name, g.name, to_char(r.end_date, 'DD Mon YYYY'),
               case v_off when 0 then 'today' when 1 then 'tomorrow' else 'in ' || v_off || ' days' end),
             'expiry:' || r.id || ':' || r.end_date || ':' || v_off, 'membership', r.id, r.id, null, true, r.is_demo)
           is not null then v_queued := v_queued + 1; end if;
      end loop;
    end loop;

    -- enquiry follow-ups due today
    for r in select e.*, c.full_name from public.enquiries e join public.customers c on c.id = e.customer_id
             where e.gym_id = g.id and e.status in ('new','follow_up_pending','interested') and e.follow_up_date = v_today
    loop
      if private.queue_message(g.id, r.customer_id, 'enquiry_follow_up',
           jsonb_build_array(split_part(r.full_name, ' ', 1), g.name),
           'followup:' || r.id || ':' || v_today, 'enquiry', r.id, null, null, true, r.is_demo) is not null
      then v_queued := v_queued + 1; end if;
    end loop;

    -- renewal follow-up N days after expiry, if not renewed
    for r in select m.*, c.full_name from public.memberships m join public.customers c on c.id = m.customer_id
             where m.gym_id = g.id and m.status = 'expired' and m.end_date = v_today - g.renewal_follow_up_days
               and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                               and n.start_date > m.start_date and n.status <> 'cancelled')
    loop
      if private.queue_message(g.id, r.customer_id, 'renewal_follow_up',
           jsonb_build_array(split_part(r.full_name, ' ', 1), g.name, r.plan_name, to_char(r.end_date, 'DD Mon YYYY')),
           'renewal:' || r.id, 'membership', r.id, r.id, null, true, r.is_demo) is not null
      then v_queued := v_queued + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('status_changes', v_status, 'queued', v_queued);
end $$;

-- Admin "run now" from the Automation Center.
create or replace function public.run_automations_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff(true);
  return private.run_daily_automations();
end $$;

-- ---------------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------------
create or replace function public.add_staff_by_email(p_email text, p_role text, p_full_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  v_user uuid;
begin
  if p_role not in ('admin','staff','owner') then raise exception 'invalid role'; end if;
  if p_role = 'owner' and not private.has_role(v_gym, array['owner']) then
    raise exception 'only an owner can add another owner' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    return jsonb_build_object('ok', false, 'error',
      'No account exists for this email yet. Create the user in Supabase → Authentication → Users first.');
  end if;
  insert into public.gym_staff (gym_id, user_id, role, active) values (v_gym, v_user, p_role, true)
  on conflict (gym_id, user_id) do update set role = excluded.role, active = true;
  if nullif(trim(p_full_name), '') is not null then
    update public.user_profiles set full_name = trim(p_full_name) where id = v_user and full_name = '';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_directory()
returns table (staff_id uuid, user_id uuid, full_name text, email text, role text, active boolean)
language sql stable security definer set search_path = '' as $$
  select gs.id, gs.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)), u.email::text, gs.role, gs.active
  from public.gym_staff gs
  join auth.users u on u.id = gs.user_id
  left join public.user_profiles p on p.id = gs.user_id
  where gs.gym_id = private.caller_gym()
  order by gs.active desc, gs.role, 3
$$;

-- ---------------------------------------------------------------------------
-- Analytics (SECURITY INVOKER: staff RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_metrics(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with g as (select private.caller_gym() as id),
  t as (select private.gym_today((select id from g)) as today),
  rng as (select (p_from::timestamp at time zone 'Asia/Kolkata') as f,
                 ((p_to + 1)::timestamp at time zone 'Asia/Kolkata') as tt)
  select jsonb_build_object(
    'active_memberships', (select count(*) from public.memberships where gym_id = (select id from g) and status in ('active','paused')),
    'paused_memberships', (select count(*) from public.memberships where gym_id = (select id from g) and status = 'paused'),
    'pending_enquiries', (select count(*) from public.enquiries where gym_id = (select id from g) and status in ('new','follow_up_pending','interested')),
    'expiring_soon', (select count(*) from public.memberships where gym_id = (select id from g) and status in ('active','paused')
                        and end_date between (select today from t) and (select today from t) + 7),
    'collected_paise', (select coalesce(sum(p.amount_paise), 0) from public.payments p join public.invoices i on i.id = p.invoice_id
                        where p.gym_id = (select id from g) and i.status = 'issued'
                          and p.paid_at >= (select f from rng) and p.paid_at < (select tt from rng)),
    'new_customers', (select count(*) from public.customers where gym_id = (select id from g)
                        and created_at >= (select f from rng) and created_at < (select tt from rng)),
    'new_memberships', (select count(*) from public.memberships where gym_id = (select id from g) and renewed_from_id is null
                        and status <> 'cancelled' and created_at >= (select f from rng) and created_at < (select tt from rng)),
    'renewals', (select count(*) from public.memberships where gym_id = (select id from g) and renewed_from_id is not null
                        and status <> 'cancelled' and created_at >= (select f from rng) and created_at < (select tt from rng)),
    'expired_in_range', (select count(*) from public.memberships where gym_id = (select id from g) and status = 'expired'
                        and end_date between p_from and p_to),
    'enquiries_in_range', (select count(*) from public.enquiries where gym_id = (select id from g) and enquiry_date between p_from and p_to),
    'converted_in_range', (select count(*) from public.enquiries where gym_id = (select id from g) and enquiry_date between p_from and p_to
                        and status = 'converted'),
    'outstanding_paise', (select coalesce(sum(total_paise - amount_paid_paise), 0) from public.invoices
                        where gym_id = (select id from g) and status = 'issued' and payment_status <> 'paid'),
    'outstanding_count', (select count(*) from public.invoices where gym_id = (select id from g) and status = 'issued' and payment_status <> 'paid'),
    'failed_messages', (select count(*) from public.whatsapp_messages where gym_id = (select id from g) and status = 'failed'),
    'follow_ups_logged', (select count(*) from public.enquiry_notes where gym_id = (select id from g) and kind <> 'note'
                        and created_at >= (select f from rng) and created_at < (select tt from rng)),
    'follow_up_conversions', (select count(distinct n.enquiry_id) from public.enquiry_notes n join public.enquiries e on e.id = n.enquiry_id
                        where n.gym_id = (select id from g) and n.kind <> 'note' and e.status = 'converted'
                          and n.created_at >= (select f from rng) and n.created_at < (select tt from rng)),
    'plan_distribution', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_name, 'count', n) order by n desc)
                        from (select plan_name, count(*) n from public.memberships where gym_id = (select id from g)
                              and status in ('active','paused') group by plan_name) d), '[]'::jsonb),
    'plan_popularity', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_name, 'count', n) order by n desc)
                        from (select plan_name, count(*) n from public.memberships where gym_id = (select id from g)
                              and status <> 'cancelled' and created_at >= (select f from rng) and created_at < (select tt from rng)
                              group by plan_name) d), '[]'::jsonb),
    'today', (select today from t)
  )
$$;

create or replace function public.revenue_series(p_from date, p_to date, p_bucket text)
returns table (bucket date, collected_paise bigint)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select generate_series(date_trunc(p_bucket, p_from::timestamp), date_trunc(p_bucket, p_to::timestamp),
                           ('1 ' || p_bucket)::interval)::date as bucket
  )
  select b.bucket, coalesce(sum(p.amount_paise), 0)::bigint
  from b
  left join public.payments p
    on p.gym_id = private.caller_gym()
   and date_trunc(p_bucket, (p.paid_at at time zone 'Asia/Kolkata'))::date = b.bucket
   and (p.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   and exists (select 1 from public.invoices i where i.id = p.invoice_id and i.status = 'issued')
  group by b.bucket order by b.bucket
$$;

-- ---------------------------------------------------------------------------
-- Grants: staff RPCs to authenticated; portal RPCs to anon; machine RPCs to
-- anon too (they require the dispatch secret, checked inside).
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'membership_end_date(date,integer,text)', 'gst_breakdown(bigint,numeric)',
    'activate_membership(uuid,uuid,date,bigint,bigint,text,text,uuid)', 'cancel_membership(uuid,text)',
    'request_pause(uuid,date,date,text,uuid)', 'record_payment(uuid,bigint,text,text,uuid)',
    'cancel_invoice(uuid,text)', 'reissue_invoice(uuid,bigint,text,uuid)', 'retry_message(uuid)',
    'send_portal_link(uuid)', 'run_automations_now()', 'add_staff_by_email(text,text,text)', 'staff_directory()',
    'dashboard_metrics(date,date)', 'revenue_series(date,date,text)', 'staff_invoice_document(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'portal_open(text)', 'portal_verify(text,uuid,text)', 'portal_data(text)',
    'portal_request_pause(text,uuid,date,date,uuid)', 'portal_invoice(text,uuid)', 'portal_sign_out(text)',
    'dispatch_claim(text,integer,uuid)', 'dispatch_complete(text,uuid,text,text,text)',
    'dispatch_status_update(text,text,text,text,text)', 'document_invoice(text,uuid)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Staff may store generated invoice PDFs under their gym folder.
create policy "staff upload invoices" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1]::uuid in (select private.staff_gym_ids()));

-- Internal helpers are not callable directly; only the few used inside
-- SECURITY INVOKER functions and RLS policies are granted.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.staff_gym_ids(), private.has_role(uuid, text[]), private.is_staff(uuid),
  private.is_admin(uuid), private.caller_gym(), private.gym_today(uuid) to authenticated;
