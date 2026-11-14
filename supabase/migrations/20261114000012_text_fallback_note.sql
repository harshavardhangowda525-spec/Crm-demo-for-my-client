-- Text backup for unapproved templates: the app may deliver a message as plain
-- text instead of its template. Record that on the message so staff can see it.
alter table public.whatsapp_messages add column if not exists delivery_note text;

drop function if exists public.dispatch_complete(text, uuid, text, text, text);

create or replace function public.dispatch_complete(
  p_secret text, p_message_id uuid, p_outcome text, p_provider_message_id text default null,
  p_error text default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.whatsapp_messages%rowtype;
  v_exec_status text;
  v_failed boolean := p_outcome in ('failed','failed_permanent');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
begin
  perform private.require_secret(p_secret);
  if p_outcome not in ('sent','simulated','failed','failed_permanent') then raise exception 'bad outcome'; end if;
  select * into m from public.whatsapp_messages where id = p_message_id for update;
  if not found or m.status <> 'sending' then return; end if;

  if v_failed then
    if p_outcome = 'failed' and m.attempts < m.max_attempts then
      update public.whatsapp_messages set status = 'queued', last_error = p_error,
        next_attempt_at = now() + make_interval(mins => (power(4, m.attempts))::int) where id = m.id;
      return;
    end if;
    update public.whatsapp_messages set status = 'failed', last_error = p_error where id = m.id;
    v_exec_status := 'failed';
  else
    update public.whatsapp_messages set status = p_outcome, provider_message_id = p_provider_message_id,
      sent_at = now(), last_error = null, delivery_note = case when p_outcome = 'sent' then v_note end
    where id = m.id;
    v_exec_status := 'success';
  end if;

  update public.automation_executions set status = v_exec_status,
    detail = case when p_outcome = 'simulated' then 'Simulated (mock provider) — not delivered to WhatsApp'
                  when p_outcome = 'sent' and v_note is not null then 'Accepted by WhatsApp — ' || v_note
                  when p_outcome = 'sent' then 'Accepted by WhatsApp'
                  else coalesce(p_error, 'Failed') end,
    executed_at = now()
  where message_id = m.id;

  if m.customer_id is not null and m.purpose <> 'portal_otp' then
    insert into public.activity_events (gym_id, customer_id, type, title, details, entity_type, entity_id, actor_type, is_demo)
    values (m.gym_id, m.customer_id, 'whatsapp_message',
      case p_outcome when 'simulated' then 'WhatsApp message simulated' when 'sent' then 'WhatsApp message sent'
                     else 'WhatsApp message failed' end,
      jsonb_build_object('purpose', m.purpose, 'status', case when v_failed then 'failed' else p_outcome end,
                         'error', p_error, 'note', v_note),
      'whatsapp_message', m.id, 'system', m.is_demo);
  end if;
end $$;
revoke execute on function public.dispatch_complete(text, uuid, text, text, text, text) from public;
grant execute on function public.dispatch_complete(text, uuid, text, text, text, text) to anon, authenticated;
