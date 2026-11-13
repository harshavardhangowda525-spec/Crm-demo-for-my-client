-- Member Memory & Owner Reminders
--   * Memory: interest/objection tags, promises, contact preferences
--   * Renewal intelligence: per-customer stats + deterministic risk flags
--   * Today feed: one prioritised list of everything that needs attention
--   * Staff reminders (tasks), snooze/done for any Today item
--   * Morning briefing / evening summary to staff over WhatsApp
--   * Member moments: enquiry thanks, birthday, anniversary, win-back
--   * Optional cached AI summary (feature-flagged, off by default)

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.customers
  add column preferred_contact_time text
    check (preferred_contact_time is null or preferred_contact_time in ('morning','afternoon','evening','any')),
  add column preferred_language text check (preferred_language is null or length(preferred_language) <= 40),
  add column ai_summary text check (ai_summary is null or length(ai_summary) <= 1200),
  add column ai_summary_at timestamptz;

alter table public.gyms add column ai_summary_enabled boolean not null default false;

alter table public.gym_staff
  add column briefing_enabled boolean not null default false,
  add column briefing_time time not null default '08:00',
  add column evening_summary_enabled boolean not null default false,
  add column evening_summary_time time not null default '20:00',
  add constraint gym_staff_briefing_time_check check (briefing_time between '05:00' and '21:00'),
  add constraint gym_staff_evening_time_check check (evening_summary_time between '05:00' and '21:00');
update public.gym_staff set briefing_enabled = true where role in ('owner','admin');

alter table public.automation_rules drop constraint automation_rules_key_check;
alter table public.automation_rules add constraint automation_rules_key_check check (key in (
  'enquiry_follow_up','membership_confirmation','invoice_delivery','expiry_reminder','pause_confirmation',
  'renewal_follow_up','enquiry_thanks','birthday','anniversary','win_back',
  'owner_daily_briefing','owner_evening_summary'));

alter table public.activity_events drop constraint activity_events_type_check;
alter table public.activity_events add constraint activity_events_type_check check (type in (
  'enquiry_created','enquiry_updated','note_added','follow_up','status_changed',
  'membership_created','membership_activated','membership_cancelled','membership_expired',
  'payment_recorded','invoice_issued','invoice_cancelled','whatsapp_message',
  'pause_approved','pause_cancelled','renewal','customer_created','customer_updated',
  'tags_updated','promise_added','promise_resolved','task_added','task_done'));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.customer_tags (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  kind       text not null check (kind in ('interest','objection')),
  label      text not null check (length(trim(label)) between 1 and 40),
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (gym_id, kind, label)
);

create table public.customer_tag_links (
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id      uuid not null references public.customer_tags(id) on delete cascade,
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (customer_id, tag_id)
);
create index customer_tag_links_tag_idx on public.customer_tag_links (tag_id);

create table public.customer_promises (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  body        text not null check (length(trim(body)) between 1 and 500),
  due_date    date,
  status      text not null default 'open' check (status in ('open','fulfilled','expired','cancelled')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  is_demo     boolean not null default false,
  check ((status = 'open') = (resolved_at is null))
);
create index customer_promises_open_idx on public.customer_promises (gym_id, due_date) where status = 'open';
create index customer_promises_customer_idx on public.customer_promises (customer_id, created_at desc);

create table public.staff_tasks (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  customer_id       uuid references public.customers(id) on delete cascade,
  title             text not null check (length(trim(title)) between 1 and 200),
  due_date          date not null,
  assigned_staff_id uuid references public.gym_staff(id) on delete set null,
  status            text not null default 'open' check (status in ('open','done')),
  done_at           timestamptz,
  done_by           uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  is_demo           boolean not null default false,
  check ((status = 'done') = (done_at is not null))
);
create index staff_tasks_open_idx on public.staff_tasks (gym_id, due_date) where status = 'open';

-- Done / snoozed state for derived Today items (keys embed the due date, so
-- the next occurrence of the same kind of reminder appears again).
create table public.today_item_states (
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  item_key   text not null check (length(item_key) <= 200),
  state      text not null check (state in ('done','snoozed')),
  until_date date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (gym_id, item_key),
  check ((state = 'snoozed') = (until_date is not null))
);

do $$
declare t text;
begin
  foreach t in array array['customer_tags','customer_tag_links','customer_promises','staff_tasks','today_item_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_staff(gym_id))', t || '_select', t);
  end loop;
end $$;
-- Tag catalogue: admins manage it directly; everything else goes through the
-- functions below (which validate and write the timeline).
create policy customer_tags_insert on public.customer_tags for insert to authenticated with check (private.is_admin(gym_id));
create policy customer_tags_update on public.customer_tags for update to authenticated
  using (private.is_admin(gym_id)) with check (private.is_admin(gym_id));

create trigger customer_promises_audit after insert or update or delete on public.customer_promises
  for each row execute function private.write_audit();
create trigger staff_tasks_audit after insert or update or delete on public.staff_tasks
  for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- Seed: tag catalogue and new automation rules for every gym
-- ---------------------------------------------------------------------------
create or replace function private.ensure_customer_tags(p_gym uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.customer_tags (gym_id, kind, label, sort_order)
  select p_gym, k, l, o from (values
    ('interest','Personal training',1), ('interest','Evening batch',2), ('interest','Morning batch',3),
    ('interest','Weight loss',4), ('interest','Muscle gain',5), ('interest','Diet plan',6),
    ('interest','Couple membership',7), ('interest','Cardio & fitness',8),
    ('objection','Price',1), ('objection','Timing',2), ('objection','Distance',3),
    ('objection','Joining later',4), ('objection','Comparing gyms',5), ('objection','Needs family approval',6)
  ) v(k, l, o)
  on conflict (gym_id, kind, label) do nothing;
$$;

create or replace function private.ensure_automation_rules(p_gym uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.automation_rules (gym_id, key, template_name, config) values
    (p_gym, 'enquiry_follow_up', 'enquiry_follow_up',
     '{"body":"Hi {{1}}, thank you for visiting {{2}}! We wanted to check whether you had any questions about our membership plans. We''d be happy to help."}'),
    (p_gym, 'membership_confirmation', 'membership_confirmation',
     '{"body":"Hi {{1}}, welcome to {{2}}! Your {{3}} membership is active from {{4}} to {{5}}. View your membership, invoices and pauses: {{6}}"}'),
    (p_gym, 'invoice_delivery', 'invoice_delivery',
     '{"body":"Hi {{1}}, here is your invoice {{2}} from {{3}} for {{4}}. Payment status: {{5}}."}'),
    (p_gym, 'expiry_reminder', 'expiry_reminder',
     '{"body":"Hi {{1}}, your {{2}} membership at {{3}} ends on {{4}} ({{5}}). Renew at the front desk to keep training without a break."}'),
    (p_gym, 'pause_confirmation', 'pause_confirmation',
     '{"body":"Hi {{1}}, your membership pause from {{2}} to {{3}} is confirmed. {{4}} pause days used, {{5}} remaining. New expiry date: {{6}}."}'),
    (p_gym, 'renewal_follow_up', 'renewal_follow_up',
     '{"body":"Hi {{1}}, we miss you at {{2}}! Your {{3}} membership ended on {{4}}. Renew today and get back on track."}'),
    (p_gym, 'enquiry_thanks', 'enquiry_thanks',
     '{"body":"Hi {{1}}, thank you for visiting {{2}} today! We have noted your interest in {{3}}. Reply here any time if you have questions."}'),
    (p_gym, 'birthday', 'birthday_wishes',
     '{"body":"Happy birthday, {{1}}! Everyone at {{2}} wishes you a strong and healthy year ahead."}'),
    (p_gym, 'anniversary', 'membership_anniversary',
     '{"body":"Hi {{1}}, today marks {{2}} since you joined {{3}}. Thank you for training with us!"}'),
    (p_gym, 'win_back', 'win_back',
     '{"body":"Hi {{1}}, it has been two weeks since your {{2}} membership at {{3}} ended. We would love to have you back. Reply to this message and we will help you restart."}'),
    (p_gym, 'owner_daily_briefing', 'owner_daily_briefing',
     '{"body":"Good morning {{1}}! Today at {{2}}: {{3}} follow-ups, {{4}} renewals due, {{5}} unpaid invoices, {{6}} birthdays. Top priorities: {{7}}. Open your Today list: {{8}}"}'),
    (p_gym, 'owner_evening_summary', 'owner_evening_summary',
     '{"body":"Hi {{1}}, today''s wrap-up: {{2}} follow-ups logged, {{3}} payments ({{4}}), {{5}} new enquiries. {{6}} items carried over to tomorrow. {{7}}"}')
  on conflict (gym_id, key) do nothing;
$$;

create or replace function private.gyms_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_automation_rules(new.id);
  perform private.ensure_customer_tags(new.id);
  return new;
end $$;

select private.ensure_automation_rules(id), private.ensure_customer_tags(id) from public.gyms;

-- Profile-edit timeline now also records contact preferences.
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
  if new.preferred_contact_time is distinct from old.preferred_contact_time then changed := array_append(changed, 'preferred contact time'); end if;
  if new.preferred_language is distinct from old.preferred_language then changed := array_append(changed, 'preferred language'); end if;
  if cardinality(changed) > 0 then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, is_demo)
    values (new.gym_id, new.id, 'customer_updated', 'Profile updated',
            jsonb_build_object('fields', to_jsonb(changed)), 'customer', new.id, auth.uid(), new.is_demo);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Memory: tags, promises, preferences
-- ---------------------------------------------------------------------------
create or replace function private.require_customer(p_gym uuid, p_customer uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.customers where id = p_customer and gym_id = p_gym) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.set_customer_tags(p_customer_id uuid, p_tag_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_ids uuid[] := coalesce(p_tag_ids, '{}');
  v_added text[];
  v_removed text[];
begin
  perform private.require_customer(v_gym, p_customer_id);
  if exists (select 1 from unnest(v_ids) t(id)
             where not exists (select 1 from public.customer_tags ct where ct.id = t.id and ct.gym_id = v_gym)) then
    raise exception 'unknown tag' using errcode = '22023';
  end if;
  select array_agg(ct.label order by ct.label) into v_removed
    from public.customer_tag_links l join public.customer_tags ct on ct.id = l.tag_id
   where l.customer_id = p_customer_id and not (l.tag_id = any(v_ids));
  select array_agg(ct.label order by ct.label) into v_added
    from public.customer_tags ct
   where ct.id = any(v_ids)
     and not exists (select 1 from public.customer_tag_links l where l.customer_id = p_customer_id and l.tag_id = ct.id);

  delete from public.customer_tag_links where customer_id = p_customer_id and not (tag_id = any(v_ids));
  insert into public.customer_tag_links (customer_id, tag_id, gym_id, created_by)
  select p_customer_id, t, v_gym, auth.uid() from unnest(v_ids) t
  on conflict do nothing;

  if v_added is not null or v_removed is not null then
    perform private.add_event(v_gym, p_customer_id, 'tags_updated', 'Interests & objections updated',
      jsonb_build_object('added', coalesce(to_jsonb(v_added), '[]'), 'removed', coalesce(to_jsonb(v_removed), '[]')),
      'customer', p_customer_id);
  end if;
end $$;

create or replace function public.set_customer_preferences(p_customer_id uuid, p_contact_time text, p_language text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  perform private.require_customer(v_gym, p_customer_id);
  update public.customers
     set preferred_contact_time = nullif(p_contact_time, ''),
         preferred_language = nullif(trim(p_language), '')
   where id = p_customer_id;
end $$;

create or replace function public.add_promise(p_customer_id uuid, p_body text, p_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_id uuid;
begin
  perform private.require_customer(v_gym, p_customer_id);
  if p_due_date is not null and p_due_date < private.gym_today(v_gym) then
    raise exception 'the promise date cannot be in the past' using errcode = '22023';
  end if;
  insert into public.customer_promises (gym_id, customer_id, body, due_date, created_by)
  values (v_gym, p_customer_id, trim(p_body), p_due_date, auth.uid())
  returning id into v_id;
  perform private.add_event(v_gym, p_customer_id, 'promise_added', 'Promise recorded',
    jsonb_build_object('body', trim(p_body), 'due_date', p_due_date), 'customer_promise', v_id);
  return v_id;
end $$;

create or replace function public.resolve_promise(p_promise_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  pr public.customer_promises%rowtype;
begin
  if p_status not in ('fulfilled','cancelled') then raise exception 'invalid status' using errcode = '22023'; end if;
  select * into pr from public.customer_promises where id = p_promise_id and gym_id = v_gym for update;
  if not found then raise exception 'promise not found' using errcode = 'P0002'; end if;
  if pr.status <> 'open' then raise exception 'this promise is already %', pr.status; end if;
  update public.customer_promises set status = p_status, resolved_by = auth.uid(), resolved_at = now() where id = pr.id;
  perform private.add_event(v_gym, pr.customer_id, 'promise_resolved',
    case p_status when 'fulfilled' then 'Promise kept' else 'Promise withdrawn' end,
    jsonb_build_object('body', pr.body, 'status', p_status), 'customer_promise', pr.id);
end $$;

-- ---------------------------------------------------------------------------
-- Staff reminders & Today item state
-- ---------------------------------------------------------------------------
create or replace function public.add_staff_task(p_customer_id uuid, p_title text, p_due_date date, p_assigned_staff_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_id uuid;
begin
  if p_customer_id is not null then perform private.require_customer(v_gym, p_customer_id); end if;
  if p_assigned_staff_id is not null
     and not exists (select 1 from public.gym_staff where id = p_assigned_staff_id and gym_id = v_gym and active) then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;
  if p_due_date is null or p_due_date < private.gym_today(v_gym) then
    raise exception 'choose today or a future date' using errcode = '22023';
  end if;
  insert into public.staff_tasks (gym_id, customer_id, title, due_date, assigned_staff_id, created_by)
  values (v_gym, p_customer_id, trim(p_title), p_due_date, p_assigned_staff_id, auth.uid())
  returning id into v_id;
  if p_customer_id is not null then
    perform private.add_event(v_gym, p_customer_id, 'task_added', 'Reminder set',
      jsonb_build_object('title', trim(p_title), 'due_date', p_due_date), 'staff_task', v_id);
  end if;
  return v_id;
end $$;

-- Done / snooze for any Today item. Tasks, promises and follow-ups update the
-- real record; other items remember the state for their key.
create or replace function public.mark_today_item(p_key text, p_action text, p_days int default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_today date := private.gym_today(v_gym);
  v_kind text := split_part(p_key, ':', 1);
  v_id uuid;
  t public.staff_tasks%rowtype;
begin
  if p_action not in ('done','snooze') then raise exception 'invalid action' using errcode = '22023'; end if;
  if p_action = 'snooze' and (p_days is null or p_days not between 1 and 30) then
    raise exception 'snooze for 1 to 30 days' using errcode = '22023';
  end if;
  if v_kind in ('task','promise','followup') then
    begin
      v_id := split_part(p_key, ':', 2)::uuid;
    exception when others then raise exception 'invalid item' using errcode = '22023';
    end;
  end if;

  if v_kind = 'task' then
    select * into t from public.staff_tasks where id = v_id and gym_id = v_gym for update;
    if not found then raise exception 'reminder not found' using errcode = 'P0002'; end if;
    if p_action = 'done' then
      update public.staff_tasks set status = 'done', done_at = now(), done_by = auth.uid() where id = t.id and status = 'open';
      if t.customer_id is not null then
        perform private.add_event(v_gym, t.customer_id, 'task_done', 'Reminder completed',
          jsonb_build_object('title', t.title), 'staff_task', t.id);
      end if;
    else
      update public.staff_tasks set due_date = v_today + p_days where id = t.id;
    end if;
    return;
  elsif v_kind = 'promise' then
    if p_action = 'done' then
      perform public.resolve_promise(v_id, 'fulfilled');
    else
      update public.customer_promises set due_date = v_today + p_days where id = v_id and gym_id = v_gym and status = 'open';
      if not found then raise exception 'promise not found' using errcode = 'P0002'; end if;
    end if;
    return;
  elsif v_kind = 'followup' and p_action = 'snooze' then
    update public.enquiries set follow_up_date = v_today + p_days
     where id = v_id and gym_id = v_gym and status in ('new','follow_up_pending','interested');
    if not found then raise exception 'enquiry not found' using errcode = 'P0002'; end if;
    return;
  end if;

  insert into public.today_item_states (gym_id, item_key, state, until_date, updated_by)
  values (v_gym, p_key, case p_action when 'done' then 'done' else 'snoozed' end,
          case when p_action = 'snooze' then v_today + p_days end, auth.uid())
  on conflict (gym_id, item_key) do update
    set state = excluded.state, until_date = excluded.until_date, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Today feed (one prioritised list with memory context for each person)
-- priority: 1 = act now, 2 = today, 3 = this week, 4 = when you have time
-- ---------------------------------------------------------------------------
create or replace function private.today_items(p_gym uuid, p_today date, p_limit int default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
with raw as (
  select 'follow_up'::text as kind, ('followup:' || e.id || ':' || e.follow_up_date)::text as key,
         case when e.follow_up_date < p_today then 1 else 2 end as priority, e.customer_id,
         case when e.follow_up_date < p_today then 'Overdue follow-up' else 'Follow-up due today' end::text as label,
         (coalesce(p.name, 'No plan chosen') || ' · enquired ' || to_char(e.enquiry_date, 'DD Mon'))::text as detail,
         ('/customers/' || e.customer_id || '?do=follow-up')::text as href, e.follow_up_date as due
    from public.enquiries e left join public.membership_plans p on p.id = e.interested_plan_id
   where e.gym_id = p_gym and e.status in ('new','follow_up_pending','interested') and e.follow_up_date <= p_today
  union all
  select 'promise', 'promise:' || pr.id, case when pr.due_date <= p_today then 1 else 3 end, pr.customer_id,
         case when pr.due_date < p_today then 'Promise overdue' when pr.due_date = p_today then 'Promise due today'
              else 'Promise due ' || to_char(pr.due_date, 'DD Mon') end,
         pr.body, '/customers/' || pr.customer_id, pr.due_date
    from public.customer_promises pr
   where pr.gym_id = p_gym and pr.status = 'open' and pr.due_date is not null and pr.due_date <= p_today + 2
  union all
  select 'task', 'task:' || t.id, case when t.due_date < p_today then 1 else 2 end, t.customer_id,
         case when t.due_date < p_today then 'Overdue reminder' else 'Reminder' end, t.title,
         case when t.customer_id is null then '/today' else '/customers/' || t.customer_id end, t.due_date
    from public.staff_tasks t where t.gym_id = p_gym and t.status = 'open' and t.due_date <= p_today
  union all
  select 'renewal', 'renewal:' || m.id || ':' || m.end_date, case when m.end_date <= p_today + 1 then 1 else 3 end, m.customer_id,
         case when m.end_date = p_today then 'Membership ends today'
              when m.end_date = p_today + 1 then 'Membership ends tomorrow'
              else 'Renewal due in ' || (m.end_date - p_today) || ' days' end,
         m.plan_name || ' · ends ' || to_char(m.end_date, 'DD Mon'),
         '/customers/' || m.customer_id || '?do=activate', m.end_date
    from public.memberships m
   where m.gym_id = p_gym and m.status in ('active','paused') and m.end_date between p_today and p_today + 7
     and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                     and n.start_date > m.start_date and n.status <> 'cancelled')
  union all
  select 'win_back', 'winback:' || m.id, 4, m.customer_id, 'Expired, not renewed',
         m.plan_name || ' ended ' || to_char(m.end_date, 'DD Mon') || ' (' || (p_today - m.end_date) || ' days ago)',
         '/customers/' || m.customer_id || '?do=activate', m.end_date
    from public.memberships m
   where m.gym_id = p_gym and m.status = 'expired' and m.end_date between p_today - 30 and p_today - 1
     and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                     and n.start_date > m.start_date and n.status <> 'cancelled')
  union all
  select 'unpaid', 'unpaid:' || i.id, 3, i.customer_id, 'Payment pending',
         i.invoice_number || ' · ₹' || to_char((i.total_paise - i.amount_paid_paise) / 100.0, 'FM99,99,99,990') || ' due',
         '/invoices/' || i.id, i.issue_date
    from public.invoices i where i.gym_id = p_gym and i.status = 'issued' and i.payment_status <> 'paid'
  union all
  select 'birthday', 'birthday:' || c.id || ':' || extract(year from p_today), 2, c.id, 'Birthday today',
         'Turns ' || date_part('year', age(p_today, c.date_of_birth))::int, '/customers/' || c.id, p_today
    from public.customers c
   where c.gym_id = p_gym and c.date_of_birth is not null
     and ((extract(month from c.date_of_birth) = extract(month from p_today) and extract(day from c.date_of_birth) = extract(day from p_today))
          or (to_char(c.date_of_birth, 'MM-DD') = '02-29' and to_char(p_today, 'MM-DD') = '02-28'
              and to_char(p_today + 1, 'MM-DD') = '03-01'))
  union all
  select 'pause_end', 'pauseend:' || pa.id, 3, m.customer_id, 'Back from pause today',
         m.plan_name || ' · paused ' || pa.days || ' days', '/customers/' || m.customer_id, pa.end_date
    from public.membership_pauses pa join public.memberships m on m.id = pa.membership_id
   where pa.gym_id = p_gym and pa.status = 'approved' and pa.end_date = p_today
),
visible as (
  select r.* from raw r
   where not exists (select 1 from public.today_item_states s
                      where s.gym_id = p_gym and s.item_key = r.key
                        and (s.state = 'done' or (s.state = 'snoozed' and s.until_date > p_today)))
   order by r.priority, r.due
   limit p_limit
)
select coalesce(jsonb_agg(jsonb_build_object(
    'kind', v.kind, 'key', v.key, 'priority', v.priority, 'label', v.label, 'detail', v.detail,
    'href', v.href, 'due', v.due,
    'customer', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.full_name,
      'phone', c.phone_e164, 'contact_time', c.preferred_contact_time, 'language', c.preferred_language) end,
    'tags', coalesce((select jsonb_agg(jsonb_build_object('label', ct.label, 'kind', ct.kind) order by ct.kind desc, ct.sort_order)
                       from public.customer_tag_links l join public.customer_tags ct on ct.id = l.tag_id
                      where l.customer_id = c.id), '[]'::jsonb),
    'promises', coalesce((select jsonb_agg(pr.body order by pr.due_date nulls last)
                           from public.customer_promises pr where pr.customer_id = c.id and pr.status = 'open'), '[]'::jsonb),
    'last_note', (select jsonb_build_object('body', n.body, 'at', n.created_at, 'kind', n.kind,
                         'by', coalesce(nullif(up.full_name, ''), 'Staff'))
                    from public.enquiry_notes n left join public.user_profiles up on up.id = n.author_id
                   where n.customer_id = c.id order by n.created_at desc limit 1)
  ) order by v.priority, v.due), '[]'::jsonb)
from visible v left join public.customers c on c.id = v.customer_id
$$;

create or replace function public.today_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  return private.today_items(v_gym, private.gym_today(v_gym));
end $$;

-- ---------------------------------------------------------------------------
-- Renewal intelligence (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.renewal_stats(p_customer_ids uuid[])
returns table (
  customer_id uuid, member_since date, terms int, renewals int, lifetime_paid_paise bigint,
  avg_days_late numeric, last_renewal_days_late int, last_plan_name text, last_plan_id uuid,
  last_price_paise bigint, last_duration_value int, last_duration_unit text, same_plan_streak int,
  current_pause_days int, longest_pause_days int, unpaid_paise bigint, latest_status text,
  latest_end_date date, risk boolean, risk_reasons text[])
language sql stable security invoker set search_path = '' as $$
with ms as (
  select m.*,
         lag(m.end_date) over (partition by m.customer_id order by m.start_date) as prev_end,
         row_number() over (partition by m.customer_id order by m.start_date desc) as rn
    from public.memberships m
   where m.customer_id = any(p_customer_ids) and m.status <> 'cancelled'
),
agg as (
  select ms.customer_id, min(ms.start_date) as member_since, count(*)::int as terms,
         (count(*) filter (where ms.prev_end is not null))::int as renewals,
         round(avg(greatest(ms.start_date - ms.prev_end - 1, 0)) filter (where ms.prev_end is not null), 1) as avg_days_late
    from ms group by ms.customer_id
),
latest as (select * from ms where rn = 1),
calc as (
  select l.*,
         (select count(*) from ms x where x.customer_id = l.customer_id and x.plan_name = l.plan_name
             and x.start_date > coalesce((select max(y.start_date) from ms y
                                           where y.customer_id = l.customer_id and y.plan_name <> l.plan_name),
                                          '-infinity'::date))::int as streak,
         coalesce((select max(pa.days) from public.membership_pauses pa
                    where pa.membership_id = l.id and pa.status = 'approved'), 0)::int as longest_pause,
         (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0)::bigint from public.invoices i
           where i.customer_id = l.customer_id and i.status = 'issued' and i.payment_status <> 'paid') as unpaid,
         case when l.prev_end is null then null else greatest(l.start_date - l.prev_end - 1, 0)::int end as late
    from latest l
)
select a.customer_id, a.member_since, a.terms, a.renewals,
       coalesce((select sum(p.amount_paise) from public.payments p join public.invoices i on i.id = p.invoice_id
                  where p.customer_id = a.customer_id and i.status = 'issued'), 0)::bigint,
       a.avg_days_late, c.late, c.plan_name, c.plan_id, (c.price_paise - c.discount_paise), c.duration_value,
       c.duration_unit, c.streak, c.pause_days_used, c.longest_pause, c.unpaid, c.status, c.end_date,
       cardinality(r.reasons) > 0, r.reasons
  from agg a join calc c on c.customer_id = a.customer_id
  cross join lateral (select array_remove(array[
      case when c.late > 3 then 'Renewed ' || c.late || ' days late last time' end,
      case when c.longest_pause >= 5 then 'Long pause this term (' || c.longest_pause || ' days)' end,
      case when c.unpaid > 0 then 'Unpaid balance' end,
      case when c.status = 'expired' then 'Expired and not renewed' end
    ], null) as reasons) r
$$;

-- ---------------------------------------------------------------------------
-- Enquiry thank-you (instant, opted-in only, never for demo rows)
-- ---------------------------------------------------------------------------
create or replace function private.queue_enquiry_thanks(p_enquiry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select e.id, e.gym_id, e.customer_id, e.is_demo, c.full_name, g.name as gym_name, p.name as plan_name
    into r
    from public.enquiries e join public.customers c on c.id = e.customer_id join public.gyms g on g.id = e.gym_id
    left join public.membership_plans p on p.id = e.interested_plan_id
   where e.id = p_enquiry;
  if r.id is null or r.is_demo then return; end if;
  perform private.queue_message(r.gym_id, r.customer_id, 'enquiry_thanks',
    jsonb_build_array(split_part(r.full_name, ' ', 1), r.gym_name, coalesce(r.plan_name, 'our membership plans')),
    'enquiry_thanks:' || r.id, 'enquiry', r.id);
end $$;

-- Returning customers already have a consent row; new customers are handled
-- inside create_customer once their consent has been stored.
create or replace function private.enquiry_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_demo and exists (select 1 from public.notification_preferences where customer_id = new.customer_id) then
    perform private.queue_enquiry_thanks(new.id);
  end if;
  return new;
end $$;
create trigger enquiries_thanks after insert on public.enquiries
  for each row execute function private.enquiry_after_insert();

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
revoke all on function public.create_customer from public, anon;
grant execute on function public.create_customer to authenticated;

-- ---------------------------------------------------------------------------
-- Staff WhatsApp messages (briefings) — no customer, staff phone from profile
-- ---------------------------------------------------------------------------
create or replace function private.queue_staff_message(p_gym uuid, p_staff uuid, p_rule text, p_params jsonb, p_dedupe text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.automation_rules%rowtype;
  v_phone text;
  v_provider text;
  v_id uuid;
begin
  select * into v_rule from public.automation_rules where gym_id = p_gym and key = p_rule;
  if not found or not v_rule.enabled then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, detail)
    values (p_gym, p_rule, p_dedupe, 'skipped', 'Automation is turned off')
    on conflict (gym_id, dedupe_key) do nothing;
    return null;
  end if;
  select up.phone_e164 into v_phone
    from public.gym_staff gs join public.user_profiles up on up.id = gs.user_id
   where gs.id = p_staff and gs.gym_id = p_gym;
  if v_phone is null then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, detail)
    values (p_gym, p_rule, p_dedupe, 'skipped', 'No WhatsApp number on the staff profile')
    on conflict (gym_id, dedupe_key) do nothing;
    return null;
  end if;
  select whatsapp_provider into v_provider from public.gyms where id = p_gym;
  insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name, template_params,
    related_entity_type, related_entity_id, provider, simulated, dedupe_key, body_preview)
  values (p_gym, null, v_phone, p_rule, v_rule.template_name, p_params, 'gym_staff', p_staff,
    v_provider, v_provider = 'mock', p_dedupe, private.render_template(v_rule.config->>'body', p_params))
  on conflict (gym_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, message_id, detail)
    values (p_gym, p_rule, p_dedupe, 'queued', v_id, 'Message queued')
    on conflict (gym_id, dedupe_key) do nothing;
  end if;
  return v_id;
end $$;

-- Builds the morning briefing parameters for one gym/day (also used by tests
-- and the "send me a test briefing" button).
create or replace function private.briefing_params(p_gym uuid, p_today date, p_first_name text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with items as (select jsonb_array_elements(private.today_items(p_gym, p_today, 500)) as it)
  select jsonb_build_array(
    p_first_name,
    (select name from public.gyms where id = p_gym),
    (select count(*) from items where it->>'kind' = 'follow_up')::text,
    (select count(*) from items where it->>'kind' = 'renewal')::text,
    (select count(*) from items where it->>'kind' = 'unpaid')::text,
    (select count(*) from items where it->>'kind' = 'birthday')::text,
    coalesce((select string_agg(x.name || ' (' || lower(x.label) || ')', '; ')
                from (select it->'customer'->>'name' as name, it->>'label' as label from items
                       where it->'customer' is not null and (it->>'priority')::int <= 2
                       order by (it->>'priority')::int, it->>'due' limit 5) x), 'nothing urgent'),
    private.secret('app_url') || '/today')
$$;

create or replace function private.evening_params(p_gym uuid, p_today date, p_first_name text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (select (p_today::timestamp at time zone 'Asia/Kolkata') as f,
                         ((p_today + 1)::timestamp at time zone 'Asia/Kolkata') as t)
  select jsonb_build_array(
    p_first_name,
    (select count(*) from public.enquiry_notes n, bounds b where n.gym_id = p_gym and n.kind <> 'note'
       and n.created_at >= b.f and n.created_at < b.t)::text,
    (select count(*) from public.payments p, bounds b where p.gym_id = p_gym and p.paid_at >= b.f and p.paid_at < b.t)::text,
    '₹' || to_char(coalesce((select sum(p.amount_paise) from public.payments p, bounds b
       where p.gym_id = p_gym and p.paid_at >= b.f and p.paid_at < b.t), 0) / 100.0, 'FM99,99,99,990'),
    (select count(*) from public.enquiries e where e.gym_id = p_gym and e.enquiry_date = p_today)::text,
    (select count(*) from jsonb_array_elements(private.today_items(p_gym, p_today, 500)) it
      where it->>'kind' in ('follow_up','task','promise') and (it->>'priority')::int <= 2)::text,
    private.secret('app_url') || '/today')
$$;

create or replace function private.run_briefings()
returns int language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_now timestamp;
  v_n int := 0;
begin
  for s in
    select gs.id, gs.gym_id, gs.briefing_enabled, gs.briefing_time, gs.evening_summary_enabled, gs.evening_summary_time,
           g.timezone, split_part(coalesce(nullif(up.full_name, ''), 'there'), ' ', 1) as first_name
      from public.gym_staff gs join public.gyms g on g.id = gs.gym_id join public.user_profiles up on up.id = gs.user_id
     where gs.active and (gs.briefing_enabled or gs.evening_summary_enabled)
  loop
    v_now := now() at time zone s.timezone;
    if s.briefing_enabled and v_now::time >= s.briefing_time and v_now::time < s.briefing_time + interval '3 hours' then
      if private.queue_staff_message(s.gym_id, s.id, 'owner_daily_briefing',
           private.briefing_params(s.gym_id, v_now::date, s.first_name),
           'briefing:' || s.id || ':' || v_now::date) is not null then v_n := v_n + 1; end if;
    end if;
    if s.evening_summary_enabled and v_now::time >= s.evening_summary_time
       and v_now::time < s.evening_summary_time + interval '3 hours' then
      if private.queue_staff_message(s.gym_id, s.id, 'owner_evening_summary',
           private.evening_params(s.gym_id, v_now::date, s.first_name),
           'evening:' || s.id || ':' || v_now::date) is not null then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.send_test_briefing()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  v_staff uuid;
  v_name text;
  v_id uuid;
begin
  select gs.id, split_part(coalesce(nullif(up.full_name, ''), 'there'), ' ', 1) into v_staff, v_name
    from public.gym_staff gs join public.user_profiles up on up.id = gs.user_id
   where gs.user_id = auth.uid() and gs.gym_id = v_gym;
  v_id := private.queue_staff_message(v_gym, v_staff, 'owner_daily_briefing',
            private.briefing_params(v_gym, private.gym_today(v_gym), v_name),
            'briefing-test:' || v_staff || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('message_id', v_id);
end $$;

create or replace function public.set_my_reminders(
  p_briefing_enabled boolean, p_briefing_time time, p_evening_enabled boolean, p_evening_time time, p_phone_e164 text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'enter a valid WhatsApp number' using errcode = '22023';
  end if;
  if (p_briefing_enabled or p_evening_enabled) and p_phone_e164 is null then
    raise exception 'add your WhatsApp number to receive briefings' using errcode = '22023';
  end if;
  if p_briefing_time not between '05:00' and '21:00' or p_evening_time not between '05:00' and '21:00' then
    raise exception 'choose a time between 5 AM and 9 PM' using errcode = '22023';
  end if;
  update public.user_profiles set phone_e164 = p_phone_e164 where id = auth.uid();
  update public.gym_staff
     set briefing_enabled = p_briefing_enabled, briefing_time = p_briefing_time,
         evening_summary_enabled = p_evening_enabled, evening_summary_time = p_evening_time
   where user_id = auth.uid() and gym_id = v_gym;
end $$;

-- ---------------------------------------------------------------------------
-- Daily automations: + birthdays, anniversaries, win-back; promise expiry
-- ---------------------------------------------------------------------------
create or replace function private.expire_promises()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    update public.customer_promises pr set status = 'expired', resolved_at = now()
      from public.gyms g
     where g.id = pr.gym_id and pr.status = 'open' and pr.due_date < private.gym_today(g.id)
    returning pr.*
  loop
    perform private.add_event(r.gym_id, r.customer_id, 'promise_resolved', 'Promise expired',
      jsonb_build_object('body', r.body, 'status', 'expired', 'due_date', r.due_date),
      'customer_promise', r.id, 'system', r.is_demo);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function private.midnight_maintenance()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return jsonb_build_object('status_changes', private.refresh_memberships(null), 'promises_expired', private.expire_promises());
end $$;

create or replace function private.run_daily_automations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g record;
  r record;
  v_today date;
  v_queued int := 0;
  v_status int := 0;
  v_off int;
  v_years int;
begin
  v_status := private.refresh_memberships(null);
  perform private.expire_promises();
  for g in select * from public.gyms loop
    v_today := private.gym_today(g.id);

    -- expiry reminders
    foreach v_off in array g.reminder_offsets loop
      for r in select m.*, c.full_name from public.memberships m join public.customers c on c.id = m.customer_id
               where m.gym_id = g.id and m.status in ('active','paused') and m.end_date = v_today + v_off
                 and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                                 and n.start_date > m.start_date and n.status <> 'cancelled')
      loop
        if private.queue_message(g.id, r.customer_id, 'expiry_reminder',
             jsonb_build_array(split_part(r.full_name, ' ', 1), r.plan_name, g.name, to_char(r.end_date, 'DD Mon YYYY'),
               case v_off when 0 then 'today' when 1 then 'tomorrow' else 'in ' || v_off || ' days' end),
             'expiry:' || r.id || ':' || r.end_date || ':' || v_off, 'membership', r.id, r.id, null, true, r.is_demo)
           is not null then v_queued := v_queued + 1; end if;
      end loop;
    end loop;

    -- enquiry follow-ups due today
    for r in select e.*, c.full_name from public.enquiries e join public.customers c on c.id = e.customer_id
             where e.gym_id = g.id and e.status in ('new','follow_up_pending','interested') and e.follow_up_date = v_today
    loop
      if private.queue_message(g.id, r.customer_id, 'enquiry_follow_up',
           jsonb_build_array(split_part(r.full_name, ' ', 1), g.name),
           'followup:' || r.id || ':' || v_today, 'enquiry', r.id, null, null, true, r.is_demo) is not null
      then v_queued := v_queued + 1; end if;
    end loop;

    -- renewal follow-up N days after expiry, and win-back at 14 days, if not renewed
    for r in select m.*, c.full_name, (v_today - m.end_date) as days_since
               from public.memberships m join public.customers c on c.id = m.customer_id
             where m.gym_id = g.id and m.status = 'expired'
               and (m.end_date = v_today - g.renewal_follow_up_days or m.end_date = v_today - 14)
               and not exists (select 1 from public.memberships n where n.customer_id = m.customer_id
                               and n.start_date > m.start_date and n.status <> 'cancelled')
    loop
      if r.days_since = 14 then
        if private.queue_message(g.id, r.customer_id, 'win_back',
             jsonb_build_array(split_part(r.full_name, ' ', 1), r.plan_name, g.name),
             'winback:' || r.id, 'membership', r.id, r.id, null, true, r.is_demo) is not null
        then v_queued := v_queued + 1; end if;
      end if;
      if r.days_since = g.renewal_follow_up_days then
        if private.queue_message(g.id, r.customer_id, 'renewal_follow_up',
             jsonb_build_array(split_part(r.full_name, ' ', 1), g.name, r.plan_name, to_char(r.end_date, 'DD Mon YYYY')),
             'renewal:' || r.id, 'membership', r.id, r.id, null, true, r.is_demo) is not null
        then v_queued := v_queued + 1; end if;
      end if;
    end loop;

    -- birthdays (29 Feb birthdays are greeted on 28 Feb in non-leap years)
    for r in select c.* from public.customers c
             where c.gym_id = g.id and c.date_of_birth is not null
               and ((extract(month from c.date_of_birth) = extract(month from v_today)
                     and extract(day from c.date_of_birth) = extract(day from v_today))
                    or (to_char(c.date_of_birth, 'MM-DD') = '02-29' and to_char(v_today, 'MM-DD') = '02-28'
                        and to_char(v_today + 1, 'MM-DD') = '03-01'))
    loop
      if private.queue_message(g.id, r.id, 'birthday', jsonb_build_array(split_part(r.full_name, ' ', 1), g.name),
           'birthday:' || r.id || ':' || extract(year from v_today), 'customer', r.id, null, null, true, r.is_demo) is not null
      then v_queued := v_queued + 1; end if;
    end loop;

    -- membership anniversaries for current members
    for r in select c.id, c.full_name, c.is_demo, min(m.start_date) as since
               from public.customers c join public.memberships m on m.customer_id = c.id and m.status <> 'cancelled'
              where c.gym_id = g.id
                and exists (select 1 from public.memberships a where a.customer_id = c.id and a.status in ('active','paused'))
              group by c.id
    loop
      v_years := date_part('year', age(v_today, r.since))::int;
      if v_years >= 1 and to_char(r.since, 'MM-DD') = to_char(v_today, 'MM-DD') then
        if private.queue_message(g.id, r.id, 'anniversary',
             jsonb_build_array(split_part(r.full_name, ' ', 1),
               v_years || case when v_years = 1 then ' year' else ' years' end, g.name),
             'anniv:' || r.id || ':' || extract(year from v_today), 'customer', r.id, null, null, true, r.is_demo) is not null
        then v_queued := v_queued + 1; end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('status_changes', v_status, 'queued', v_queued);
end $$;

-- ---------------------------------------------------------------------------
-- Optional AI summary cache
-- ---------------------------------------------------------------------------
create or replace function public.save_ai_summary(p_customer_id uuid, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff();
begin
  if not (select ai_summary_enabled from public.gyms where id = v_gym) then
    raise exception 'AI summaries are turned off for this gym' using errcode = '42501';
  end if;
  perform private.require_customer(v_gym, p_customer_id);
  update public.customers set ai_summary = left(trim(p_summary), 1200), ai_summary_at = now() where id = p_customer_id;
end $$;

-- ---------------------------------------------------------------------------
-- Demo memory data (flagged demo; removed with the demo customers)
-- ---------------------------------------------------------------------------
create or replace function private.seed_demo_memory(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.gym_today(p_gym);
  v_interests uuid[];
  v_objections uuid[];
  r record;
  i int := 0;
  promises text[] := array['10% off if he joins before the month ends', 'Free diet consultation with the quarterly plan',
                           'Trainer to call back about the evening PT slot', 'Waive the admission fee if she joins this week'];
  langs text[] := array['English','Kannada','Hindi','Tamil','Telugu'];
begin
  perform private.ensure_customer_tags(p_gym);
  select array_agg(id order by sort_order) into v_interests from public.customer_tags where gym_id = p_gym and kind = 'interest';
  select array_agg(id order by sort_order) into v_objections from public.customer_tags where gym_id = p_gym and kind = 'objection';

  for r in select c.id, c.full_name, row_number() over (order by c.phone_e164) as n
             from public.customers c where c.gym_id = p_gym and c.is_demo
  loop
    i := r.n;
    insert into public.customer_tag_links (customer_id, tag_id, gym_id)
    values (r.id, v_interests[1 + i % array_length(v_interests, 1)], p_gym),
           (r.id, v_interests[1 + (i * 3) % array_length(v_interests, 1)], p_gym)
    on conflict do nothing;
    if i > 75 or i % 4 = 0 then
      insert into public.customer_tag_links (customer_id, tag_id, gym_id)
      values (r.id, v_objections[1 + i % array_length(v_objections, 1)], p_gym) on conflict do nothing;
    end if;
    update public.customers
       set preferred_contact_time = (array['morning','afternoon','evening','any'])[1 + i % 4],
           preferred_language = langs[1 + i % array_length(langs, 1)],
           -- three members have their birthday today; the rest spread across the year
           date_of_birth = case when i in (3, 41, 88) then make_date(1990 + i % 12, extract(month from v_today)::int,
                                                                     least(extract(day from v_today)::int, 28))
                                else make_date(1985 + i % 18, 1 + i % 12, 1 + (i * 7) % 28) end
     where id = r.id;
    if i > 75 and i % 3 = 0 then
      insert into public.customer_promises (gym_id, customer_id, body, due_date, is_demo)
      values (p_gym, r.id, promises[1 + i % array_length(promises, 1)], v_today + (i % 3), true);
    end if;
    if i in (5, 22, 64, 90) then
      insert into public.staff_tasks (gym_id, customer_id, title, due_date, is_demo)
      values (p_gym, r.id, case i when 5 then 'Call about upgrading to Quarterly'
                                  when 22 then 'Check how the knee injury is healing'
                                  when 64 then 'Collect the remaining balance'
                                  else 'Show the evening batch timings' end, v_today, true);
    end if;
  end loop;
  -- make the briefing visible on the demo day: some follow-ups due today
  update public.enquiries set follow_up_date = v_today
   where gym_id = p_gym and is_demo and status in ('new','follow_up_pending','interested') and follow_up_date < v_today - 2;
  return jsonb_build_object('tagged_customers', i);
end $$;

create or replace function public.load_demo_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  v_r jsonb;
begin
  if not private.has_role(v_gym, array['owner']) then
    raise exception 'only an owner can load demo data' using errcode = '42501';
  end if;
  v_r := private.seed_demo(v_gym);
  return v_r || private.seed_demo_memory(v_gym);
end $$;

create or replace function private.purge_demo(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customers int;
begin
  perform set_config('app.allow_demo_purge', 'on', true);
  select count(*) into v_customers from public.customers where gym_id = p_gym and is_demo;
  delete from public.automation_executions where gym_id = p_gym and is_demo;
  delete from public.whatsapp_messages where gym_id = p_gym and is_demo;
  delete from public.payments where gym_id = p_gym and is_demo;
  update public.enquiries set converted_membership_id = null, status = 'interested'
   where gym_id = p_gym and is_demo and status = 'converted';
  delete from public.invoice_items where invoice_id in (select id from public.invoices where gym_id = p_gym and is_demo);
  delete from public.invoices where gym_id = p_gym and is_demo;
  delete from public.invoice_counters where gym_id = p_gym and financial_year like 'DEMO-%';
  delete from public.membership_pauses where gym_id = p_gym and is_demo;
  delete from public.memberships where gym_id = p_gym and is_demo;
  delete from public.staff_tasks where gym_id = p_gym and is_demo;
  delete from public.customer_promises where gym_id = p_gym and is_demo;
  delete from public.customers where gym_id = p_gym and is_demo;   -- cascades tags, enquiries, notes, events, prefs
  delete from public.membership_plans where gym_id = p_gym and is_demo;
  return jsonb_build_object('removed_customers', v_customers);
end $$;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mh-midnight-status', '35 18 * * *', 'select private.midnight_maintenance()');
    perform cron.schedule('mh-briefings', '*/15 * * * *', 'select private.run_briefings()');
  end if;
end
$outer$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'set_customer_tags(uuid,uuid[])', 'set_customer_preferences(uuid,text,text)', 'add_promise(uuid,text,date)',
    'resolve_promise(uuid,text)', 'add_staff_task(uuid,text,date,uuid)', 'mark_today_item(text,text,integer)',
    'today_feed()', 'renewal_stats(uuid[])', 'send_test_briefing()',
    'set_my_reminders(boolean,time,boolean,time,text)', 'save_ai_summary(uuid,text)', 'load_demo_data()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.staff_gym_ids(), private.has_role(uuid, text[]), private.is_staff(uuid),
  private.is_admin(uuid), private.caller_gym(), private.gym_today(uuid) to authenticated;
-- create_customer (SECURITY INVOKER) queues the thank-you for the enquiry it just created.
grant execute on function private.queue_enquiry_thanks(uuid) to authenticated;
