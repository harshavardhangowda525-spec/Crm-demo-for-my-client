-- Template wording accepted by Meta. Meta rejects templates that end with a
-- variable (a trailing period still counts), so these bodies now end with
-- fixed text. Variable order is unchanged, so no sending code changes.

update public.automation_rules set config = jsonb_set(config, '{body}', to_jsonb(v.body))
from (values
  ('owner_daily_briefing', 'Good morning {{1}}! Here is today’s summary for {{2}}: {{3}} follow-ups, {{4}} renewals due, {{5}} unpaid invoices and {{6}} birthdays. Top priorities: {{7}}. Open your Today list here: {{8}} Have a productive day!'),
  ('membership_confirmation', 'Hi {{1}}, welcome to {{2}}! Your {{3}} membership is active from {{4}} to {{5}}. View your membership, invoices and pauses here: {{6}} We look forward to training with you.'),
  ('invoice_delivery', 'Hi {{1}}, here is your invoice {{2}} from {{3}} for {{4}}. Payment status: {{5}}. Thank you for being a member.'),
  ('pause_confirmation', 'Hi {{1}}, your membership pause from {{2}} to {{3}} is confirmed. {{4}} pause days used, {{5}} remaining. Your new expiry date is {{6}}. See you back soon!'),
  ('owner_evening_summary', 'Hi {{1}}, here is today’s wrap-up: {{2}} follow-ups logged, {{3}} payments ({{4}}) and {{5}} new enquiries. {{6}} items were carried over to tomorrow. View details here: {{7}} Have a good evening!')
) as v(key, body)
where public.automation_rules.key = v.key;

-- New gyms get the same wording.
create or replace function private.ensure_automation_rules(p_gym uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.automation_rules (gym_id, key, template_name, config) values
    (p_gym, 'enquiry_follow_up', 'enquiry_follow_up',
     '{"body":"Hi {{1}}, thank you for visiting {{2}}! We wanted to check whether you had any questions about our membership plans. We''d be happy to help."}'),
    (p_gym, 'membership_confirmation', 'membership_confirmation',
     '{"body":"Hi {{1}}, welcome to {{2}}! Your {{3}} membership is active from {{4}} to {{5}}. View your membership, invoices and pauses here: {{6}} We look forward to training with you."}'),
    (p_gym, 'invoice_delivery', 'invoice_delivery',
     '{"body":"Hi {{1}}, here is your invoice {{2}} from {{3}} for {{4}}. Payment status: {{5}}. Thank you for being a member."}'),
    (p_gym, 'expiry_reminder', 'expiry_reminder',
     '{"body":"Hi {{1}}, your {{2}} membership at {{3}} ends on {{4}} ({{5}}). Renew at the front desk to keep training without a break."}'),
    (p_gym, 'pause_confirmation', 'pause_confirmation',
     '{"body":"Hi {{1}}, your membership pause from {{2}} to {{3}} is confirmed. {{4}} pause days used, {{5}} remaining. Your new expiry date is {{6}}. See you back soon!"}'),
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
     '{"body":"Good morning {{1}}! Here is today’s summary for {{2}}: {{3}} follow-ups, {{4}} renewals due, {{5}} unpaid invoices and {{6}} birthdays. Top priorities: {{7}}. Open your Today list here: {{8}} Have a productive day!"}'),
    (p_gym, 'owner_evening_summary', 'owner_evening_summary',
     '{"body":"Hi {{1}}, here is today’s wrap-up: {{2}} follow-ups logged, {{3}} payments ({{4}}) and {{5}} new enquiries. {{6}} items were carried over to tomorrow. View details here: {{7}} Have a good evening!"}')
  on conflict (gym_id, key) do nothing;
$$;

-- Portal link: wording that reads as account information (Utility), not a login.
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
begin
  if p_rule = 'portal_otp' then
    v_template := 'portal_otp';
    v_body := '{{1}} is your verification code. For your security, do not share this code.';
  elsif p_rule = 'portal_link' then
    v_template := 'portal_link';
    v_body := 'Hi {{1}}, you can view your {{2}} membership details, invoices and pauses using this member portal link: {{3}} The link stays active for {{4}} days.';
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
  values (p_gym, p_customer, v_phone, p_rule, v_template, p_params, p_document_path, p_related_type, p_related_id,
    v_provider, v_provider = 'mock', p_dedupe, private.render_template(v_body, p_params), auth.uid(), p_is_demo)
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
