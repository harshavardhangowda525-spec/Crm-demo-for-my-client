-- Memberships, pauses, invoices, messaging, portal and analytics.
\set ON_ERROR_STOP 1
begin;

-- ---------------------------------------------------------------- expiry maths
do $$ begin
  if public.membership_end_date('2026-11-10', 1, 'month') <> '2026-12-09' then raise exception 'simple month'; end if;
  if public.membership_end_date('2026-01-31', 1, 'month') <> '2026-02-28' then raise exception '31 Jan non-leap'; end if;
  if public.membership_end_date('2028-01-31', 1, 'month') <> '2028-02-29' then raise exception '31 Jan leap'; end if;
  if public.membership_end_date('2028-01-29', 1, 'month') <> '2028-02-28' then raise exception '29 Jan leap'; end if;
  if public.membership_end_date('2026-03-01', 1, 'month') <> '2026-03-31' then raise exception '1 Mar'; end if;
  if public.membership_end_date('2026-11-30', 3, 'month') <> '2027-02-28' then raise exception 'quarterly month-end'; end if;
  if public.membership_end_date('2027-02-28', 12, 'month') <> '2028-02-27' then raise exception 'annual into leap year'; end if;
  if public.membership_end_date('2026-12-31', 30, 'day') <> '2027-01-29' then raise exception '30 days'; end if;
  raise notice 'ok: expiry dates (month-end, leap years, day plans)';
end $$;

-- ---------------------------------------------------------------- GST
do $$ declare r record; begin
  select * into r from public.gst_breakdown(300000, 18);
  if r.total_tax <> 54000 or r.cgst <> 27000 or r.sgst <> 27000 then raise exception 'gst 18%% of 3000: %', row_to_json(r); end if;
  select * into r from public.gst_breakdown(99999, 18);
  if r.cgst + r.sgst <> r.total_tax or r.total_tax <> 18000 then raise exception 'odd paise split: %', row_to_json(r); end if;
  select * into r from public.gst_breakdown(300000, 0);
  if r.total_tax <> 0 then raise exception 'zero rate'; end if;
  raise notice 'ok: GST ₹3,000 @18%% = ₹540 (CGST ₹270 + SGST ₹270), odd paise split exactly';
end $$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'desk@test.local');
insert into public.gyms (id, name, default_gst_rate) values ('10000000-0000-0000-0000-0000000000c1', 'Gym C', 18);
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', 'staff');
insert into public.membership_plans (id, gym_id, name, duration_value, duration_unit, base_price_paise, pause_allowance_days)
values ('50000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Monthly', 1, 'month', 300000, 7);
insert into public.customers (id, gym_id, full_name, phone_e164) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Rahul Kumar', '+919876543210');
insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in)
values ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', true);
insert into public.enquiries (gym_id, customer_id, status, follow_up_date)
values ('10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', 'interested', current_date + 2);

do $$ begin
  if (select count(*) from public.automation_rules where gym_id = '10000000-0000-0000-0000-0000000000c1') <> 12 then
    raise exception 'automation rules not seeded'; end if;
  raise notice 'ok: twelve automation rules seeded for a new gym';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true) \gset ignored_

-- ---------------------------------------------------------------- activation
do $$ begin
  begin
    perform public.activate_membership('20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1',
      current_date, 50000, 0, 'cash', null, gen_random_uuid());
    raise exception 'staff discount accepted';
  exception when insufficient_privilege then raise notice 'ok: staff cannot give discounts'; end;
end $$;

create temp table act as select public.activate_membership(
  '20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1',
  current_date, 0, 354000, 'upi', 'UPI-123', 'aaaaaaaa-0000-0000-0000-000000000001') as r;

do $$ declare
  r jsonb := (select r from act);
  m public.memberships%rowtype;
  i public.invoices%rowtype;
begin
  select * into m from public.memberships where id = (r->>'membership_id')::uuid;
  select * into i from public.invoices where id = (r->>'invoice_id')::uuid;
  if m.status <> 'active' then raise exception 'not active after full payment: %', m.status; end if;
  if m.end_date <> public.membership_end_date(current_date, 1, 'month') then raise exception 'end date'; end if;
  if i.total_paise <> 354000 or i.cgst_paise <> 27000 or i.payment_status <> 'paid' then
    raise exception 'invoice wrong: %', row_to_json(i); end if;
  if i.invoice_number not like 'MH/%/0001' then raise exception 'invoice number %', i.invoice_number; end if;
  if (select status from public.enquiries limit 1) <> 'converted' then raise exception 'enquiry not converted'; end if;
  raise notice 'ok: activation → active membership, GST invoice MH/…/0001 paid, enquiry converted';
end $$;

-- repeated click with the same key does not duplicate
do $$ declare r jsonb; begin
  r := public.activate_membership('20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1',
    current_date, 0, 354000, 'upi', 'UPI-123', 'aaaaaaaa-0000-0000-0000-000000000001');
  if not (r->>'duplicate')::boolean or (select count(*) from public.memberships) <> 1
     or (select count(*) from public.invoices) <> 1 or (select count(*) from public.payments) <> 1 then
    raise exception 'duplicate activation created rows'; end if;
  raise notice 'ok: repeated activation click is idempotent';
end $$;

-- overlapping second membership is refused
do $$ begin
  begin
    perform public.activate_membership('20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1',
      current_date + 5, 0, 0, 'cash', null, gen_random_uuid());
    raise exception 'overlap accepted';
  exception when raise_exception then
    if sqlerrm not like '%already has a membership%' then raise; end if;
    raise notice 'ok: overlapping membership refused (renewal must start after expiry)';
  end;
end $$;

-- confirmation + invoice messages queued, marked simulated (mock provider)
reset role;
do $$ begin
  if (select count(*) from public.whatsapp_messages where purpose in ('membership_confirmation','invoice_delivery')) <> 2 then
    raise exception 'messages not queued'; end if;
  if exists (select 1 from public.whatsapp_messages where not simulated) then raise exception 'mock message not flagged'; end if;
  if (select count(*) from public.member_portal_tokens) <> 1 then raise exception 'portal link not issued'; end if;
  raise notice 'ok: confirmation and invoice messages queued and flagged as simulated';
end $$;
set local role authenticated;

-- ---------------------------------------------------------------- pauses
do $$ declare
  mid uuid := (select id from public.memberships limit 1);
  e0 date := (select end_date from public.memberships limit 1);
  r jsonb;
begin
  r := public.request_pause(mid, current_date + 3, current_date + 5, 'Travel', gen_random_uuid());
  if (select end_date from public.memberships where id = mid) <> e0 + 3
     or (select pause_days_used from public.memberships where id = mid) <> 3 or (r->>'remaining')::int <> 4 then
    raise exception '3-day pause wrong: %', r; end if;

  begin
    perform public.request_pause(mid, current_date + 5, current_date + 6, null, gen_random_uuid());
    raise exception 'overlap accepted';
  exception when raise_exception then
    if sqlerrm not like '%overlaps%' then raise; end if;
  end;

  r := public.request_pause(mid, current_date + 10, current_date + 13, null, gen_random_uuid());
  if (r->>'remaining')::int <> 0 or (select end_date from public.memberships where id = mid) <> e0 + 7 then
    raise exception '4-day pause wrong: %', r; end if;

  begin
    perform public.request_pause(mid, current_date + 20, current_date + 20, null, gen_random_uuid());
    raise exception 'pause beyond allowance accepted';
  exception when raise_exception then
    if sqlerrm not like '%0 pause day%' then raise; end if;
  end;
  raise notice 'ok: 3-day pause (+3 days, 4 left), overlap refused, 4-day pause (0 left), 8th day refused';
end $$;

do $$ begin
  update public.memberships set pause_days_used = 0;   -- no client write policy: silently 0 rows
  if (select pause_days_used from public.memberships limit 1) <> 7 then raise exception 'pause balance edited'; end if;
  raise notice 'ok: staff cannot edit pause balances directly';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true) \gset ignored_
-- second membership for idempotent + expired-pause checks
insert into public.memberships (id, gym_id, customer_id, plan_name, duration_value, duration_unit, start_date,
  original_end_date, end_date, status, pause_allowance_days, price_paise, idempotency_key)
values ('30000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
  'Monthly', 1, 'month', current_date - 60, current_date - 31, current_date - 31, 'expired', 7, 300000, gen_random_uuid());
set local role authenticated;
do $$ begin
  begin
    perform public.request_pause('30000000-0000-0000-0000-0000000000c9', current_date + 1, current_date + 2, null, gen_random_uuid());
    raise exception 'expired pause accepted';
  exception when raise_exception then
    if sqlerrm not like '%expired%' then raise; end if;
    raise notice 'ok: pauses refused for expired memberships';
  end;
end $$;

-- ---------------------------------------------------------------- dispatcher
reset role;
do $$ declare
  s text := private.secret('dispatch');
  m public.whatsapp_messages%rowtype;
  n int;
begin
  begin
    perform public.dispatch_claim('wrong-secret');
    raise exception 'bad secret accepted';
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.dispatch_claim(s, 100);
  if n < 2 then raise exception 'claim returned %', n; end if;
  for m in select * from public.whatsapp_messages where status = 'sending' loop
    perform public.dispatch_complete(s, m.id, 'simulated');
  end loop;
  if exists (select 1 from public.whatsapp_messages where status in ('sent','delivered','read')) then
    raise exception 'simulated message reported as sent'; end if;
  if (select count(*) from public.automation_executions where status = 'success'
        and detail like 'Simulated%') < 2 then raise exception 'execution log not updated'; end if;
  raise notice 'ok: dispatcher needs the secret; mock sends are recorded as simulated, never as sent';
end $$;

-- failure → retry with backoff → failed after max attempts; no duplicate on re-queue
do $$ declare
  s text := private.secret('dispatch');
  mid uuid;
begin
  mid := private.queue_message('10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
    'renewal_follow_up', '["Rahul","Gym C","Monthly","01 Jan 2027"]', 'test:fail');
  if private.queue_message('10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
    'renewal_follow_up', '["Rahul"]', 'test:fail') is not null then raise exception 'dedupe failed'; end if;
  for i in 1..3 loop
    update public.whatsapp_messages set next_attempt_at = now() where id = mid;
    perform public.dispatch_claim(s, 10, mid);
    perform public.dispatch_complete(s, mid, 'failed', null, 'Provider timeout');
  end loop;
  if (select status from public.whatsapp_messages where id = mid) <> 'failed' then
    raise exception 'not failed after max attempts'; end if;
  if (select status from public.automation_executions where message_id = mid) <> 'failed' then
    raise exception 'failure not reported'; end if;
  raise notice 'ok: duplicate automation ignored; delivery failures retried then reported as failed';
end $$;

-- ---------------------------------------------------------------- portal
do $$ declare
  tok text := encode(extensions.gen_random_bytes(32), 'hex');
  r jsonb;
  d jsonb;
  sess text;
begin
  insert into public.member_portal_tokens (gym_id, customer_id, token_hash, expires_at)
  values ('10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', private.sha256_hex(tok), now() + interval '1 day');
  r := public.portal_open('not-a-real-token');
  if (r->>'ok')::boolean then raise exception 'bogus token accepted'; end if;
  r := public.portal_open(tok);
  if not (r->>'ok')::boolean or r->>'mode' <> 'link' then raise exception 'portal open: %', r; end if;
  sess := r->>'session';
  d := public.portal_data(sess);
  if d->'customer'->>'name' <> 'Rahul Kumar' or jsonb_array_length(d->'invoices') <> 1 then
    raise exception 'portal data: %', d; end if;
  begin
    perform public.portal_data('forged-session');
    raise exception 'forged session accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.portal_invoice(sess, gen_random_uuid());
    raise exception 'foreign invoice returned';
  exception when no_data_found then null; end;
  raise notice 'ok: portal needs a valid link; sessions cannot be forged; members see only their own invoices';
end $$;

-- ---------------------------------------------------------------- analytics
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true) \gset ignored_
set local role authenticated;
do $$ declare d jsonb := public.dashboard_metrics(current_date - 30, current_date); begin
  if (d->>'collected_paise')::bigint <> 354000 then raise exception 'collected %', d->>'collected_paise'; end if;
  if (d->>'active_memberships')::int <> 1 then raise exception 'active count %', d; end if;
  raise notice 'ok: dashboard counts only recorded payments as collected revenue';
end $$;

rollback;
