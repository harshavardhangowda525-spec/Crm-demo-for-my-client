\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'o@i.local'), ('00000000-0000-0000-0000-0000000000e2', 'x@i.local');
insert into public.gyms (id, name, whatsapp_provider, auto_reply_enabled, auto_reply_info)
  values ('10000000-0000-0000-0000-0000000000e1', 'Gym I', 'meta_cloud', true, 'Open 6 AM - 10 PM'),
         ('10000000-0000-0000-0000-0000000000e2', 'Gym Other', 'mock', false, null);
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'owner');
insert into public.customers (id, gym_id, full_name, phone_e164)
  values ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Rahul Sharma', '+919811111111');
insert into public.membership_plans (gym_id, name, duration_value, duration_unit, base_price_paise)
  values ('10000000-0000-0000-0000-0000000000e1', 'Monthly', 1, 'month', 150000);

-- webhook side: secret required; stores the message; returns member + gym context
do $$ declare s text := private.secret('dispatch'); r jsonb; r2 jsonb; begin
  begin perform public.inbox_receive('wrong', 'x', '919811111111', 'Rahul', 'wamid.1', 'hi'); raise exception 'no secret check';
  exception when insufficient_privilege then null; end;
  r := public.inbox_receive(s, 'unknown-id', '919811111111', 'Rahul', 'wamid.1', 'hi');
  if not (r->>'ok')::boolean or not (r->>'bot_enabled')::boolean or not (r->>'reply_allowed')::boolean then raise exception 'bad: %', r; end if;
  if r->'context'->'member'->>'first_name' <> 'Rahul' or r->'context'->'gym'->>'info' <> 'Open 6 AM - 10 PM'
     or jsonb_array_length(r->'context'->'plans') <> 1 then raise exception 'context: %', r->'context'; end if;
  r2 := public.inbox_receive(s, 'unknown-id', '919811111111', 'Rahul', 'wamid.1', 'hi');
  if not coalesce((r2->>'duplicate')::boolean, false) then raise exception 'Meta retries must not be stored twice'; end if;
  perform public.inbox_record_reply(s, (r->>'inbound_id')::uuid, 'menu text', 'wamid.out1', true, null, false);
  if (select count(*) from public.whatsapp_inbox where author = 'bot') <> 1 then raise exception 'reply not stored'; end if;
  raise notice 'ok: incoming messages are stored once, matched to the member, and answered by the bot';
end $$;

-- strangers get no member data; "talk to staff" hands off and silences the bot
do $$ declare s text := private.secret('dispatch'); r jsonb; begin
  r := public.inbox_receive(s, '', '917000000000', 'Unknown', 'wamid.2', 'what is my expiry');
  if r->'context'->'member' <> 'null'::jsonb then raise exception 'stranger saw member data'; end if;
  r := public.inbox_receive(s, '', '919811111111', 'Rahul', 'wamid.3', '6');
  perform public.inbox_record_reply(s, (r->>'inbound_id')::uuid, 'team will reply', 'wamid.out2', true, null, true);
  r := public.inbox_receive(s, '', '919811111111', 'Rahul', 'wamid.4', 'hello?');
  if not (r->>'handoff_active')::boolean then raise exception 'handoff not active'; end if;
  raise notice 'ok: unknown numbers see no member data; a staff handoff keeps the bot quiet';
end $$;

-- staff side: list, read, reply clears the handoff; other gyms see nothing
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \gset ignored_
do $$ declare c record; begin
  select * into c from public.inbox_conversations() where contact_phone_e164 = '+919811111111';
  if c.display_name <> 'Rahul Sharma' or not c.needs_staff or c.unread < 3 then raise exception 'conversation: %', row_to_json(c); end if;
  if not (public.inbox_window('+919811111111')->>'open')::boolean then raise exception 'window should be open'; end if;
  perform public.inbox_mark_read('+919811111111');
  perform public.inbox_record_staff_reply('+919811111111', 'Hi Rahul, how can we help?', 'wamid.out3', true);
  select * into c from public.inbox_conversations() where contact_phone_e164 = '+919811111111';
  if c.needs_staff or c.unread <> 0 or c.last_author <> 'staff' then raise exception 'after reply: %', row_to_json(c); end if;
  perform public.set_auto_reply(false, '  New timings  ');
  if (select auto_reply_enabled::text || auto_reply_info from public.gyms where id = '10000000-0000-0000-0000-0000000000e1') <> 'falseNew timings' then
    raise exception 'settings not saved'; end if;
  raise notice 'ok: staff see conversations, replies clear "needs staff", owners control the bot';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true) \gset ignored_
do $$ begin
  if exists (select 1 from public.inbox_conversations()) or exists (select 1 from public.whatsapp_inbox) then
    raise exception 'inbox leaked across gyms'; end if;
  raise notice 'ok: inbox is isolated per gym';
end $$;
rollback;
