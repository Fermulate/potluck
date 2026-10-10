-- RPC: closing an account.
--
-- Tombstones the profile instead of deleting it so shared ledgers stay correct
-- (other people's balances still reference this user). The auth user itself is
-- removed later by the `delete-account` edge function, which must soft delete
-- it (auth.admin.deleteUser(id, true)) so profile foreign keys survive.
--
-- What happens:
--   * profile: display_name 'Former member', avatar cleared, deleted_at set
--   * owned groups: ownership passes to the longest-standing admin, else the
--     longest-standing member; a group with no other active member is deleted
--   * memberships with a zero balance are removed; ones with an open balance
--     stay so nobody's debt disappears
--   * push tokens, calendar links, busy blocks, notifications, availability,
--     RSVPs, friendships and blocks are deleted; open invites are revoked
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owned record;
  heir uuid;
begin
  if uid is null then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;

  if exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is not null) then
    return;
  end if;

  for owned in
    select m.group_id from public.group_members m where m.user_id = uid and m.role = 'owner'
  loop
    select m.user_id into heir
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = owned.group_id and m.user_id <> uid and p.deleted_at is null
    order by (m.role = 'admin') desc, m.joined_at, m.user_id
    limit 1;

    if heir is null then
      delete from public.groups g where g.id = owned.group_id;
    else
      update public.group_members m set role = 'member'
      where m.group_id = owned.group_id and m.user_id = uid;
      update public.group_members m set role = 'owner'
      where m.group_id = owned.group_id and m.user_id = heir;
    end if;
  end loop;

  delete from public.group_members m
  where m.user_id = uid
    and private.member_balance(m.group_id, uid) = 0;

  delete from public.push_tokens t where t.user_id = uid;
  delete from public.calendar_connections c where c.user_id = uid;
  delete from public.busy_blocks b where b.user_id = uid;
  delete from public.notifications n where n.user_id = uid;
  delete from public.availability a where a.user_id = uid;
  delete from public.availability_requests r where r.user_id = uid;
  delete from public.event_rsvps r where r.user_id = uid;
  delete from public.friendships f where f.user_id = uid or f.friend_id = uid;
  delete from public.blocks b where b.blocker_id = uid or b.blocked_id = uid;

  update public.group_invites i set revoked_at = now()
  where i.created_by = uid and i.revoked_at is null;

  update public.profiles p set
    display_name = 'Former member',
    avatar_path = null,
    timezone = 'UTC',
    locale = 'en',
    deleted_at = now()
  where p.id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;
