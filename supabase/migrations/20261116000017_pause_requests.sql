-- Member pause requests need staff approval.
--
-- The member portal no longer pauses a membership on its own: it records a
-- request with the member's reason. Staff approve it in the CRM (which runs the
-- normal pause: the expiry date moves and the confirmation goes on WhatsApp) or
-- decline it with a note the member sees in the portal.

alter table public.activity_events drop constraint activity_events_type_check;
alter table public.activity_events add constraint activity_events_type_check check (type in (
  'enquiry_created','enquiry_updated','note_added','follow_up','status_changed',
  'membership_created','membership_activated','membership_cancelled','membership_expired',
  'payment_recorded','invoice_issued','invoice_cancelled','whatsapp_message',
  'pause_approved','pause_cancelled','renewal','customer_created','customer_updated',
  'tags_updated','promise_added','promise_resolved','task_added','task_done',
  'pause_requested','pause_declined'));

create table public.pause_requests (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  days            int generated always as (end_date - start_date + 1) stored,
  reason          text not null check (length(trim(reason)) between 3 and 500),
  status          text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decision_note   text check (decision_note is null or length(decision_note) <= 500),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  pause_id        uuid references public.membership_pauses(id) on delete set null,
  idempotency_key uuid not null unique,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);
create index pause_requests_pending_idx on public.pause_requests (gym_id, created_at) where status = 'pending';
alter table public.pause_requests enable row level security;
alter table public.pause_requests force row level security;
revoke all on public.pause_requests from anon;
create policy pause_requests_select on public.pause_requests for select to authenticated using (private.is_staff(gym_id));
create trigger pause_requests_no_gym_change before update on public.pause_requests
  for each row execute function private.forbid_gym_change();

-- Portal: record a request (validated like a pause, but nothing changes yet).
drop function if exists public.portal_request_pause(text, uuid, date, date, uuid);
create or replace function public.portal_request_pause(p_session text, p_membership_id uuid, p_start date,
                                                       p_end date, p_reason text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.portal_customer(p_session);
  m public.memberships%rowtype;
  v_today date;
  v_days int;
  v_pending int;
  v_id uuid;
begin
  perform private.rate_limit('portal_pause:' || v_customer, 10, interval '1 hour');
  select id into v_id from public.pause_requests where idempotency_key = p_idempotency_key and customer_id = v_customer;
  if v_id is not null then return jsonb_build_object('request_id', v_id, 'status', 'pending', 'duplicate', true); end if;

  select * into m from public.memberships where id = p_membership_id and customer_id = v_customer for update;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  if m.status not in ('active','paused') then raise exception 'pauses can be requested on an active membership'; end if;
  v_today := private.gym_today(m.gym_id);
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'please tell us the reason for the pause' using errcode = '22023'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid pause period'; end if;
  if p_start < v_today then raise exception 'a pause cannot start in the past'; end if;
  if p_start > m.end_date then raise exception 'a pause must start on or before the current expiry date'; end if;
  v_days := p_end - p_start + 1;
  select coalesce(sum(days), 0) into v_pending from public.pause_requests where membership_id = m.id and status = 'pending';
  if v_days + v_pending > m.pause_allowance_days - m.pause_days_used then
    raise exception 'only % pause day(s) available (including requests waiting for approval)',
      greatest(m.pause_allowance_days - m.pause_days_used - v_pending, 0);
  end if;
  if exists (select 1 from public.pause_requests where membership_id = m.id and status = 'pending'
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]'))
     or exists (select 1 from public.membership_pauses where membership_id = m.id and status = 'approved'
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'these dates overlap an existing pause or request';
  end if;

  insert into public.pause_requests (gym_id, customer_id, membership_id, start_date, end_date, reason, idempotency_key, is_demo)
  values (m.gym_id, v_customer, m.id, p_start, p_end, trim(p_reason), p_idempotency_key, m.is_demo)
  returning id into v_id;
  perform private.add_event(m.gym_id, v_customer, 'pause_requested', 'Pause requested in the member portal',
    jsonb_build_object('start_date', p_start, 'end_date', p_end, 'days', v_days, 'reason', trim(p_reason)),
    'pause_request', v_id, 'member', m.is_demo);
  return jsonb_build_object('request_id', v_id, 'status', 'pending', 'days', v_days, 'duplicate', false);
end $$;

-- Staff: approve (runs the normal pause) or decline with a note for the member.
create or replace function public.decide_pause_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff();
  r public.pause_requests%rowtype;
  v_res jsonb;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into r from public.pause_requests where id = p_request_id and gym_id = v_gym for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'this request was already %', r.status; end if;

  if p_approve then
    perform set_config('app.actor_type', 'staff', true);
    v_res := private.do_pause(v_gym, r.membership_id, r.start_date, r.end_date, 'member_portal', r.reason, r.idempotency_key);
    update public.pause_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
      decision_note = v_note, pause_id = (v_res->>'pause_id')::uuid where id = r.id;
    return v_res || jsonb_build_object('status', 'approved');
  end if;

  if v_note is null then raise exception 'add a short reason so the member knows why' using errcode = '22023'; end if;
  update public.pause_requests set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = r.id;
  perform private.add_event(v_gym, r.customer_id, 'pause_declined', 'Pause request declined',
    jsonb_build_object('start_date', r.start_date, 'end_date', r.end_date, 'note', v_note),
    'pause_request', r.id, 'staff', r.is_demo);
  return jsonb_build_object('status', 'declined');
end $$;

revoke all on function public.portal_request_pause(text, uuid, date, date, text, uuid) from public;
grant execute on function public.portal_request_pause(text, uuid, date, date, text, uuid) to anon, authenticated;
revoke all on function public.decide_pause_request(uuid, boolean, text) from public, anon;
grant execute on function public.decide_pause_request(uuid, boolean, text) to authenticated;

-- Portal data now includes each membership's requests.
create or replace function public.portal_data(p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := private.portal_customer(p_session);
begin
  perform private.refresh_memberships((select gym_id from public.customers where id = v_customer));
  return (
    select jsonb_build_object(
      'customer', jsonb_build_object('name', c.full_name, 'phone', c.phone_e164),
      'gym', jsonb_build_object('name', g.name, 'phone', g.phone_e164, 'today', private.gym_today(g.id)),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'plan_name', m.plan_name, 'status', m.status, 'start_date', m.start_date,
          'end_date', m.end_date, 'original_end_date', m.original_end_date,
          'pause_allowance_days', m.pause_allowance_days, 'pause_days_used', m.pause_days_used,
          'pauses', coalesce((select jsonb_agg(jsonb_build_object('start_date', p.start_date, 'end_date', p.end_date,
                      'days', p.days, 'new_end_date', p.new_end_date, 'via', p.requested_via, 'created_at', p.created_at)
                      order by p.start_date) from public.membership_pauses p
                      where p.membership_id = m.id and p.status = 'approved'), '[]'::jsonb),
          'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'start_date', r.start_date, 'end_date', r.end_date,
                      'days', r.days, 'reason', r.reason, 'status', r.status, 'decision_note', r.decision_note,
                      'created_at', r.created_at, 'decided_at', r.decided_at) order by r.created_at desc)
                      from public.pause_requests r where r.membership_id = m.id), '[]'::jsonb))
          order by m.start_date desc)
        from public.memberships m where m.customer_id = c.id and m.status <> 'cancelled'), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number,
          'issue_date', i.issue_date, 'total_paise', i.total_paise, 'payment_status', i.payment_status,
          'status', i.status) order by i.issue_date desc)
        from public.invoices i where i.customer_id = c.id and i.status = 'issued'), '[]'::jsonb))
    from public.customers c join public.gyms g on g.id = c.gym_id where c.id = v_customer);
end $$;
