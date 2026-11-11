-- Phase 2 — CRM: customer overview, atomic customer+enquiry creation,
-- follow-up logging, and timeline events for profile edits.

-- An enquiry can only be "converted" by the membership activation flow.
alter table public.enquiries
  add constraint enquiries_converted_requires_membership
  check (status <> 'converted' or converted_membership_id is not null);

-- ---------------------------------------------------------------------------
-- customer_overview: one row per customer with their latest enquiry and
-- latest membership. Display "lifecycle" is derived here, never stored, so
-- enquiry state and membership state stay separate in the tables.
-- security_invoker → RLS of the underlying tables applies to the caller.
-- ---------------------------------------------------------------------------
create or replace view public.customer_overview
with (security_invoker = true) as
select
  c.id,
  c.gym_id,
  c.full_name,
  c.phone_e164,
  c.email,
  c.date_of_birth,
  c.gender,
  c.notes,
  c.assigned_staff_id,
  c.is_demo,
  c.created_at,
  c.updated_at,
  le.id                 as enquiry_id,
  le.status             as enquiry_status,
  le.enquiry_date       as last_enquiry_date,
  le.source             as enquiry_source,
  le.follow_up_date,
  le.interested_plan_id,
  ip.name               as interested_plan_name,
  m.id                  as membership_id,
  m.status              as membership_status,
  m.plan_name           as membership_plan_name,
  m.end_date            as membership_end_date,
  (select count(*) from public.enquiries e2
    where e2.customer_id = c.id and e2.status in ('new','follow_up_pending','interested')
      and e2.follow_up_date is not null)::int as pending_follow_ups,
  case
    when m.status in ('active','paused') then 'active_member'
    when m.status = 'expired' and (le.id is null or le.created_at < m.created_at) then 'expired_member'
    when le.status is not null then le.status
    when m.status = 'expired' then 'expired_member'
    else 'no_enquiry'
  end as lifecycle
from public.customers c
left join lateral (
  select e.* from public.enquiries e
  where e.customer_id = c.id
  order by e.enquiry_date desc, e.created_at desc
  limit 1
) le on true
left join public.membership_plans ip on ip.id = le.interested_plan_id
left join lateral (
  select mm.* from public.memberships mm
  where mm.customer_id = c.id and mm.status <> 'cancelled'
  order by (mm.status in ('active','paused')) desc, mm.start_date desc
  limit 1
) m on true;

revoke all on public.customer_overview from anon;
grant select on public.customer_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Resolve the caller's gym from auth.uid() (never from client input).
-- ---------------------------------------------------------------------------
create or replace function private.caller_gym()
returns uuid language sql stable security definer set search_path = '' as $$
  select gs.gym_id from public.gym_staff gs
  where gs.user_id = auth.uid() and gs.active
  order by gs.created_at limit 1
$$;
grant execute on function private.caller_gym() to authenticated;

-- ---------------------------------------------------------------------------
-- create_customer: inserts customer + first enquiry + messaging consent in one
-- transaction. Returns {status:'duplicate', customer_id} instead of failing
-- when the phone number already exists in the gym, so staff are sent to the
-- existing profile. SECURITY INVOKER: RLS still applies to every insert.
-- ---------------------------------------------------------------------------
create or replace function public.create_customer(
  p_full_name text,
  p_phone_e164 text,
  p_email text default null,
  p_date_of_birth date default null,
  p_gender text default null,
  p_notes text default null,
  p_assigned_staff_id uuid default null,
  p_interested_plan_id uuid default null,
  p_source text default 'walk_in',
  p_enquiry_date date default null,
  p_enquiry_status text default 'new',
  p_follow_up_date date default null,
  p_whatsapp_opt_in boolean default false
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_gym uuid := private.caller_gym();
  v_customer uuid;
  v_enquiry uuid;
begin
  if v_gym is null then
    raise exception 'not an active staff member' using errcode = '42501';
  end if;
  if p_enquiry_status not in ('new','follow_up_pending','interested','not_interested') then
    raise exception 'invalid enquiry status' using errcode = '22023';
  end if;

  select id into v_customer from public.customers
  where gym_id = v_gym and phone_e164 = p_phone_e164;
  if found then
    return jsonb_build_object('status', 'duplicate', 'customer_id', v_customer);
  end if;

  begin
    insert into public.customers (gym_id, full_name, phone_e164, email, date_of_birth, gender, notes,
                                  assigned_staff_id, created_by)
    values (v_gym, trim(p_full_name), p_phone_e164, nullif(trim(p_email), ''), p_date_of_birth,
            p_gender, nullif(trim(p_notes), ''), p_assigned_staff_id, auth.uid())
    returning id into v_customer;
  exception when unique_violation then
    -- lost a race with a concurrent insert of the same number
    select id into v_customer from public.customers where gym_id = v_gym and phone_e164 = p_phone_e164;
    return jsonb_build_object('status', 'duplicate', 'customer_id', v_customer);
  end;

  insert into public.enquiries (gym_id, customer_id, interested_plan_id, source, enquiry_date, status,
                                follow_up_date, assigned_staff_id, created_by)
  values (v_gym, v_customer, p_interested_plan_id, p_source,
          coalesce(p_enquiry_date, (now() at time zone 'Asia/Kolkata')::date),
          p_enquiry_status, p_follow_up_date, p_assigned_staff_id, auth.uid())
  returning id into v_enquiry;

  if nullif(trim(p_notes), '') is not null then
    insert into public.enquiry_notes (gym_id, enquiry_id, customer_id, kind, body, author_id)
    values (v_gym, v_enquiry, v_customer, 'note', trim(p_notes), auth.uid());
  end if;

  insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in, opt_in_source, opted_in_at)
  values (v_customer, v_gym, p_whatsapp_opt_in, case when p_whatsapp_opt_in then 'staff_recorded' end,
          case when p_whatsapp_opt_in then now() end);

  return jsonb_build_object('status', 'created', 'customer_id', v_customer, 'enquiry_id', v_enquiry);
end $$;
revoke all on function public.create_customer from public, anon;
grant execute on function public.create_customer to authenticated;

-- ---------------------------------------------------------------------------
-- log_follow_up: records the attempt and (optionally) moves the enquiry on,
-- atomically.
-- ---------------------------------------------------------------------------
create or replace function public.log_follow_up(
  p_enquiry_id uuid,
  p_kind text,
  p_outcome text,
  p_body text,
  p_next_follow_up_date date default null,
  p_new_status text default null
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e public.enquiries%rowtype;
begin
  select * into e from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if e.status = 'converted' then
    raise exception 'enquiry is already converted' using errcode = '22023';
  end if;
  if p_new_status is not null and p_new_status not in ('new','follow_up_pending','interested','not_interested') then
    raise exception 'invalid enquiry status' using errcode = '22023';
  end if;

  insert into public.enquiry_notes (gym_id, enquiry_id, customer_id, kind, outcome, body, author_id)
  values (e.gym_id, e.id, e.customer_id, p_kind, p_outcome, p_body, auth.uid());

  update public.enquiries
     set status = coalesce(p_new_status, status),
         follow_up_date = case when coalesce(p_new_status, status) = 'not_interested' then null
                               else p_next_follow_up_date end
   where id = e.id;
end $$;
revoke all on function public.log_follow_up from public, anon;
grant execute on function public.log_follow_up to authenticated;

-- ---------------------------------------------------------------------------
-- Timeline: record profile edits (which fields changed, not their values —
-- the audit log keeps full before/after for admins).
-- ---------------------------------------------------------------------------
create or replace function private.timeline_customer_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  changed text[] := array[]::text[];
begin
  if new.full_name is distinct from old.full_name then changed := array_append(changed, 'name'); end if;
  if new.phone_e164 is distinct from old.phone_e164 then changed := array_append(changed, 'mobile number'); end if;
  if new.email is distinct from old.email then changed := array_append(changed, 'email'); end if;
  if new.date_of_birth is distinct from old.date_of_birth then changed := array_append(changed, 'date of birth'); end if;
  if new.gender is distinct from old.gender then changed := array_append(changed, 'gender'); end if;
  if new.assigned_staff_id is distinct from old.assigned_staff_id then changed := array_append(changed, 'assigned staff'); end if;
  if new.notes is distinct from old.notes then changed := array_append(changed, 'profile notes'); end if;
  if cardinality(changed) > 0 then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, is_demo)
    values (new.gym_id, new.id, 'customer_updated', 'Profile updated',
            jsonb_build_object('fields', to_jsonb(changed)), 'customer', new.id, auth.uid(), new.is_demo);
  end if;
  return new;
end $$;
create trigger customers_timeline_update after update on public.customers
  for each row execute function private.timeline_customer_update();
