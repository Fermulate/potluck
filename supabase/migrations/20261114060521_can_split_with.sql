-- can_split_with(person): whether a new expense with this person can go in, so the friend page
-- can hide "Add expense" instead of letting it fail. Same rules the writes apply:
--   - a one-on-one tab that already exists takes writes unless the person blocked the caller
--     (private.freeze_blocked_direct_money);
--   - otherwise get_or_create_direct_group needs a contact who is not a seat or a closed account,
--     and no block either way.
-- The answer is a plain no, like the `not_a_friend` those writes raise, so a block is never named.

create or replace function public.can_split_with(person uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if person is null or person = uid then
    return false;
  end if;

  if exists (
    select 1 from public.groups g
    where g.is_direct
      and g.deleted_at is null
      and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
      and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = person)
  ) then
    return not exists (
      select 1 from public.blocks b where b.blocker_id = person and b.blocked_id = uid
    );
  end if;

  return exists (
      select 1 from public.profiles p
      where p.id = person
        and p.deleted_at is null
        and not p.is_placeholder
        and p.id in (select private.my_contact_ids())
    )
    and not private.has_block(uid, person);
end;
$$;

revoke execute on function public.can_split_with(uuid) from public, anon;
grant execute on function public.can_split_with(uuid) to authenticated, service_role;
