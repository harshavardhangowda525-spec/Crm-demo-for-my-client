\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'o@pr.local');
insert into public.gyms (id, name) values ('10000000-0000-0000-0000-0000000000b1', 'Gym PR');
insert into public.gym_staff (gym_id, user_id, role) values ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'staff');
insert into public.customers (id, gym_id, full_name, phone_e164)
  values ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'Meera Iyer', '+919855555555');
insert into public.memberships (id, gym_id, customer_id, plan_name, duration_value, duration_unit, start_date,
  original_end_date, end_date, status, pause_allowance_days, price_paise, idempotency_key)
values ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1',
  'Monthly', 1, 'month', current_date - 5, current_date + 25, current_date + 25, 'active', 7, 200000, gen_random_uuid());
insert into public.member_sessions (customer_id, session_hash, expires_at)
  values ('20000000-0000-0000-0000-0000000000b1', private.sha256_hex('sess-b1'), now() + interval '1 hour');

-- member requests: nothing changes until staff decide
do $$ declare r jsonb; begin
  begin perform public.portal_request_pause('sess-b1', '30000000-0000-0000-0000-0000000000b1', current_date + 2, current_date + 4, '', gen_random_uuid());
    raise exception 'request without a reason accepted';
  exception when invalid_parameter_value then null; end;
  r := public.portal_request_pause('sess-b1', '30000000-0000-0000-0000-0000000000b1', current_date + 2, current_date + 4, 'Travelling for work', gen_random_uuid());
  if r->>'status' <> 'pending' then raise exception 'not pending: %', r; end if;
  if (select end_date from public.memberships where id = '30000000-0000-0000-0000-0000000000b1') <> current_date + 25 then
    raise exception 'request changed the expiry before approval'; end if;
  begin perform public.portal_request_pause('sess-b1', '30000000-0000-0000-0000-0000000000b1', current_date + 3, current_date + 5, 'Overlap', gen_random_uuid());
    raise exception 'overlapping request accepted';
  exception when raise_exception then null; end;
  begin perform public.portal_request_pause('sess-b1', '30000000-0000-0000-0000-0000000000b1', current_date + 10, current_date + 14, 'Too long', gen_random_uuid());
    raise exception 'request beyond allowance (3 pending + 5 > 7) accepted';
  exception when raise_exception then null; end;
  r := public.portal_request_pause('sess-b1', '30000000-0000-0000-0000-0000000000b1', current_date + 10, current_date + 11, 'Family function', gen_random_uuid());
  if jsonb_array_length(public.portal_data('sess-b1')->'memberships'->0->'requests') <> 2 then raise exception 'portal does not show requests'; end if;
  raise notice 'ok: members can only request a pause, with a reason; nothing changes until staff decide';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true) \gset ignored_
do $$ declare a uuid; d uuid; r jsonb; begin
  select id into a from public.pause_requests where reason = 'Travelling for work';
  select id into d from public.pause_requests where reason = 'Family function';
  r := public.decide_pause_request(a, true);
  if (select end_date from public.memberships where id = '30000000-0000-0000-0000-0000000000b1') <> current_date + 28 then
    raise exception 'approval did not extend the expiry by 3 days'; end if;
  if not exists (select 1 from public.whatsapp_messages where purpose = 'pause_confirmation') and
     not exists (select 1 from public.automation_executions where rule_key = 'pause_confirmation') then
    raise exception 'no pause confirmation queued'; end if;
  begin perform public.decide_pause_request(a, true); raise exception 'approved twice';
  exception when raise_exception then null; end;
  begin perform public.decide_pause_request(d, false, ''); raise exception 'declined without a note';
  exception when invalid_parameter_value then null; end;
  perform public.decide_pause_request(d, false, 'Those dates are our renovation week — please pick another week.');
  if (select status || '|' || decision_note from public.pause_requests where id = d) not like 'declined|Those dates%' then
    raise exception 'decline not stored'; end if;
  raise notice 'ok: staff approve (expiry extended, confirmation queued) or decline with a note';
end $$;
rollback;
