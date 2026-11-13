-- "Send WhatsApp test" button: sends Meta's pre-approved hello_world template
-- to the signed-in staff member's own WhatsApp number through the normal
-- queue + dispatcher, so the whole pipeline can be proven before the gym's own
-- templates are approved.
create or replace function public.send_whatsapp_test()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid := private.require_staff(true);
  v_phone text;
  v_provider text;
  v_id uuid;
begin
  select up.phone_e164 into v_phone from public.user_profiles up where up.id = auth.uid();
  if v_phone is null then
    raise exception 'add your WhatsApp number in Settings → Reminders first' using errcode = '22023';
  end if;
  perform private.rate_limit('whatsapp_test:' || auth.uid(), 5, interval '10 minutes');
  select whatsapp_provider into v_provider from public.gyms where id = v_gym;
  insert into public.whatsapp_messages (gym_id, customer_id, to_phone_e164, purpose, template_name, template_language,
    template_params, related_entity_type, provider, simulated, dedupe_key, body_preview, created_by)
  values (v_gym, null, v_phone, 'whatsapp_test', 'hello_world', 'en_US', '[]'::jsonb, 'gym_staff', v_provider,
    v_provider = 'mock', 'wa-test:' || auth.uid() || ':' || extract(epoch from clock_timestamp())::bigint,
    'Hello World — Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta.',
    auth.uid())
  returning id into v_id;
  insert into public.automation_executions (gym_id, rule_key, dedupe_key, status, message_id, detail)
  values (v_gym, 'whatsapp_test', 'wa-test-exec:' || v_id, 'queued', v_id, 'Test message queued');
  return jsonb_build_object('message_id', v_id, 'to', v_phone, 'provider', v_provider);
end $$;
revoke all on function public.send_whatsapp_test() from public, anon;
grant execute on function public.send_whatsapp_test() to authenticated;
