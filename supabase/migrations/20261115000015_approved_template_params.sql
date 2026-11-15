-- Match the six templates Meta approved with fewer variables.
--
-- The CRM still builds the full parameter list for each message (other code and
-- the history view rely on it); a per-rule "params" map in automation_rules.config
-- picks, in order, the 1-based positions the approved template expects. The body
-- text is the approved wording, so the history shows exactly what was sent.

create or replace function private.pick_params(p_params jsonb, p_map jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p_map is null or jsonb_typeof(p_map) <> 'array' or jsonb_array_length(p_map) = 0 then p_params
    else (select coalesce(jsonb_agg(coalesce(p_params->((i.value)::int - 1), '""'::jsonb) order by i.ordinality), '[]'::jsonb)
            from jsonb_array_elements_text(p_map) with ordinality as i)
  end
$$;

update public.automation_rules r set config = r.config || v.cfg
from (values
  ('membership_confirmation', jsonb_build_object('params', '[1,3,5]'::jsonb, 'body',
    'Hi {{1}}, welcome to Muscle House Gym! Your {{2}} membership is now active and valid until {{3}}. You can view your membership details, invoices and pause days anytime in the member portal. We look forward to training with you.')),
  ('invoice_delivery', jsonb_build_object('params', '[1,2,4]'::jsonb, 'body',
    'Hi {{1}}, thank you for your payment at Muscle House Gym. Your invoice {{2}} for {{3}} is attached to this message. Please keep it for your records and contact the front desk if you have any questions.')),
  ('pause_confirmation', jsonb_build_object('params', '[1,3,6]'::jsonb, 'body',
    'Hi {{1}}, your membership pause at Muscle House Gym is confirmed and ends on {{2}}. Your membership expiry date has been extended to {{3}}, so you do not lose any training days. We look forward to seeing you back soon!')),
  ('owner_daily_briefing', jsonb_build_object('params', '[1,3,4,5]'::jsonb, 'body',
    'Good morning {{1}}! Here is your Muscle House Gym summary for today: {{2}} follow-ups to make, {{3}} renewals due and {{4}} unpaid invoices. Open the Today page in your CRM to see the full list and your top priorities. Have a productive day!')),
  ('owner_evening_summary', jsonb_build_object('params', '[1,2,4,5]'::jsonb, 'body',
    'Hi {{1}}, here is today''s wrap-up for Muscle House Gym: {{2}} follow-ups were logged, {{3}} was collected in payments and {{4}} new enquiries came in. Open the CRM to review anything carried over to tomorrow. Have a good evening!'))
) as v(key, cfg)
where r.key = v.key;

create or replace function private.queue_message(
  p_gym uuid, p_customer uuid, p_rule text, p_params jsonb, p_dedupe text,
  p_related_type text default null, p_related_id uuid default null, p_membership uuid default null,
  p_document_path text default null, p_require_opt_in boolean default true, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.automation_rules%rowtype;
  v_phone text;
  v_opt boolean;
  v_provider text;
  v_id uuid;
  v_template text;
  v_body text;
  v_params jsonb := p_params;
begin
  if p_rule = 'portal_otp' then
    v_template := 'portal_otp';
    v_body := '{{1}} is your verification code. For your security, do not share this code.';
  elsif p_rule = 'portal_link' then
    v_template := 'portal_link';
    v_body := 'Hi {{1}}, here is your personal Muscle House Gym member portal link: {{2}} Use it to view your membership details, invoices and pause days at any time. This link is private to you, so please do not share it with anyone.';
    v_params := private.pick_params(p_params, '[1,3]'::jsonb);  -- name, link
  else
    select * into v_rule from public.automation_rules where gym_id = p_gym and key = p_rule;
    if not found or not v_rule.enabled then
      insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, detail, is_demo)
      values (p_gym, p_rule, p_dedupe, 'skipped', p_customer, p_membership, 'Automation is turned off', p_is_demo)
      on conflict (gym_id, dedupe_key) do nothing;
      return null;
    end if;
    v_template := v_rule.template_name;
    v_body := v_rule.config->>'body';
    v_params := private.pick_params(p_params, v_rule.config->'params');
  end if;

  select c.phone_e164, coalesce(np.whatsapp_opt_in, false) into v_phone, v_opt
  from public.customers c left join public.notification_preferences np on np.customer_id = c.id
  where c.id = p_customer and c.gym_id = p_gym;
  if v_phone is null then return null; end if;

  if p_require_opt_in and not v_opt then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, detail, is_demo)
    values (p_gym, p_rule, p_dedupe, 'skipped', p_customer, p_membership, 'Customer has not opted in to WhatsApp', p_is_demo)
    on conflict (gym_id, dedupe_key) do nothing;
    return null;
  end if;

  select whatsapp_provider into v_provider from public.gyms where id = p_gym;

  insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name, template_params,
    document_path, related_entity_type, related_entity_id, provider, simulated, dedupe_key, body_preview, created_by, is_demo)
  values (p_gym, p_customer, v_phone, p_rule, v_template, v_params, p_document_path, p_related_type, p_related_id,
    v_provider, v_provider = 'mock', p_dedupe, private.render_template(v_body, v_params), auth.uid(), p_is_demo)
  on conflict (gym_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and p_rule not in ('portal_otp','portal_link') then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, customer_id, membership_id, message_id, detail, is_demo)
    values (p_gym, p_rule, p_dedupe, 'queued', p_customer, p_membership, v_id, 'Message queued', p_is_demo)
    on conflict (gym_id, dedupe_key) do nothing;
  end if;
  return v_id;
end $$;
revoke execute on function private.queue_message(uuid, uuid, text, jsonb, text, text, uuid, uuid, text, boolean, boolean)
  from public, anon, authenticated;

create or replace function private.queue_staff_message(p_gym uuid, p_staff uuid, p_rule text, p_params jsonb, p_dedupe text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.automation_rules%rowtype;
  v_phone text;
  v_provider text;
  v_id uuid;
  v_params jsonb;
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
  v_params := private.pick_params(p_params, v_rule.config->'params');
  select whatsapp_provider into v_provider from public.gyms where id = p_gym;
  insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name, template_params,
    related_entity_type, related_entity_id, provider, simulated, dedupe_key, body_preview)
  values (p_gym, null, v_phone, p_rule, v_rule.template_name, v_params, 'gym_staff', p_staff,
    v_provider, v_provider = 'mock', p_dedupe, private.render_template(v_rule.config->>'body', v_params))
  on conflict (gym_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, message_id, detail)
    values (p_gym, p_rule, p_dedupe, 'queued', v_id, 'Message queued')
    on conflict (gym_id, dedupe_key) do nothing;
  end if;
  return v_id;
end $$;
revoke execute on function private.queue_staff_message(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- New gyms start with the approved wording and maps.
create or replace function private.ensure_automation_rules(p_gym uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.automation_rules (gym_id, key, template_name, config) values
    (p_gym, 'enquiry_follow_up', 'enquiry_follow_up',
     '{"body":"Hi {{1}}, thank you for visiting {{2}}! We wanted to check whether you had any questions about our membership plans. We''d be happy to help."}'),
    (p_gym, 'membership_confirmation', 'membership_confirmation',
     '{"params":[1,3,5],"body":"Hi {{1}}, welcome to Muscle House Gym! Your {{2}} membership is now active and valid until {{3}}. You can view your membership details, invoices and pause days anytime in the member portal. We look forward to training with you."}'),
    (p_gym, 'invoice_delivery', 'invoice_delivery',
     '{"params":[1,2,4],"body":"Hi {{1}}, thank you for your payment at Muscle House Gym. Your invoice {{2}} for {{3}} is attached to this message. Please keep it for your records and contact the front desk if you have any questions."}'),
    (p_gym, 'expiry_reminder', 'expiry_reminder',
     '{"body":"Hi {{1}}, your {{2}} membership at {{3}} ends on {{4}} ({{5}}). Renew at the front desk to keep training without a break."}'),
    (p_gym, 'pause_confirmation', 'pause_confirmation',
     '{"params":[1,3,6],"body":"Hi {{1}}, your membership pause at Muscle House Gym is confirmed and ends on {{2}}. Your membership expiry date has been extended to {{3}}, so you do not lose any training days. We look forward to seeing you back soon!"}'),
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
     '{"params":[1,3,4,5],"body":"Good morning {{1}}! Here is your Muscle House Gym summary for today: {{2}} follow-ups to make, {{3}} renewals due and {{4}} unpaid invoices. Open the Today page in your CRM to see the full list and your top priorities. Have a productive day!"}'),
    (p_gym, 'owner_evening_summary', 'owner_evening_summary',
     '{"params":[1,2,4,5],"body":"Hi {{1}}, here is today''s wrap-up for Muscle House Gym: {{2}} follow-ups were logged, {{3}} was collected in payments and {{4}} new enquiries came in. Open the CRM to review anything carried over to tomorrow. Have a good evening!"}')
  on conflict (gym_id, key) do nothing;
$$;
