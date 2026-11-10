-- Security & integrity tests. Run with: npm run test:db
-- Each block raises an exception on failure; success prints "ok".
\set ON_ERROR_STOP 1
begin;

-- Fixtures (as superuser / service role)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'nobody@test.local');
insert into public.gyms (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Gym A'),
  ('10000000-0000-0000-0000-00000000000b', 'Gym B');
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'staff'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'owner');
insert into public.customers (id, gym_id, full_name, phone_e164) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Rahul Kumar', '+919876543210'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Other Gym Member', '+919000000001');

-- profiles were auto-created by the auth trigger
do $$ begin
  if (select count(*) from public.user_profiles) <> 4 then raise exception 'profile trigger failed'; end if;
  raise notice 'ok: auth trigger creates profiles';
end $$;

-- duplicate phone within a gym is rejected
do $$ begin
  begin
    insert into public.customers (gym_id, full_name, phone_e164)
    values ('10000000-0000-0000-0000-00000000000a', 'Dup', '+919876543210');
    raise exception 'duplicate phone accepted';
  exception when unique_violation then raise notice 'ok: duplicate phone rejected';
  end;
end $$;

-- non-E.164 phone rejected
do $$ begin
  begin
    insert into public.customers (gym_id, full_name, phone_e164)
    values ('10000000-0000-0000-0000-00000000000a', 'Bad', '98765 43210');
    raise exception 'bad phone accepted';
  exception when check_violation then raise notice 'ok: non-E.164 phone rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Act as Gym A staff
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true) \gset ignored_

do $$ begin
  if (select count(*) from public.customers) <> 1 then raise exception 'staff sees other gyms'' customers'; end if;
  if (select count(*) from public.gyms) <> 1 then raise exception 'staff sees other gyms'; end if;
  raise notice 'ok: tenant isolation on select';
end $$;

do $$ begin
  begin
    insert into public.customers (gym_id, full_name, phone_e164, created_by)
    values ('10000000-0000-0000-0000-00000000000b', 'Intruder', '+919111111111', auth.uid());
    raise exception 'insert into foreign gym accepted';
  exception when insufficient_privilege then raise notice 'ok: cannot insert into another gym';
  end;
end $$;

-- cross-gym reference: enquiry in own gym pointing at foreign customer
do $$ begin
  begin
    insert into public.enquiries (gym_id, customer_id, created_by)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', auth.uid());
    raise exception 'cross-gym customer reference accepted';
  exception when insufficient_privilege then raise notice 'ok: cross-gym reference rejected';
  end;
end $$;

-- staff may create an enquiry; timeline event is recorded
insert into public.enquiries (gym_id, customer_id, created_by, status)
values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', auth.uid(), 'interested');
do $$ begin
  if not exists (select 1 from public.activity_events where type = 'enquiry_created') then
    raise exception 'timeline event missing'; end if;
  raise notice 'ok: enquiry creates timeline event';
end $$;

-- staff cannot write membership plans (admin only)
do $$ begin
  begin
    insert into public.membership_plans (gym_id, name, duration_value, duration_unit, base_price_paise)
    values ('10000000-0000-0000-0000-00000000000a', 'Hack', 1, 'month', 1);
    raise exception 'staff created a plan';
  exception when insufficient_privilege then raise notice 'ok: staff cannot create plans';
  end;
end $$;

-- staff cannot write memberships/invoices directly
do $$ begin
  begin
    insert into public.payments (gym_id, invoice_id, customer_id, amount_paise, method, idempotency_key)
    values ('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), '20000000-0000-0000-0000-00000000000a', 100, 'cash', gen_random_uuid());
    raise exception 'direct payment insert accepted';
  exception when insufficient_privilege then raise notice 'ok: no direct payment writes';
  end;
end $$;

-- staff cannot read audit logs or portal tables
do $$ begin
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'staff can read audit logs'; end if;
  if (select count(*) from public.member_sessions) <> 0 then raise exception 'portal sessions visible'; end if;
  raise notice 'ok: audit/portal tables hidden from staff';
end $$;

-- staff cannot promote themselves
do $$ begin
  update public.gym_staff set role = 'owner' where user_id = auth.uid();
  if exists (select 1 from public.gym_staff where user_id = auth.uid() and role = 'owner') then
    raise exception 'staff promoted self'; end if;
  raise notice 'ok: staff cannot change roles';
end $$;

-- ---------------------------------------------------------------------------
-- Unrelated authenticated user sees nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true) \gset ignored_
do $$ begin
  if (select count(*) from public.customers) + (select count(*) from public.gyms) <> 0 then
    raise exception 'outsider sees data'; end if;
  raise notice 'ok: outsider sees nothing';
end $$;

-- anon has no table privileges at all
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.customers;
    raise exception 'anon can read customers';
  exception when insufficient_privilege then raise notice 'ok: anon denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Owner protection (service-role context: no JWT subject)
reset role;
select set_config('request.jwt.claim.sub', '', true) \gset ignored_
do $$ begin
  begin
    update public.gym_staff set role = 'admin'
    where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'last owner demoted';
  exception when raise_exception then
    if sqlerrm not like '%at least one active owner%' then raise; end if;
    raise notice 'ok: last owner cannot be demoted';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Invoice immutability & pause overlap (service role context)
insert into public.memberships (id, gym_id, customer_id, plan_name, duration_value, duration_unit,
  start_date, original_end_date, end_date, status, pause_allowance_days, price_paise, idempotency_key)
values ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-00000000000a', 'Monthly', 1, 'month',
  '2026-11-10', '2026-12-09', '2026-12-09', 'active', 7, 300000, gen_random_uuid());

insert into public.membership_pauses (gym_id, membership_id, start_date, end_date, requested_via,
  previous_end_date, new_end_date, idempotency_key)
values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '2026-11-15', '2026-11-17', 'staff', '2026-12-09', '2026-12-12', gen_random_uuid());
do $$ begin
  begin
    insert into public.membership_pauses (gym_id, membership_id, start_date, end_date, requested_via,
      previous_end_date, new_end_date, idempotency_key)
    values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
      '2026-11-17', '2026-11-18', 'staff', '2026-12-12', '2026-12-14', gen_random_uuid());
    raise exception 'overlapping pause accepted';
  exception when exclusion_violation then raise notice 'ok: overlapping pause rejected';
  end;
end $$;

do $$ begin
  begin
    update public.memberships set pause_days_used = 8 where id = '30000000-0000-0000-0000-00000000000a';
    raise exception 'pause allowance exceeded';
  exception when check_violation then raise notice 'ok: pause allowance capped';
  end;
end $$;

insert into public.invoices (id, gym_id, customer_id, invoice_number, financial_year, sequence_no, issue_date,
  subtotal_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, total_paise,
  customer_snapshot, gym_snapshot, idempotency_key)
values ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-00000000000a', 'MH/2026-27/0001', '2026-27', 1, '2026-11-10',
  300000, 300000, 18, 27000, 27000, 354000, '{}', '{}', gen_random_uuid());
do $$ begin
  begin
    update public.invoices set total_paise = 1 where id = '40000000-0000-0000-0000-00000000000a';
    raise exception 'issued invoice edited';
  exception when raise_exception or check_violation then raise notice 'ok: issued invoice is immutable';
  end;
  begin
    delete from public.invoices where id = '40000000-0000-0000-0000-00000000000a';
    raise exception 'invoice deleted';
  exception when raise_exception then raise notice 'ok: invoice cannot be deleted';
  end;
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Wrong plan'
    where id = '40000000-0000-0000-0000-00000000000a';
  if not exists (select 1 from public.audit_logs where entity_type = 'invoices' and action = 'update') then
    raise exception 'cancellation not audited'; end if;
  raise notice 'ok: cancellation allowed with reason and audited';
end $$;

rollback;
