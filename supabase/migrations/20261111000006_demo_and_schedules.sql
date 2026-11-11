-- Demo data (clearly flagged with is_demo, removable in one call) and the
-- background schedules (pg_cron + pg_net).

-- ---------------------------------------------------------------------------
-- Demo data
-- 100 customers · 25 open enquiries · 60 active memberships (10 expiring
-- within 7 days) · 15 expired · invoices, payments over 6 months, pause
-- history and simulated automation logs.
-- ---------------------------------------------------------------------------
create or replace function private.seed_demo(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  first_names text[] := array['Rahul','Priya','Arjun','Sneha','Vikram','Ananya','Karthik','Divya','Rohan','Meera',
    'Aditya','Kavya','Siddharth','Pooja','Nikhil','Ishita','Varun','Neha','Manoj','Shreya','Akash','Lakshmi',
    'Harish','Aishwarya','Suresh','Deepika','Ganesh','Nandini','Pranav','Ritu','Abhishek','Swathi','Kiran',
    'Bhavana','Naveen','Sahana','Tejas','Anjali','Vivek','Chaitra'];
  last_names text[] := array['Kumar','Sharma','Reddy','Iyer','Gowda','Nair','Rao','Patel','Menon','Shetty',
    'Hegde','Joshi','Pillai','Verma','Naidu','Kulkarni','Bhat','Das','Singh','Murthy'];
  sources text[] := array['walk_in','walk_in','walk_in','instagram','referral','google','phone','website','facebook'];
  v_today date := private.gym_today(p_gym);
  v_plans uuid[];
  v_plan public.membership_plans%rowtype;
  v_cust uuid;
  v_mem uuid;
  v_inv uuid;
  v_start date;
  v_end date;
  v_total bigint;
  v_rate numeric := (select default_gst_rate from public.gyms where id = p_gym);
  v_msg uuid;
  i int;
  k int;
begin
  if exists (select 1 from public.customers where gym_id = p_gym and is_demo) then
    raise exception 'demo data already exists — purge it first';
  end if;

  insert into public.membership_plans (gym_id, name, duration_value, duration_unit, base_price_paise, description,
                                       pause_allowance_days, sort_order, is_demo)
  values (p_gym, 'Monthly (demo)', 1, 'month', 150000, 'Full gym access for one month', 7, 1, true),
         (p_gym, 'Quarterly (demo)', 3, 'month', 400000, 'Three months, best for beginners', 7, 2, true),
         (p_gym, 'Half-yearly (demo)', 6, 'month', 750000, 'Six months with a free diet consultation', 7, 3, true),
         (p_gym, 'Annual (demo)', 12, 'month', 1300000, 'Twelve months at the best price', 7, 4, true);
  select array_agg(id order by sort_order) into v_plans from public.membership_plans where gym_id = p_gym and is_demo;

  for i in 1..100 loop
    insert into public.customers (gym_id, full_name, phone_e164, gender, is_demo, created_at)
    values (p_gym,
      first_names[1 + (i * 7) % array_length(first_names, 1)] || ' ' || last_names[1 + (i * 3) % array_length(last_names, 1)],
      '+9190000' || lpad(i::text, 5, '0'),
      case when (i * 7) % 2 = 0 then 'male' else 'female' end, true,
      now() - make_interval(days => 200 - i))
    returning id into v_cust;
    insert into public.notification_preferences (customer_id, gym_id, whatsapp_opt_in, opt_in_source, opted_in_at)
    values (v_cust, p_gym, i % 5 <> 0, 'demo', now());

    if i <= 60 then
      -- active members; 1..10 expire within the next 7 days
      v_plan := (select p from public.membership_plans p where id = v_plans[1 + i % 4]);
      if i <= 10 then
        v_end := v_today + (i - 1) % 8;
        v_start := v_end - (public.membership_end_date(v_today, v_plan.duration_value, v_plan.duration_unit) - v_today);
      else
        v_start := v_today - ((i * 5) % 25);
        v_end := public.membership_end_date(v_start, v_plan.duration_value, v_plan.duration_unit);
      end if;
    elsif i <= 75 then
      v_plan := (select p from public.membership_plans p where id = v_plans[1]);
      v_end := v_today - (i - 58);
      v_start := v_end - 29;
    else
      v_plan := null;
    end if;

    -- every customer started with an enquiry
    insert into public.enquiries (gym_id, customer_id, interested_plan_id, source, enquiry_date, status,
                                  follow_up_date, is_demo, created_at)
    values (p_gym, v_cust, v_plans[1 + i % 4], sources[1 + i % array_length(sources, 1)],
      case when i > 75 then v_today - (i - 75) else coalesce(v_start, v_today) - 3 end,
      case when i > 75 then (array['new','follow_up_pending','interested'])[1 + i % 3] else 'interested' end,
      case when i > 75 then v_today + ((i % 9) - 3) end, true,
      now() - make_interval(days => 200 - i));

    if i > 75 then
      if i % 2 = 0 then
        insert into public.enquiry_notes (gym_id, enquiry_id, customer_id, kind, outcome, body, created_at)
        select p_gym, e.id, v_cust, 'follow_up_call', 'call_back',
               'Asked about personal training and evening batch timings.', now() - interval '2 days'
        from public.enquiries e where e.customer_id = v_cust;
      end if;
      continue;
    end if;

    insert into public.memberships (gym_id, customer_id, plan_id, plan_name, duration_value, duration_unit,
      start_date, original_end_date, end_date, status, pause_allowance_days, price_paise, idempotency_key,
      is_demo, created_at)
    values (p_gym, v_cust, v_plan.id, v_plan.name, v_plan.duration_value, v_plan.duration_unit, v_start,
      v_end, v_end, case when i <= 60 then 'active' else 'expired' end, 7, v_plan.base_price_paise,
      gen_random_uuid(), true, v_start::timestamp at time zone 'Asia/Kolkata' + interval '10 hours')
    returning id into v_mem;
    update public.enquiries set status = 'converted', converted_membership_id = v_mem where customer_id = v_cust;
    perform private.add_event(p_gym, v_cust, 'membership_created', 'Membership purchased',
      jsonb_build_object('plan', v_plan.name, 'start_date', v_start, 'end_date', v_end), 'membership', v_mem,
      'staff', true);

    v_inv := private.issue_invoice(p_gym, v_cust, v_mem,
      jsonb_build_array(jsonb_build_object('description', v_plan.name || ' membership', 'quantity', 1,
        'unit_price_paise', v_plan.base_price_paise)), 0, v_rate, v_start, gen_random_uuid(), null, null, true);
    select total_paise into v_total from public.invoices where id = v_inv;
    -- 54 fully paid, 6 part-paid (outstanding) among active; expired all paid
    perform private.apply_payment(v_inv,
      case when i between 55 and 60 then v_total / 2 else v_total end,
      (array['upi','cash','card','upi','bank_transfer'])[1 + i % 5], null, gen_random_uuid(),
      v_start::timestamp at time zone 'Asia/Kolkata' + interval '11 hours', true);

    -- pause history on some active memberships (past pauses)
    if i between 20 and 35 and v_start < v_today - 10 then
      k := 1 + i % 4;
      insert into public.membership_pauses (gym_id, membership_id, start_date, end_date, status, requested_via,
        previous_end_date, new_end_date, idempotency_key, is_demo, created_at)
      values (p_gym, v_mem, v_start + 3, v_start + 2 + k, 'approved',
        case when i % 2 = 0 then 'member_portal' else 'staff' end, v_end, v_end + k, gen_random_uuid(), true,
        (v_start + 2)::timestamp);
      update public.memberships set end_date = end_date + k, pause_days_used = k where id = v_mem;
      perform private.add_event(p_gym, v_cust, 'pause_approved', 'Membership pause approved',
        jsonb_build_object('start_date', v_start + 3, 'end_date', v_start + 2 + k, 'days', k, 'remaining', 7 - k,
          'new_end_date', v_end + k), 'membership', v_mem, 'staff', true);
    end if;

    -- simulated automation log
    if i % 5 <> 0 then
      insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name,
        template_params, provider, simulated, status, attempts, dedupe_key, body_preview, sent_at, is_demo, created_at)
      values (p_gym, v_cust, '+9190000' || lpad(i::text, 5, '0'), 'membership_confirmation', 'membership_confirmation',
        '[]', 'mock', true, 'simulated', 1, 'demo:confirm:' || v_mem,
        'Welcome to the gym! Your ' || v_plan.name || ' membership is active.', now() - make_interval(days => 60 - i % 60),
        true, now() - make_interval(days => 60 - i % 60))
      returning id into v_msg;
      insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id,
        message_id, detail, is_demo, executed_at)
      values (p_gym, 'membership_confirmation', 'demo:confirm:' || v_mem, 'success', v_cust, v_mem, v_msg,
        'Simulated (mock provider) — not delivered to WhatsApp', true, now() - make_interval(days => 60 - i % 60));
    end if;
    if i in (12, 47) then
      insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name,
        template_params, provider, simulated, status, attempts, max_attempts, dedupe_key, body_preview, last_error, is_demo)
      values (p_gym, v_cust, '+9190000' || lpad(i::text, 5, '0'), 'expiry_reminder', 'expiry_reminder', '[]', 'mock',
        true, 'failed', 3, 3, 'demo:fail:' || v_mem, 'Your membership ends soon.',
        'Demo failure: recipient number not on WhatsApp', true)
      returning id into v_msg;
      insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id,
        message_id, detail, is_demo)
      values (p_gym, 'expiry_reminder', 'demo:fail:' || v_mem, 'failed', v_cust, v_mem, v_msg,
        'Demo failure: recipient number not on WhatsApp', true);
    end if;
  end loop;

  return jsonb_build_object(
    'customers', (select count(*) from public.customers where gym_id = p_gym and is_demo),
    'open_enquiries', (select count(*) from public.enquiries where gym_id = p_gym and is_demo
                         and status in ('new','follow_up_pending','interested')),
    'active_memberships', (select count(*) from public.memberships where gym_id = p_gym and is_demo and status = 'active'),
    'expiring_7_days', (select count(*) from public.memberships where gym_id = p_gym and is_demo and status = 'active'
                         and end_date between v_today and v_today + 7),
    'invoices', (select count(*) from public.invoices where gym_id = p_gym and is_demo),
    'payments', (select count(*) from public.payments where gym_id = p_gym and is_demo),
    'pauses', (select count(*) from public.membership_pauses where gym_id = p_gym and is_demo));
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
  delete from public.membership_pauses where gym_id = p_gym and is_demo;
  delete from public.memberships where gym_id = p_gym and is_demo;
  delete from public.customers where gym_id = p_gym and is_demo;   -- cascades enquiries, notes, events, prefs
  delete from public.membership_plans where gym_id = p_gym and is_demo;
  return jsonb_build_object('removed_customers', v_customers);
end $$;

-- Owner-only buttons in Settings.
create or replace function public.load_demo_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true);
begin
  if not private.has_role(v_gym, array['owner']) then
    raise exception 'only an owner can load demo data' using errcode = '42501';
  end if;
  return private.seed_demo(v_gym);
end $$;

create or replace function public.remove_demo_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gym uuid := private.require_staff(true);
begin
  if not private.has_role(v_gym, array['owner']) then
    raise exception 'only an owner can remove demo data' using errcode = '42501';
  end if;
  return private.purge_demo(v_gym);
end $$;

revoke all on function public.load_demo_data() from public, anon;
revoke all on function public.remove_demo_data() from public, anon;
grant execute on function public.load_demo_data() to authenticated;
grant execute on function public.remove_demo_data() to authenticated;
revoke execute on function private.seed_demo(uuid), private.purge_demo(uuid) from public, anon, authenticated;

-- Demo rows must be deletable by the purge: relax the invoice-items guard to
-- demo invoices only.
drop trigger invoice_items_no_delete on public.invoice_items;
create or replace function private.guard_invoice_item_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.allow_demo_purge', true) = 'on'
     and exists (select 1 from public.invoices where id = old.invoice_id and is_demo) then
    return old;
  end if;
  raise exception 'invoice_items rows cannot be deleted';
end $$;
create trigger invoice_items_no_delete before delete on public.invoice_items
  for each row execute function private.guard_invoice_item_delete();

-- Demo customers are hard-deleted on purge; allow it only for demo rows.
-- (customers_delete RLS policy still limits client deletes to admins.)

-- ---------------------------------------------------------------------------
-- Schedules (Supabase: pg_cron + pg_net). Skipped where unavailable (local tests).
-- ---------------------------------------------------------------------------
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available — schedules not created';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  -- 09:00 IST daily: refresh statuses, queue reminders/follow-ups/renewals
  perform cron.schedule('mh-daily-automations', '30 3 * * *', 'select private.run_daily_automations()');
  -- 00:05 IST daily: status refresh right after midnight (expiries, pauses)
  perform cron.schedule('mh-midnight-status', '35 18 * * *', 'select private.refresh_memberships(null)');
  -- every 5 minutes: ask the app to send queued WhatsApp messages
  perform cron.schedule('mh-dispatch', '*/5 * * * *', $job$
    select net.http_post(
      url := private.secret('app_url') || '/api/cron/dispatch',
      headers := jsonb_build_object('Authorization', 'Bearer ' || private.secret('dispatch'),
                                    'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000)
    where exists (select 1 from public.whatsapp_messages where status = 'queued' and next_attempt_at <= now())
  $job$);
  -- weekly: prune old rate-limit windows and expired portal sessions
  perform cron.schedule('mh-cleanup', '0 21 * * 0', $job$
    delete from public.rate_limits where window_start < now() - interval '1 day';
    delete from public.member_sessions where expires_at < now() - interval '7 days';
    delete from public.member_portal_otps where expires_at < now() - interval '7 days';
  $job$);
end
$outer$;
