\set ON_ERROR_STOP 1
begin;
insert into public.gyms (id, name) values ('10000000-0000-0000-0000-0000000000a9', 'Gym PL');
select private.ensure_automation_rules('10000000-0000-0000-0000-0000000000a9');
insert into public.customers (id, gym_id, full_name, phone_e164)
  values ('20000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'Kiran Rao', '+919866666666');
insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in) values
  ('20000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', true)
  on conflict (customer_id) do update set whatsapp_opt_in = true;
insert into public.memberships (id, gym_id, customer_id, plan_name, duration_value, duration_unit, start_date,
  original_end_date, end_date, status, pause_allowance_days, price_paise, idempotency_key) values
  ('30000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9',
   'Monthly', 1, 'month', current_date, current_date + 29, current_date + 29, 'active', 7, 200000, gen_random_uuid()),
  ('30000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9',
   'Monthly', 1, 'month', current_date + 30, current_date + 59, current_date + 59, 'pending', 7, 200000, gen_random_uuid());
do $$ declare n int; begin
  perform private.queue_confirmation('30000000-0000-0000-0000-0000000000a9');
  perform private.queue_confirmation('30000000-0000-0000-0000-0000000000a9');  -- repeated: no duplicates
  perform private.queue_confirmation('30000000-0000-0000-0000-0000000000aa');  -- the renewal
  select count(*) into n from public.whatsapp_messages where customer_id = '20000000-0000-0000-0000-0000000000a9' and purpose = 'portal_link';
  if n <> 2 then raise exception 'expected one portal link per membership (2), got %', n; end if;
  if exists (select 1 from public.whatsapp_messages where purpose = 'portal_link'
             and (jsonb_array_length(template_params) <> 2 or template_params->>1 not like '%/portal/t/%')) then
    raise exception 'portal link message must carry the name and the link'; end if;
  if (select count(*) from public.whatsapp_messages where purpose = 'membership_confirmation') <> 2 then raise exception 'welcome messages'; end if;
  raise notice 'ok: every activation (joining and each renewal) sends the welcome and a fresh portal link, once';
end $$;
rollback;
