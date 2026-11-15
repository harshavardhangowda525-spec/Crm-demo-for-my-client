\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'o@p.local');
insert into public.gyms (id, name, whatsapp_provider) values ('10000000-0000-0000-0000-0000000000d1', 'Gym P', 'meta_cloud');
select private.ensure_automation_rules('10000000-0000-0000-0000-0000000000d1');
insert into public.customers (id, gym_id, full_name, phone_e164)
  values ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'Rahul Sharma', '+919822222222');
insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in)
  values ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', true)
  on conflict (customer_id) do update set whatsapp_opt_in = true;

do $$ declare v_id uuid; m record; begin
  if private.pick_params('["a","b","c","d","e","f"]', '[1,3,5]') <> '["a","c","e"]'::jsonb then raise exception 'pick'; end if;
  if private.pick_params('["a","b"]', null) <> '["a","b"]'::jsonb then raise exception 'no map'; end if;

  v_id := private.queue_message('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'membership_confirmation',
    '["Rahul","Gym P","Quarterly","01 Nov 2026","31 Jan 2027","https://x/portal"]', 'p:1');
  select * into m from public.whatsapp_messages where id = v_id;
  if m.template_params <> '["Rahul","Quarterly","31 Jan 2027"]'::jsonb then raise exception 'params: %', m.template_params; end if;
  if m.body_preview not like 'Hi Rahul, welcome to Muscle House Gym! Your Quarterly membership is now active and valid until 31 Jan 2027.%' then
    raise exception 'body: %', m.body_preview; end if;

  v_id := private.queue_message('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'portal_link',
    '["Rahul","Gym P","https://x/p/t","30"]', 'p:2', p_require_opt_in := false);
  select * into m from public.whatsapp_messages where id = v_id;
  if m.template_params <> '["Rahul","https://x/p/t"]'::jsonb then raise exception 'portal params: %', m.template_params; end if;

  v_id := private.queue_message('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'expiry_reminder',
    '["Rahul","Quarterly","Gym P","31 Jan 2027","in 7 days"]', 'p:3');
  if (select jsonb_array_length(template_params) from public.whatsapp_messages where id = v_id) <> 5 then raise exception 'unmapped rule changed'; end if;
  raise notice 'ok: messages send exactly the variables each approved template expects';
end $$;
rollback;
