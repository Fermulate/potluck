-- RPCs: groups and membership.
--
-- Error convention for every RPC: `raise exception using message = <stable
-- snake_case code>, detail = <readable English>, errcode = <sqlstate>`.
-- Clients map the message code to a translated string. SQLSTATEs used:
--   42501 not signed in / not allowed   P0002 not found
--   22023 invalid input                 23514 business rule violated

-- Returns the caller's id, or raises if not signed in or the account is closed.
create or replace function private.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is not null) then
    raise exception using message = 'account_deleted', detail = 'This account has been closed', errcode = '42501';
  end if;
  return uid;
end;
$$;

-- Returns the caller's role in the group, or raises if they are not a member.
create or replace function private.require_member(gid uuid)
returns public.group_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.group_role;
begin
  select m.role into r
  from public.group_members m
  where m.group_id = gid and m.user_id = (select private.require_user());

  if r is null then
    raise exception using message = 'not_a_member', detail = 'You are not a member of this group', errcode = '42501';
  end if;
  return r;
end;
$$;

create or replace function private.member_balance(gid uuid, uid uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.net_cents from public.group_balances b where b.group_id = gid and b.user_id = uid),
    0
  )::bigint;
$$;

-------------------------------------------------------------------------------

create or replace function public.create_group(
  name text,
  emoji text default null,
  color text default null,
  currency text default null
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  cur text;
  g public.groups;
begin
  if create_group.name is null or char_length(btrim(create_group.name)) = 0 then
    raise exception using message = 'group_name_required', detail = 'Give the group a name', errcode = '22023';
  end if;

  cur := upper(coalesce(
    nullif(btrim(create_group.currency), ''),
    (select p.default_currency from public.profiles p where p.id = uid),
    'USD'
  ));
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;

  insert into public.groups (name, emoji, color, currency, created_by)
  values (btrim(create_group.name), create_group.emoji, create_group.color, cur, uid)
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, uid, 'owner');

  return g;
end;
$$;

create or replace function public.set_member_role(group_id uuid, user_id uuid, role public.group_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(set_member_role.group_id);
  target_role public.group_role;
begin
  if my_role = 'member' then
    raise exception using message = 'not_allowed', detail = 'Only owners and admins can change roles', errcode = '42501';
  end if;
  if set_member_role.role = 'owner' then
    raise exception using message = 'use_transfer_ownership', detail = 'Use transfer ownership to make someone the owner', errcode = '22023';
  end if;

  select m.role into target_role
  from public.group_members m
  where m.group_id = set_member_role.group_id and m.user_id = set_member_role.user_id;

  if target_role is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'P0002';
  end if;
  if target_role = 'owner' then
    raise exception using message = 'cannot_change_owner', detail = 'The owner''s role cannot be changed', errcode = '42501';
  end if;
  if my_role = 'admin' and target_role <> 'member' then
    raise exception using message = 'not_allowed', detail = 'Admins can only manage regular members', errcode = '42501';
  end if;

  update public.group_members m
  set role = set_member_role.role
  where m.group_id = set_member_role.group_id and m.user_id = set_member_role.user_id;
end;
$$;

create or replace function public.remove_member(group_id uuid, user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(remove_member.group_id);
  target_role public.group_role;
begin
  if remove_member.user_id = auth.uid() then
    raise exception using message = 'use_leave_group', detail = 'Use leave group to remove yourself', errcode = '22023';
  end if;
  if my_role = 'member' then
    raise exception using message = 'not_allowed', detail = 'Only owners and admins can remove members', errcode = '42501';
  end if;

  select m.role into target_role
  from public.group_members m
  where m.group_id = remove_member.group_id and m.user_id = remove_member.user_id;

  if target_role is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'P0002';
  end if;
  if target_role = 'owner' then
    raise exception using message = 'cannot_remove_owner', detail = 'The owner cannot be removed', errcode = '42501';
  end if;
  if my_role = 'admin' and target_role <> 'member' then
    raise exception using message = 'not_allowed', detail = 'Admins can only manage regular members', errcode = '42501';
  end if;
  if private.member_balance(remove_member.group_id, remove_member.user_id) <> 0 then
    raise exception using message = 'member_has_balance', detail = 'This member still has an unsettled balance', errcode = '23514';
  end if;

  delete from public.group_members m
  where m.group_id = remove_member.group_id and m.user_id = remove_member.user_id;
end;
$$;

-- Owners must transfer ownership first, unless they are the last member, in
-- which case leaving deletes the group.
create or replace function public.leave_group(group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(leave_group.group_id);
  uid uuid := auth.uid();
  others int;
begin
  if private.member_balance(leave_group.group_id, uid) <> 0 then
    raise exception using message = 'member_has_balance', detail = 'Settle up before leaving this group', errcode = '23514';
  end if;

  select count(*) into others
  from public.group_members m
  where m.group_id = leave_group.group_id and m.user_id <> uid;

  if my_role = 'owner' then
    if others > 0 then
      raise exception using message = 'owner_must_transfer', detail = 'Transfer ownership before leaving', errcode = '23514';
    end if;
    delete from public.groups g where g.id = leave_group.group_id;
    return;
  end if;

  delete from public.group_members m
  where m.group_id = leave_group.group_id and m.user_id = uid;
end;
$$;

-- The current owner becomes an admin.
create or replace function public.transfer_ownership(group_id uuid, user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(transfer_ownership.group_id);
  uid uuid := auth.uid();
begin
  if my_role <> 'owner' then
    raise exception using message = 'not_allowed', detail = 'Only the owner can transfer ownership', errcode = '42501';
  end if;
  if transfer_ownership.user_id = uid then
    raise exception using message = 'already_owner', detail = 'You already own this group', errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = transfer_ownership.group_id
      and m.user_id = transfer_ownership.user_id
      and p.deleted_at is null
  ) then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'P0002';
  end if;

  -- Demote first: the one-owner unique index is not deferrable.
  update public.group_members m set role = 'admin'
  where m.group_id = transfer_ownership.group_id and m.user_id = uid;

  update public.group_members m set role = 'owner'
  where m.group_id = transfer_ownership.group_id and m.user_id = transfer_ownership.user_id;
end;
$$;

-- Hidden two-person group for 1:1 expenses. Both people are full admins of it
-- (the caller is the owner).
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

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = uid and b.blocked_id = get_or_create_direct_group.friend_id)
       or (b.blocker_id = get_or_create_direct_group.friend_id and b.blocked_id = uid)
  ) then
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

revoke execute on function
  private.require_user(),
  private.require_member(uuid),
  private.member_balance(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.create_group(text, text, text, text),
  public.set_member_role(uuid, uuid, public.group_role),
  public.remove_member(uuid, uuid),
  public.leave_group(uuid),
  public.transfer_ownership(uuid, uuid),
  public.get_or_create_direct_group(uuid)
from public, anon;

grant execute on function
  public.create_group(text, text, text, text),
  public.set_member_role(uuid, uuid, public.group_role),
  public.remove_member(uuid, uuid),
  public.leave_group(uuid),
  public.transfer_ownership(uuid, uuid),
  public.get_or_create_direct_group(uuid)
to authenticated, service_role;
