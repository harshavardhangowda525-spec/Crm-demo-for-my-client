-- The approved membership_confirmation template has no portal-link variable, so
-- the link stopped reaching members. Every time a membership becomes active
-- (first joining and every renewal) the member now also gets the approved
-- portal_link template with a fresh personal link — once per membership.

create or replace function private.queue_confirmation(p_membership uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m record;
  v_link text;
begin
  select ms.*, c.full_name, g.name as gym_name, g.portal_link_days into m
  from public.memberships ms join public.customers c on c.id = ms.customer_id join public.gyms g on g.id = ms.gym_id
  where ms.id = p_membership;
  v_link := private.new_portal_link(m.gym_id, m.customer_id);

  perform private.queue_message(m.gym_id, m.customer_id, 'membership_confirmation',
    jsonb_build_array(split_part(m.full_name, ' ', 1), m.gym_name, m.plan_name,
      to_char(m.start_date, 'DD Mon YYYY'), to_char(m.end_date, 'DD Mon YYYY'), v_link),
    'confirm:' || m.id, 'membership', m.id, m.id, null, true, m.is_demo);

  perform private.queue_message(m.gym_id, m.customer_id, 'portal_link',
    jsonb_build_array(split_part(m.full_name, ' ', 1), m.gym_name, v_link, m.portal_link_days::text),
    'portal:' || m.id, 'membership', m.id, m.id, null, true, m.is_demo);
end $$;
revoke all on function private.queue_confirmation(uuid) from public, anon, authenticated;
