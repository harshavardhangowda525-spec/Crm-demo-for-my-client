\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'o@t.local'), ('00000000-0000-0000-0000-0000000000f2', 's@t.local');
insert into public.gyms (id, name, whatsapp_provider) values ('10000000-0000-0000-0000-0000000000f1', 'Gym T', 'meta_cloud');
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'staff');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true) \gset ignored_
do $$ declare r jsonb; begin
  begin perform public.send_whatsapp_test(); raise exception 'sent without a phone';
  exception when invalid_parameter_value then null; end;
  update public.user_profiles set phone_e164 = '+916360000000' where id = auth.uid();
  r := public.send_whatsapp_test();
  if (select template_name || '/' || template_language || '/' || status from public.whatsapp_messages
       where id = (r->>'message_id')::uuid) <> 'hello_world/en_US/queued' then raise exception 'wrong message: %', r; end if;
  raise notice 'ok: WhatsApp test queues hello_world (en_US) to the owner''s own number';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true) \gset ignored_
do $$ begin
  begin perform public.send_whatsapp_test(); raise exception 'staff could send test';
  exception when insufficient_privilege then raise notice 'ok: only owners/admins can send the test'; end;
end $$;
rollback;
