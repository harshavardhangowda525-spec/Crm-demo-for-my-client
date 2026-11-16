-- New enquiries record gender (required in the form) and age; gyms can add
-- personal trainers.

alter table public.customers
  add column if not exists age_years smallint check (age_years is null or age_years between 10 and 100);

drop function if exists public.create_customer(text,text,text,date,text,text,uuid,uuid,text,date,text,date,boolean);

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
  p_whatsapp_opt_in boolean default false,
  p_age int default null
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
  if p_age is not null and (p_age < 10 or p_age > 100) then
    raise exception 'age must be between 10 and 100' using errcode = '22023';
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
    insert into public.customers (gym_id, full_name, phone_e164, email, date_of_birth, gender, age_years, notes,
                                  assigned_staff_id, created_by)
    values (v_gym, trim(p_full_name), p_phone_e164, nullif(trim(p_email), ''), p_date_of_birth,
            p_gender, p_age, nullif(trim(p_notes), ''), p_assigned_staff_id, auth.uid())
    returning id into v_customer;
  exception when unique_violation then
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

  if p_enquiry_status <> 'not_interested' then
    perform private.queue_enquiry_thanks(v_enquiry);
  end if;

  return jsonb_build_object('status', 'created', 'customer_id', v_customer, 'enquiry_id', v_enquiry);
end $$;
revoke all on function public.create_customer(text,text,text,date,text,text,uuid,uuid,text,date,text,date,boolean,int) from public, anon;
grant execute on function public.create_customer(text,text,text,date,text,text,uuid,uuid,text,date,text,date,boolean,int) to authenticated;

-- ---------------------------------------------------------------------------
-- Personal trainers
-- ---------------------------------------------------------------------------
create table public.trainers (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  full_name        text not null check (length(trim(full_name)) between 2 and 120),
  phone_e164       text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  gender           text check (gender is null or gender in ('male','female','other')),
  kind             text not null default 'personal_trainer' check (kind in ('personal_trainer','trainer')),
  specialization   text check (specialization is null or length(specialization) <= 200),
  experience_years smallint check (experience_years is null or experience_years between 0 and 60),
  active           boolean not null default true,
  is_demo          boolean not null default false,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (gym_id, phone_e164)
);
alter table public.trainers enable row level security;
alter table public.trainers force row level security;
revoke all on public.trainers from anon;
create policy trainers_select on public.trainers for select to authenticated using (private.is_staff(gym_id));
create trigger trainers_no_gym_change before update on public.trainers
  for each row execute function private.forbid_gym_change();

create or replace function public.add_trainer(
  p_full_name text, p_phone_e164 text, p_gender text, p_kind text,
  p_specialization text default null, p_experience_years int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true); v_id uuid;
begin
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'enter the trainer''s name' using errcode = '22023'; end if;
  insert into public.trainers (gym_id, full_name, phone_e164, gender, kind, specialization, experience_years, created_by)
  values (v_gym, trim(p_full_name), nullif(p_phone_e164, ''), nullif(p_gender, ''), coalesce(nullif(p_kind, ''), 'personal_trainer'),
          nullif(trim(coalesce(p_specialization, '')), ''), p_experience_years, auth.uid())
  returning id into v_id;
  insert into public.audit_logs (gym_id, actor_user_id, action, entity_type, entity_id, after)
  values (v_gym, auth.uid(), 'trainer.add', 'trainer', v_id, jsonb_build_object('name', trim(p_full_name), 'kind', p_kind));
  return v_id;
exception when unique_violation then
  raise exception 'a trainer with this mobile number already exists' using errcode = '23505';
end $$;

create or replace function public.set_trainer_active(p_trainer_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true);
begin
  update public.trainers set active = p_active where id = p_trainer_id and gym_id = v_gym;
  if not found then raise exception 'trainer not found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.add_trainer(text,text,text,text,text,int) from public, anon;
grant execute on function public.add_trainer(text,text,text,text,text,int) to authenticated;
revoke all on function public.set_trainer_active(uuid,boolean) from public, anon;
grant execute on function public.set_trainer_active(uuid,boolean) to authenticated;
