-- Member memory, Today feed, reminders, briefings, member moments.
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner-e@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'other-e@test.local');
insert into public.gyms (id, name) values
  ('10000000-0000-0000-0000-0000000000e1', 'Gym E'),
  ('10000000-0000-0000-0000-0000000000e2', 'Gym F');
insert into public.gym_staff (id, gym_id, user_id, role, briefing_enabled) values
  ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner', true),
  ('60000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'owner', true);
update public.user_profiles set full_name = 'Arun Owner', phone_e164 = '+919811111111'
 where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.customers (id, gym_id, full_name, phone_e164, date_of_birth) values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Rahul Kumar', '+919876500001',
   make_date(1995, extract(month from current_date)::int, least(extract(day from current_date)::int, 28))),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e1', 'Priya Shah', '+919876500002',
   make_date(1996, extract(month from current_date)::int, least(extract(day from current_date)::int, 28))),
  ('20000000-0000-0000-0000-0000000000e9', '10000000-0000-0000-0000-0000000000e2', 'Other Gym', '+919876500009', null);
insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in) values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', true),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e1', false);

do $$ begin
  if (select count(*) from public.customer_tags where gym_id = '10000000-0000-0000-0000-0000000000e1') < 10 then
    raise exception 'tag catalogue not seeded'; end if;
  if (select count(*) from public.automation_rules where gym_id = '10000000-0000-0000-0000-0000000000e1') <> 12 then
    raise exception 'new automation rules not seeded'; end if;
  raise notice 'ok: new gyms get the tag catalogue and all 12 automation rules';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \gset ignored_

-- tags + timeline
do $$ declare t uuid[]; begin
  select array_agg(id) into t from (select id from public.customer_tags
    where gym_id = '10000000-0000-0000-0000-0000000000e1' and label in ('Personal training','Price') ) x;
  perform public.set_customer_tags('20000000-0000-0000-0000-0000000000e1', t);
  if (select count(*) from public.customer_tag_links where customer_id = '20000000-0000-0000-0000-0000000000e1') <> 2 then
    raise exception 'tags not linked'; end if;
  perform public.set_customer_tags('20000000-0000-0000-0000-0000000000e1', t[1:1]);
  if (select count(*) from public.customer_tag_links where customer_id = '20000000-0000-0000-0000-0000000000e1') <> 1 then
    raise exception 'tag not removed'; end if;
  if (select count(*) from public.activity_events where type = 'tags_updated') <> 2 then
    raise exception 'tag changes not on timeline'; end if;
  begin
    perform public.set_customer_tags('20000000-0000-0000-0000-0000000000e9', t);
    raise exception 'tagged a foreign customer';
  exception when no_data_found then null; end;
  raise notice 'ok: tags add/remove with timeline; other gyms'' customers refused';
end $$;

-- promises: add, show on Today when due, expire after the due date
do $$ declare pid uuid; f jsonb; begin
  pid := public.add_promise('20000000-0000-0000-0000-0000000000e1', '10% off if he joins this week', current_date);
  f := public.today_feed();
  if not exists (select 1 from jsonb_array_elements(f) it where it->>'key' = 'promise:' || pid) then
    raise exception 'due promise missing from Today'; end if;
  begin
    perform public.add_promise('20000000-0000-0000-0000-0000000000e1', 'past', current_date - 1);
    raise exception 'past-dated promise accepted';
  exception when invalid_parameter_value then null; end;
  raise notice 'ok: promise recorded and shown on Today when due';
end $$;

reset role;
do $$ begin
  update public.customer_promises set due_date = current_date - 1;
  perform private.expire_promises();
  if exists (select 1 from public.customer_promises where status = 'open') then raise exception 'promise not expired'; end if;
  if not exists (select 1 from public.activity_events where type = 'promise_resolved' and title = 'Promise expired') then
    raise exception 'expiry not on timeline'; end if;
  raise notice 'ok: promises expire the day after their date, with a timeline entry';
end $$;
set local role authenticated;

-- tasks: add, snooze moves the date, done closes it
do $$ declare tid uuid; f jsonb; begin
  tid := public.add_staff_task('20000000-0000-0000-0000-0000000000e1', 'Call about PT on Saturday', current_date, null);
  perform public.mark_today_item('task:' || tid, 'snooze', 3);
  if (select due_date from public.staff_tasks where id = tid) <> current_date + 3 then raise exception 'snooze failed'; end if;
  f := public.today_feed();
  if exists (select 1 from jsonb_array_elements(f) it where it->>'key' = 'task:' || tid) then
    raise exception 'snoozed task still on Today'; end if;
  perform public.mark_today_item('task:' || tid, 'done');
  if (select status from public.staff_tasks where id = tid) <> 'done' then raise exception 'done failed'; end if;
  raise notice 'ok: reminders snooze to a later day and complete';
end $$;

-- derived items: birthday on Today with memory context; dismiss hides it
do $$ declare f jsonb; k text; it jsonb; begin
  f := public.today_feed();
  select x into it from jsonb_array_elements(f) x
   where x->>'kind' = 'birthday' and x->'customer'->>'name' = 'Rahul Kumar';
  if it is null and extract(day from current_date) <= 28 then raise exception 'birthday missing'; end if;
  if it is not null then
    if jsonb_array_length(it->'tags') <> 1 then raise exception 'memory tags missing from Today item'; end if;
    k := it->>'key';
    perform public.mark_today_item(k, 'done');
    if exists (select 1 from jsonb_array_elements(public.today_feed()) x where x->>'key' = k) then
      raise exception 'dismissed item still shown'; end if;
  end if;
  raise notice 'ok: Today items carry memory context and can be dismissed';
end $$;

-- RLS: other gym's owner sees none of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true) \gset ignored_
do $$ begin
  if (select count(*) from public.customer_tag_links) + (select count(*) from public.customer_promises)
     + (select count(*) from public.staff_tasks) + (select count(*) from public.today_item_states) <> 0 then
    raise exception 'memory tables leak across gyms'; end if;
  if exists (select 1 from jsonb_array_elements(public.today_feed()) x where x->'customer'->>'name' = 'Rahul Kumar') then
    raise exception 'Today feed leaks across gyms'; end if;
  raise notice 'ok: memory tables and Today feed are isolated per gym';
end $$;

-- briefing: once per staff per day, needs a phone
reset role;
select set_config('request.jwt.claim.sub', '', true) \gset ignored_
do $$ declare n1 int; n2 int; begin
  update public.gym_staff set briefing_time = '05:00';
  -- run at any time of day: force the window by testing queue_staff_message directly
  perform private.queue_staff_message('10000000-0000-0000-0000-0000000000e1', '60000000-0000-0000-0000-0000000000e1',
    'owner_daily_briefing', private.briefing_params('10000000-0000-0000-0000-0000000000e1', current_date, 'Arun'),
    'briefing:60000000-0000-0000-0000-0000000000e1:' || current_date);
  perform private.queue_staff_message('10000000-0000-0000-0000-0000000000e1', '60000000-0000-0000-0000-0000000000e1',
    'owner_daily_briefing', private.briefing_params('10000000-0000-0000-0000-0000000000e1', current_date, 'Arun'),
    'briefing:60000000-0000-0000-0000-0000000000e1:' || current_date);
  select count(*) into n1 from public.whatsapp_messages where purpose = 'owner_daily_briefing';
  if n1 <> 1 then raise exception 'briefing not deduplicated (%)', n1; end if;
  if (select to_phone_e164 from public.whatsapp_messages where purpose = 'owner_daily_briefing') <> '+919811111111' then
    raise exception 'briefing sent to wrong number'; end if;
  if (select body_preview from public.whatsapp_messages where purpose = 'owner_daily_briefing') not like 'Good morning Arun!%' then
    raise exception 'briefing text wrong'; end if;
  -- the other gym's owner has no phone → skipped, not sent
  perform private.queue_staff_message('10000000-0000-0000-0000-0000000000e2', '60000000-0000-0000-0000-0000000000e2',
    'owner_daily_briefing', '[]', 'briefing:60000000-0000-0000-0000-0000000000e2:' || current_date);
  select count(*) into n2 from public.automation_executions where status = 'skipped' and detail like 'No WhatsApp number%';
  if n2 <> 1 then raise exception 'missing phone not reported'; end if;
  raise notice 'ok: one briefing per staff per day; staff without a WhatsApp number are skipped, not "sent"';
end $$;

-- member moments: birthday only for opted-in customers
do $$ begin
  perform private.run_daily_automations();
  if extract(day from current_date) <= 28 then
    if not exists (select 1 from public.whatsapp_messages where purpose = 'birthday'
                   and customer_id = '20000000-0000-0000-0000-0000000000e1') then
      raise exception 'birthday wish not queued for opted-in customer'; end if;
    if exists (select 1 from public.whatsapp_messages where purpose = 'birthday'
               and customer_id = '20000000-0000-0000-0000-0000000000e2') then
      raise exception 'birthday wish queued without consent'; end if;
  end if;
  perform private.run_daily_automations();
  if (select count(*) from public.whatsapp_messages where purpose = 'birthday') > 1 then
    raise exception 'birthday wish duplicated'; end if;
  raise notice 'ok: birthday wishes only with consent, never twice';
end $$;

-- enquiry thank-you: instant for returning opted-in customers, not for demo rows
do $$ begin
  insert into public.enquiries (gym_id, customer_id, status)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'interested');
  if not exists (select 1 from public.whatsapp_messages where purpose = 'enquiry_thanks') then
    raise exception 'thank-you not queued'; end if;
  insert into public.enquiries (gym_id, customer_id, status, is_demo)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'interested', true);
  if (select count(*) from public.whatsapp_messages where purpose = 'enquiry_thanks') <> 1 then
    raise exception 'demo enquiry triggered a message'; end if;
  raise notice 'ok: instant enquiry thank-you (opted-in, real enquiries only)';
end $$;

-- risk flags: late renewal, long pause, unpaid
insert into public.memberships (id, gym_id, customer_id, plan_name, duration_value, duration_unit, start_date,
  original_end_date, end_date, status, pause_allowance_days, pause_days_used, price_paise, idempotency_key) values
  ('30000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
   'Monthly', 1, 'month', current_date - 70, current_date - 41, current_date - 41, 'expired', 7, 0, 150000, gen_random_uuid()),
  ('30000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
   'Monthly', 1, 'month', current_date - 30, current_date - 1, current_date + 5, 'active', 7, 6, 150000, gen_random_uuid());
insert into public.membership_pauses (gym_id, membership_id, start_date, end_date, requested_via, previous_end_date,
  new_end_date, idempotency_key)
values ('10000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e2', current_date - 20, current_date - 15,
  'staff', current_date - 1, current_date + 5, gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \gset ignored_
do $$ declare s record; begin
  select * into s from public.renewal_stats(array['20000000-0000-0000-0000-0000000000e1'::uuid]);
  if s.terms <> 2 or s.renewals <> 1 or s.last_renewal_days_late <> 10 or s.same_plan_streak <> 2 then
    raise exception 'stats wrong: %', row_to_json(s); end if;
  if not s.risk or not ('Renewed 10 days late last time' = any(s.risk_reasons))
     or not exists (select 1 from unnest(s.risk_reasons) x where x like 'Long pause%') then
    raise exception 'risk flags wrong: %', s.risk_reasons; end if;
  if (select count(*) from public.renewal_stats(array['20000000-0000-0000-0000-0000000000e2'::uuid])) <> 0 then
    raise exception 'non-member should have no renewal stats'; end if;
  raise notice 'ok: renewal stats and risk flags (late renewal, long pause)';
end $$;

rollback;
