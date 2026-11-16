\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7', 'o@tr.local'), ('00000000-0000-0000-0000-0000000000c8', 's@tr.local');
insert into public.gyms (id, name) values ('10000000-0000-0000-0000-0000000000c7', 'Gym TR');
insert into public.gym_staff (gym_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c7', 'owner'),
  ('10000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c8', 'staff');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c7', true) \gset ignored_
do $$ declare r jsonb; t uuid; begin
  r := public.create_customer('Priya Rao', '+919833333333', p_gender := 'female', p_age := 27, p_whatsapp_opt_in := true);
  if (select gender || '/' || age_years from public.customers where id = (r->>'customer_id')::uuid) <> 'female/27' then
    raise exception 'gender/age not stored'; end if;
  begin perform public.create_customer('Kid', '+919833333334', p_gender := 'male', p_age := 4); raise exception 'age 4 accepted';
  exception when invalid_parameter_value then null; end;
  t := public.add_trainer('Arjun Shetty', '+919844444444', 'male', 'personal_trainer', 'Strength & conditioning', 6);
  begin perform public.add_trainer('Arjun Again', '+919844444444', 'male', 'trainer'); raise exception 'duplicate trainer';
  exception when unique_violation then null; end;
  perform public.set_trainer_active(t, false);
  if (select active from public.trainers where id = t) then raise exception 'not deactivated'; end if;
  raise notice 'ok: enquiries store gender and age; owners add and deactivate trainers';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c8', true) \gset ignored_
do $$ begin
  begin perform public.add_trainer('Staff Added', null, 'male', 'trainer'); raise exception 'staff could add trainer';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.trainers) <> 1 then raise exception 'staff cannot see trainers'; end if;
  raise notice 'ok: only owners/admins add trainers; all staff can see them';
end $$;
rollback;
