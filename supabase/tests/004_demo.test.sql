-- Demo seed produces the specified dataset and purges cleanly.
\set ON_ERROR_STOP 1
begin;
insert into public.gyms (id, name) values ('10000000-0000-0000-0000-0000000000d1', 'Demo Gym');
do $$ declare r jsonb; begin
  r := private.seed_demo('10000000-0000-0000-0000-0000000000d1');
  if (r->>'customers')::int <> 100 or (r->>'open_enquiries')::int <> 25 or (r->>'active_memberships')::int <> 60
     or (r->>'expiring_7_days')::int < 10 or (r->>'pauses')::int < 1 then
    raise exception 'seed counts: %', r; end if;
  if exists (select 1 from public.whatsapp_messages where is_demo and status in ('sent','delivered','read')) then
    raise exception 'demo messages claim real delivery'; end if;
  raise notice 'ok: demo seed → %', r;
  r := private.purge_demo('10000000-0000-0000-0000-0000000000d1');
  if exists (select 1 from public.customers where gym_id = '10000000-0000-0000-0000-0000000000d1')
     or exists (select 1 from public.invoices where gym_id = '10000000-0000-0000-0000-0000000000d1') then
    raise exception 'purge left rows'; end if;
  raise notice 'ok: demo data purged completely';
end $$;
rollback;
