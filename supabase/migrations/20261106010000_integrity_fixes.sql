-- Ledger and membership integrity. Every function keeps its signature and grants.
--
--   * Blocks: nobody joins a group through an invite while a block stands
--     between them and someone already in it (accept_invite raises blocked).
--     invite_preview reports blocked and archived so the join page can say so.

-- Blocks --------------------------------------------------------------------------------------

-- True when either person has blocked the other.
create or replace function private.has_block(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks x where x.blocker_id = a and x.blocked_id = b)
      or exists (select 1 from public.blocks x where x.blocker_id = b and x.blocked_id = a);
$$;

-- True when anyone in the group has a block, in either direction, with `uid`.
create or replace function private.blocked_in_group(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.blocks b
      join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
      where b.blocked_id = uid
    )
    or exists (
      select 1 from public.blocks b
      join public.group_members m on m.group_id = gid and m.user_id = b.blocked_id
      where b.blocker_id = uid
    );
$$;

create or replace function public.get_or_create_direct_group(friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid;
begin
  if get_or_create_direct_group.friend_id = uid then
    raise exception using message = 'invalid_friend', detail = 'You cannot split with yourself', errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = get_or_create_direct_group.friend_id
      and p.deleted_at is null
      and p.id in (select private.my_contact_ids())
  ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;

  if private.has_block(uid, get_or_create_direct_group.friend_id) then
    raise exception using message = 'blocked', detail = 'You cannot split with this person', errcode = '42501';
  end if;

  -- Serialize creation per pair so two taps do not create two groups.
  perform pg_advisory_xact_lock(hashtextextended(
    least(uid::text, get_or_create_direct_group.friend_id::text)
      || greatest(uid::text, get_or_create_direct_group.friend_id::text),
    0
  ));

  select g.id into gid
  from public.groups g
  where g.is_direct
    and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
    and exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id = get_or_create_direct_group.friend_id
    )
  order by g.created_at
  limit 1;

  if gid is not null then
    return gid;
  end if;

  insert into public.groups (name, currency, is_direct, members_can_invite, created_by)
  select 'Direct', p.default_currency, true, false, uid
  from public.profiles p where p.id = uid
  returning id into gid;

  insert into public.group_members (group_id, user_id, role)
  values (gid, uid, 'owner'), (gid, get_or_create_direct_group.friend_id, 'admin');

  return gid;
end;
$$;

-- status is one of: valid, expired, revoked, used_up, archived, blocked.
-- blocked only shows for a signed in visitor who is not already a member.
create or replace function public.invite_preview(code text)
returns table (
  group_id uuid,
  name text,
  emoji text,
  color text,
  cover_path text,
  member_count int,
  first_names text[],
  status text,
  is_member boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  inv public.group_invites;
  uid uuid := auth.uid();
begin
  select * into inv from public.group_invites i where i.code = invite_preview.code;

  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;

  return query
  select
    g.id,
    g.name,
    g.emoji,
    g.color,
    g.cover_path,
    (select count(*)::int from public.group_members m where m.group_id = g.id),
    array(
      select split_part(p.display_name, ' ', 1)
      from public.group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = g.id and p.deleted_at is null
      order by (m.role = 'owner') desc, m.joined_at, p.id
      limit 5
    ),
    case
      when inv.revoked_at is not null then 'revoked'
      when inv.expires_at is not null and inv.expires_at <= now() then 'expired'
      when inv.max_uses is not null and inv.uses >= inv.max_uses then 'used_up'
      when g.archived_at is not null then 'archived'
      when uid is not null and not x.is_member and private.blocked_in_group(g.id, uid) then 'blocked'
      else 'valid'
    end,
    x.is_member
  from public.groups g
  cross join lateral (
    select exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id = uid
    ) as is_member
  ) x
  where g.id = inv.group_id;
end;
$$;

-- Joins the group behind an invite code. Already being a member is not an
-- error and does not use up the invite.
create or replace function public.accept_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  inv public.group_invites;
  my_email text;
begin
  select * into inv
  from public.group_invites i
  where i.code = accept_invite.code
  for update;

  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;

  if exists (select 1 from public.group_members m where m.group_id = inv.group_id and m.user_id = uid) then
    return inv.group_id;
  end if;

  if inv.revoked_at is not null then
    raise exception using message = 'invite_revoked', detail = 'This invite has been revoked', errcode = '23514';
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception using message = 'invite_expired', detail = 'This invite has expired', errcode = '23514';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception using message = 'invite_used_up', detail = 'This invite has been used up', errcode = '23514';
  end if;
  if inv.email is not null then
    select lower(u.email) into my_email from auth.users u where u.id = uid;
    if my_email is distinct from inv.email then
      raise exception using message = 'invite_wrong_email', detail = 'This invite was sent to a different email address', errcode = '42501';
    end if;
  end if;
  if exists (select 1 from public.groups g where g.id = inv.group_id and g.archived_at is not null) then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;
  if private.blocked_in_group(inv.group_id, uid) then
    raise exception using message = 'blocked', detail = 'You cannot join this group', errcode = '42501';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (inv.group_id, uid, inv.role);

  update public.group_invites i set uses = i.uses + 1 where i.id = inv.id;

  return inv.group_id;
end;
$$;

revoke execute on function
  private.has_block(uuid, uuid),
  private.blocked_in_group(uuid, uuid)
from public, anon, authenticated;
