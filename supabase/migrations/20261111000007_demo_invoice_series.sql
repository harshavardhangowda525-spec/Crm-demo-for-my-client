-- Demo invoices use their own number series ("MH/DEMO-2026-27/0001") so they
-- never consume — or leave gaps in — the gym's real GST invoice sequence.

alter table public.invoice_counters drop constraint invoice_counters_financial_year_check;
alter table public.invoice_counters add constraint invoice_counters_financial_year_check
  check (financial_year ~ '^(DEMO-)?[0-9]{4}-[0-9]{2}$');

create or replace function private.issue_invoice(
  p_gym uuid, p_customer uuid, p_membership uuid, p_items jsonb, p_discount bigint,
  p_gst_rate numeric, p_issue_date date, p_key uuid, p_replaces uuid default null,
  p_notes text default null, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  g public.gyms%rowtype;
  c public.customers%rowtype;
  v_subtotal bigint;
  v_taxable bigint;
  v_tax record;
  v_fy text := case when p_is_demo then 'DEMO-' else '' end || private.financial_year(p_issue_date);
  v_seq int;
  v_id uuid;
  it jsonb;
begin
  select * into g from public.gyms where id = p_gym;
  select * into c from public.customers where id = p_customer and gym_id = p_gym;
  if c.id is null then raise exception 'customer not found'; end if;

  select coalesce(sum((x->>'unit_price_paise')::bigint * coalesce((x->>'quantity')::int, 1)), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  if p_discount < 0 or p_discount > v_subtotal then raise exception 'discount must be between 0 and the subtotal'; end if;
  v_taxable := v_subtotal - p_discount;
  select * into v_tax from public.gst_breakdown(v_taxable, case when g.gst_enabled then p_gst_rate else 0 end);

  -- row-locked upsert: concurrent invoices get consecutive, unique numbers
  insert into public.invoice_counters (gym_id, financial_year, last_value) values (p_gym, v_fy, 1)
  on conflict (gym_id, financial_year) do update set last_value = public.invoice_counters.last_value + 1
  returning last_value into v_seq;

  insert into public.invoices (gym_id, customer_id, membership_id, invoice_number, financial_year, sequence_no,
    issue_date, subtotal_paise, discount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise,
    total_paise, customer_snapshot, gym_snapshot, idempotency_key, replaces_invoice_id, notes, created_by, is_demo)
  values (p_gym, p_customer, p_membership, g.invoice_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0'),
    v_fy, v_seq, p_issue_date, v_subtotal, p_discount, v_taxable,
    case when g.gst_enabled then p_gst_rate else 0 end, v_tax.cgst, v_tax.sgst, 0,
    v_taxable + v_tax.total_tax,
    jsonb_build_object('name', c.full_name, 'phone', c.phone_e164, 'email', c.email),
    jsonb_build_object('name', g.name, 'legal_name', g.legal_name, 'address_line1', g.address_line1,
      'address_line2', g.address_line2, 'city', g.city, 'state', g.state, 'state_code', g.state_code,
      'postal_code', g.postal_code, 'gstin', g.gstin, 'phone', g.phone_e164, 'email', g.email,
      'sac_code', g.sac_code, 'gst_enabled', g.gst_enabled),
    p_key, p_replaces, p_notes, auth.uid(), p_is_demo)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.invoice_items (gym_id, invoice_id, description, sac_code, quantity, unit_price_paise, amount_paise)
    values (p_gym, v_id, it->>'description', g.sac_code, coalesce((it->>'quantity')::int, 1),
            (it->>'unit_price_paise')::bigint,
            (it->>'unit_price_paise')::bigint * coalesce((it->>'quantity')::int, 1));
  end loop;

  perform private.add_event(p_gym, p_customer, 'invoice_issued', 'Invoice issued',
    jsonb_build_object('invoice_id', v_id, 'number', (select invoice_number from public.invoices where id = v_id),
                       'total_paise', v_taxable + v_tax.total_tax), 'invoice', v_id, 'staff', p_is_demo);
  return v_id;
end $$;

-- Purge also resets the demo number series.
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
  delete from public.customers where gym_id = p_gym and is_demo;   -- cascades enquiries, notes, events, prefs
  delete from public.membership_plans where gym_id = p_gym and is_demo;
  return jsonb_build_object('removed_customers', v_customers);
end $$;

revoke execute on function private.issue_invoice(uuid, uuid, uuid, jsonb, bigint, numeric, date, uuid, uuid, text, boolean),
  private.purge_demo(uuid) from public, anon, authenticated;
