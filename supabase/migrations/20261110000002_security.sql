-- Muscle House Gym OS — authorization, RLS, integrity triggers, audit & timeline.
--
-- Model:
--   * Staff (owner/admin/staff) authenticate with Supabase Auth. Their gym
--     membership lives in gym_staff and is resolved server-side from auth.uid();
--     a client-supplied gym_id is never trusted on its own.
--   * Financial and membership rows (memberships, pauses, invoices, payments,
--     counters, messages) have NO client write policies. They change only via
--     SECURITY DEFINER functions that validate roles and business rules.
--   * Members never get a Supabase session. The member portal is served by the
--     Next.js server with the service role, scoped to a verified member session.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function private.staff_gym_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select gs.gym_id from public.gym_staff gs
  where gs.user_id = auth.uid() and gs.active;
$$;

create or replace function private.has_role(p_gym uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gym_staff gs
    where gs.user_id = auth.uid() and gs.gym_id = p_gym and gs.active and gs.role = any(p_roles)
  );
$$;

create or replace function private.is_staff(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(p_gym, array['owner','admin','staff']);
$$;

create or replace function private.is_admin(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(p_gym, array['owner','admin']);
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- Public RPC so the app can ask "who am I in which gym" in one call.
create or replace function public.current_staff()
returns table (gym_id uuid, staff_id uuid, role text, gym_name text)
language sql stable security definer set search_path = '' as $$
  select gs.gym_id, gs.id, gs.role, g.name
  from public.gym_staff gs join public.gyms g on g.id = gs.gym_id
  where gs.user_id = auth.uid() and gs.active
  order by gs.created_at
$$;
revoke all on function public.current_staff() from public, anon;
grant execute on function public.current_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Cross-gym reference guard: any customer_id / assigned_staff_id / plan_id on
-- a row must belong to the same gym as the row itself.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_same_gym()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(new);
begin
  if r ? 'customer_id' and (r->>'customer_id') is not null then
    if not exists (select 1 from public.customers c
                   where c.id = (r->>'customer_id')::uuid and c.gym_id = new.gym_id) then
      raise exception 'customer does not belong to this gym' using errcode = '42501';
    end if;
  end if;
  if r ? 'assigned_staff_id' and (r->>'assigned_staff_id') is not null then
    if not exists (select 1 from public.gym_staff s
                   where s.id = (r->>'assigned_staff_id')::uuid and s.gym_id = new.gym_id) then
      raise exception 'staff member does not belong to this gym' using errcode = '42501';
    end if;
  end if;
  if r ? 'interested_plan_id' and (r->>'interested_plan_id') is not null then
    if not exists (select 1 from public.membership_plans p
                   where p.id = (r->>'interested_plan_id')::uuid and p.gym_id = new.gym_id) then
      raise exception 'plan does not belong to this gym' using errcode = '42501';
    end if;
  end if;
  if r ? 'enquiry_id' and (r->>'enquiry_id') is not null then
    if not exists (select 1 from public.enquiries e
                   where e.id = (r->>'enquiry_id')::uuid and e.gym_id = new.gym_id
                     and e.customer_id = (r->>'customer_id')::uuid) then
      raise exception 'enquiry does not belong to this customer' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger customers_same_gym before insert or update on public.customers
  for each row execute function private.enforce_same_gym();
create trigger enquiries_same_gym before insert or update on public.enquiries
  for each row execute function private.enforce_same_gym();
create trigger enquiry_notes_same_gym before insert or update on public.enquiry_notes
  for each row execute function private.enforce_same_gym();
create trigger notification_preferences_same_gym before insert or update on public.notification_preferences
  for each row execute function private.enforce_same_gym();

-- Rows may never move between gyms.
create or replace function private.forbid_gym_change()
returns trigger language plpgsql as $$
begin
  if new.gym_id is distinct from old.gym_id then
    raise exception 'gym_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['gym_staff','customers','enquiries','enquiry_notes','membership_plans',
    'memberships','membership_pauses','invoices','invoice_items','payments','automation_rules',
    'whatsapp_messages','automation_executions','notification_preferences']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.forbid_gym_change()',
                   t || '_no_gym_change', t);
  end loop;
end $$;

-- Staff table: protect owners and never leave a gym without an active owner.
create or replace function private.guard_gym_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  acting_is_owner boolean;
begin
  -- invariant for everyone, including the service role
  if tg_op in ('UPDATE','DELETE') and old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    if not exists (select 1 from public.gym_staff s
                   where s.gym_id = old.gym_id and s.role = 'owner' and s.active and s.id <> old.id) then
      raise exception 'a gym must keep at least one active owner';
    end if;
  end if;
  -- service role / migrations (no auth.uid()) skip the role checks below
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  acting_is_owner := private.has_role(coalesce(new.gym_id, old.gym_id), array['owner']);
  if not acting_is_owner then
    if (tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner') then
      raise exception 'only an owner can manage owner accounts' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger gym_staff_guard before insert or update or delete on public.gym_staff
  for each row execute function private.guard_gym_staff();

-- ---------------------------------------------------------------------------
-- Invoice immutability: issued invoices can only gain payments, a PDF path or
-- be cancelled (with reason). Invoices and payments are never deleted.
-- ---------------------------------------------------------------------------
create or replace function private.guard_invoice_update()
returns trigger language plpgsql as $$
begin
  if old.status = 'cancelled' then
    if (to_jsonb(new) - 'pdf_path' - 'updated_at') is distinct from (to_jsonb(old) - 'pdf_path' - 'updated_at') then
      raise exception 'cancelled invoices are immutable';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['payment_status','amount_paid_paise','pdf_path','status',
                            'cancelled_at','cancelled_reason','updated_at'])
     is distinct from
     (to_jsonb(old) - array['payment_status','amount_paid_paise','pdf_path','status',
                            'cancelled_at','cancelled_reason','updated_at']) then
    raise exception 'issued invoices cannot be edited; cancel and re-issue instead';
  end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancelled_reason), '') = '' then
    raise exception 'a cancellation reason is required';
  end if;
  return new;
end $$;
create trigger invoices_guard_update before update on public.invoices
  for each row execute function private.guard_invoice_update();

create or replace function private.forbid_delete()
returns trigger language plpgsql as $$
begin
  raise exception '% rows cannot be deleted', tg_table_name;
end $$;
create trigger invoice_items_no_delete before delete on public.invoice_items
  for each row when (current_setting('app.allow_demo_purge', true) is distinct from 'on')
  execute function private.forbid_delete();
create trigger audit_logs_no_delete before delete or update on public.audit_logs
  for each row execute function private.forbid_delete();

-- Demo data must be purgeable by the seed script; allow deletes only for
-- is_demo rows when the session explicitly opts in.
create trigger invoices_no_delete before delete on public.invoices
  for each row when (not old.is_demo or current_setting('app.allow_demo_purge', true) is distinct from 'on')
  execute function private.forbid_delete();
create trigger payments_no_delete before delete on public.payments
  for each row when (not old.is_demo or current_setting('app.allow_demo_purge', true) is distinct from 'on')
  execute function private.forbid_delete();

-- ---------------------------------------------------------------------------
-- Audit log (generic, row-level)
-- ---------------------------------------------------------------------------
create or replace function private.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_gym uuid;
begin
  v_gym := case when tg_table_name = 'gyms' then (v_row->>'id')::uuid else (v_row->>'gym_id')::uuid end;
  insert into public.audit_logs (gym_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    v_gym,
    auth.uid(),
    coalesce(nullif(current_setting('app.actor_type', true), ''), case when auth.uid() is null then 'system' else 'staff' end),
    lower(tg_op),
    tg_table_name,
    (v_row->>'id')::uuid,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['gyms','gym_staff','customers','membership_plans','memberships',
    'membership_pauses','invoices','payments','automation_rules','notification_preferences']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.write_audit()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Customer timeline events for CRM rows (memberships/invoices/payments/pauses
-- add their own events inside their RPCs, with richer details).
-- ---------------------------------------------------------------------------
create or replace function private.timeline_crm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'customers' and tg_op = 'INSERT' then
    insert into public.activity_events (gym_id, customer_id, type, title, entity_type, entity_id, actor_user_id, is_demo, occurred_at)
    values (new.gym_id, new.id, 'customer_created', 'Customer profile created', 'customer', new.id, auth.uid(), new.is_demo, new.created_at);
  elsif tg_table_name = 'enquiries' and tg_op = 'INSERT' then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, is_demo, occurred_at)
    values (new.gym_id, new.customer_id, 'enquiry_created', 'Enquiry created',
            jsonb_build_object('source', new.source, 'status', new.status, 'enquiry_date', new.enquiry_date,
                               'interested_plan_id', new.interested_plan_id, 'follow_up_date', new.follow_up_date),
            'enquiry', new.id, auth.uid(), new.is_demo, new.created_at);
  elsif tg_table_name = 'enquiries' and tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, is_demo)
      values (new.gym_id, new.customer_id, 'status_changed', 'Enquiry status changed',
              jsonb_build_object('from', old.status, 'to', new.status), 'enquiry', new.id, auth.uid(), new.is_demo);
    elsif new.follow_up_date is distinct from old.follow_up_date
       or new.interested_plan_id is distinct from old.interested_plan_id
       or new.assigned_staff_id is distinct from old.assigned_staff_id then
      insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, is_demo)
      values (new.gym_id, new.customer_id, 'enquiry_updated', 'Enquiry updated',
              jsonb_build_object('follow_up_date', new.follow_up_date, 'interested_plan_id', new.interested_plan_id),
              'enquiry', new.id, auth.uid(), new.is_demo);
    end if;
  elsif tg_table_name = 'enquiry_notes' and tg_op = 'INSERT' then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_user_id, occurred_at)
    values (new.gym_id, new.customer_id,
            case when new.kind = 'note' then 'note_added' else 'follow_up' end,
            case new.kind when 'note' then 'Note added' when 'follow_up_call' then 'Follow-up call'
                          when 'follow_up_whatsapp' then 'WhatsApp follow-up' else 'Customer visit' end,
            jsonb_build_object('body', new.body, 'kind', new.kind, 'outcome', new.outcome),
            'enquiry_note', new.id, auth.uid(), new.created_at);
  end if;
  return new;
end $$;

create trigger customers_timeline after insert on public.customers
  for each row execute function private.timeline_crm();
create trigger enquiries_timeline after insert or update on public.enquiries
  for each row execute function private.timeline_crm();
create trigger enquiry_notes_timeline after insert on public.enquiry_notes
  for each row execute function private.timeline_crm();

-- ---------------------------------------------------------------------------
-- New auth user → profile row
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['gyms','user_profiles','gym_staff','customers','membership_plans','enquiries',
    'enquiry_notes','memberships','membership_pauses','invoice_counters','invoices','invoice_items',
    'payments','automation_rules','whatsapp_messages','automation_executions','notification_preferences',
    'activity_events','audit_logs','member_portal_tokens','member_portal_otps','member_sessions','rate_limits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- gyms
create policy gyms_select on public.gyms for select to authenticated
  using (id in (select private.staff_gym_ids()));
create policy gyms_update on public.gyms for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));

-- user_profiles: self, plus colleagues in the same gym
create policy user_profiles_select on public.user_profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.gym_staff gs where gs.user_id = user_profiles.id
      and gs.gym_id in (select private.staff_gym_ids())));
create policy user_profiles_update on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- gym_staff
create policy gym_staff_select on public.gym_staff for select to authenticated
  using (gym_id in (select private.staff_gym_ids()));
create policy gym_staff_insert on public.gym_staff for insert to authenticated
  with check (private.is_admin(gym_id));
create policy gym_staff_update on public.gym_staff for update to authenticated
  using (private.is_admin(gym_id)) with check (private.is_admin(gym_id));

-- CRM tables: all staff read/write, admins delete
create policy customers_select on public.customers for select to authenticated
  using (private.is_staff(gym_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.is_staff(gym_id) and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated
  using (private.is_staff(gym_id)) with check (private.is_staff(gym_id));
create policy customers_delete on public.customers for delete to authenticated
  using (private.is_admin(gym_id));

create policy enquiries_select on public.enquiries for select to authenticated
  using (private.is_staff(gym_id));
create policy enquiries_insert on public.enquiries for insert to authenticated
  with check (private.is_staff(gym_id) and created_by = auth.uid());
create policy enquiries_update on public.enquiries for update to authenticated
  using (private.is_staff(gym_id)) with check (private.is_staff(gym_id));
create policy enquiries_delete on public.enquiries for delete to authenticated
  using (private.is_admin(gym_id));

create policy enquiry_notes_select on public.enquiry_notes for select to authenticated
  using (private.is_staff(gym_id));
create policy enquiry_notes_insert on public.enquiry_notes for insert to authenticated
  with check (private.is_staff(gym_id) and author_id = auth.uid());

create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (private.is_staff(gym_id));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (private.is_staff(gym_id));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (private.is_staff(gym_id)) with check (private.is_staff(gym_id));

-- Settings-type tables: staff read, admins write
create policy membership_plans_select on public.membership_plans for select to authenticated
  using (private.is_staff(gym_id));
create policy membership_plans_insert on public.membership_plans for insert to authenticated
  with check (private.is_admin(gym_id));
create policy membership_plans_update on public.membership_plans for update to authenticated
  using (private.is_admin(gym_id)) with check (private.is_admin(gym_id));

create policy automation_rules_select on public.automation_rules for select to authenticated
  using (private.is_staff(gym_id));
create policy automation_rules_update on public.automation_rules for update to authenticated
  using (private.is_admin(gym_id)) with check (private.is_admin(gym_id));

-- Read-only to staff; written only through SECURITY DEFINER RPCs / service role
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_staff(gym_id));
create policy membership_pauses_select on public.membership_pauses for select to authenticated
  using (private.is_staff(gym_id));
create policy invoices_select on public.invoices for select to authenticated
  using (private.is_staff(gym_id));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (private.is_staff(gym_id));
create policy payments_select on public.payments for select to authenticated
  using (private.is_staff(gym_id));
create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated
  using (private.is_staff(gym_id));
create policy automation_executions_select on public.automation_executions for select to authenticated
  using (private.is_staff(gym_id));
create policy activity_events_select on public.activity_events for select to authenticated
  using (private.is_staff(gym_id));
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.is_admin(gym_id));

-- invoice_counters, member_portal_*, member_sessions, rate_limits:
-- RLS enabled with no policies → only the service role can touch them.

-- ---------------------------------------------------------------------------
-- Storage: private buckets for logos and invoice PDFs. Objects are keyed
-- "<gym_id>/..." and readable only by that gym's staff (signed URLs for others).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 5242880, array['application/pdf']),
       ('branding', 'branding', false, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

create policy "staff read gym objects" on storage.objects for select to authenticated
  using (bucket_id in ('invoices','branding')
         and (storage.foldername(name))[1]::uuid in (select private.staff_gym_ids()));
create policy "admins upload branding" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and private.is_admin((storage.foldername(name))[1]::uuid));
create policy "admins update branding" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and private.is_admin((storage.foldername(name))[1]::uuid));
