-- CRM tests: duplicate detection, phone search, enquiry lifecycle, follow-ups.
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'staff@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'other@test.local');
insert into public.gyms (id, name) values
  ('10000000-0000-0000-0000-0000000000a1', 'Gym A'),
  ('10000000-0000-0000-0000-0000000000b1', 'Gym B');
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'owner');
insert into public.membership_plans (id, gym_id, name, duration_value, duration_unit, base_price_paise) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Quarterly', 3, 'month', 750000),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'B plan', 1, 'month', 100000);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true) \gset ignored_

-- 1. create customer + enquiry atomically
create temp table r as
select public.create_customer(
  p_full_name => 'Rahul Kumar', p_phone_e164 => '+919876543210',
  p_interested_plan_id => '50000000-0000-0000-0000-0000000000a1',
  p_source => 'walk_in', p_enquiry_date => '2026-11-10', p_enquiry_status => 'interested',
  p_follow_up_date => '2026-11-17', p_notes => 'Asked about personal training and evening availability.',
  p_whatsapp_opt_in => true) as res;
do $$ declare v jsonb := (select res from r); begin
  if v->>'status' <> 'created' then raise exception 'expected created, got %', v; end if;
  if (select count(*) from public.enquiries) <> 1 then raise exception 'enquiry not created'; end if;
  if (select count(*) from public.enquiry_notes) <> 1 then raise exception 'initial note missing'; end if;
  if not (select whatsapp_opt_in from public.notification_preferences) then raise exception 'consent not stored'; end if;
  if (select gym_id from public.customers) <> '10000000-0000-0000-0000-0000000000a1' then
    raise exception 'gym not derived from caller'; end if;
  raise notice 'ok: customer, enquiry, note and consent created together';
end $$;

-- 2. duplicate phone returns the existing profile instead of creating one
do $$ declare v jsonb; begin
  v := public.create_customer(p_full_name => 'Rahul K', p_phone_e164 => '+919876543210');
  if v->>'status' <> 'duplicate' or (v->>'customer_id')::uuid <> (select id from public.customers) then
    raise exception 'duplicate not detected: %', v; end if;
  if (select count(*) from public.customers) <> 1 or (select count(*) from public.enquiries) <> 1 then
    raise exception 'duplicate created rows'; end if;
  raise notice 'ok: duplicate phone returns existing customer';
end $$;

-- 3. phone prefix search finds the returning customer with enquiry context
do $$ declare o record; begin
  select * into o from public.customer_overview where phone_e164 like '+9198765%';
  if o.full_name <> 'Rahul Kumar' or o.lifecycle <> 'interested' or o.interested_plan_name <> 'Quarterly'
     or o.last_enquiry_date <> '2026-11-10' or o.pending_follow_ups <> 1 then
    raise exception 'overview wrong: %', row_to_json(o); end if;
  raise notice 'ok: phone prefix search returns status, plan, last enquiry and pending follow-ups';
end $$;

-- 4. invalid status rejected; converted cannot be set manually
do $$ begin
  begin
    perform public.create_customer(p_full_name => 'X', p_phone_e164 => '+919000000002', p_enquiry_status => 'converted');
    raise exception 'converted accepted at creation';
  exception when invalid_parameter_value then null; end;
  begin
    update public.enquiries set status = 'converted';
    raise exception 'manual conversion accepted';
  exception when check_violation then null; end;
  raise notice 'ok: conversion only via membership activation';
end $$;

-- 5. cannot reference another gym's plan
do $$ begin
  begin
    perform public.create_customer(p_full_name => 'Y', p_phone_e164 => '+919000000003',
      p_interested_plan_id => '50000000-0000-0000-0000-0000000000b1');
    raise exception 'foreign plan accepted';
  exception when insufficient_privilege then
    if exists (select 1 from public.customers where phone_e164 = '+919000000003') then
      raise exception 'partial insert left behind'; end if;
    raise notice 'ok: foreign plan rejected and whole creation rolled back';
  end;
end $$;

-- 6. follow-up logging moves the enquiry and writes the timeline
do $$ declare eid uuid := (select id from public.enquiries limit 1); begin
  perform public.log_follow_up(eid, 'follow_up_call', 'call_back', 'Will visit on Saturday', '2026-11-21', 'follow_up_pending');
  if (select status from public.enquiries where id = eid) <> 'follow_up_pending'
     or (select follow_up_date from public.enquiries where id = eid) <> '2026-11-21' then
    raise exception 'enquiry not updated'; end if;
  if not exists (select 1 from public.activity_events where type = 'follow_up') then raise exception 'follow-up event missing'; end if;
  if not exists (select 1 from public.activity_events where type = 'status_changed') then raise exception 'status event missing'; end if;
  perform public.log_follow_up(eid, 'follow_up_call', 'not_interested', 'Joined another gym', '2026-12-01', 'not_interested');
  if (select follow_up_date from public.enquiries where id = eid) is not null then
    raise exception 'follow-up date should clear when not interested'; end if;
  raise notice 'ok: follow-ups update status, schedule and timeline';
end $$;

-- 7. profile edits are recorded on the timeline
do $$ begin
  update public.customers set email = 'rahul@example.com';
  if not exists (select 1 from public.activity_events where type = 'customer_updated'
                 and details->'fields' ? 'email') then raise exception 'edit event missing'; end if;
  raise notice 'ok: profile edit recorded on timeline';
end $$;

-- 8. other gym's staff cannot see this customer through the view
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true) \gset ignored_
do $$ begin
  if (select count(*) from public.customer_overview) <> 0 then raise exception 'view leaks across gyms'; end if;
  raise notice 'ok: customer_overview respects RLS';
end $$;

rollback;
