-- Friends without a group (ADR 19): a personal friend link, single-use links bound to an
-- email, adding someone you share a group with, removing a friend, blocking with the
-- friendship gone in both directions, and the blocked list. A block is never announced:
-- wherever it stops something, the answer is the one a revoked link or a stranger gets.

create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default private.random_code(9) check (code ~ '^[A-Za-z0-9_-]{10,64}$'),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  email text check (email is null or (private.is_plain_email(email) and email = private.ascii_lower(email))),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.friend_invites is
  'Friend links. email null and max_uses null is the personal link; the others are single use and bound to an email.';

create index friend_invites_created_by_idx on public.friend_invites (created_by, created_at desc);

alter table public.friend_invites enable row level security;
revoke all on table public.friend_invites from anon, authenticated;
grant select (id, code, created_by, email, max_uses, uses, expires_at, revoked_at, created_at)
  on table public.friend_invites to authenticated;
grant update (revoked_at) on table public.friend_invites to authenticated;
grant all on table public.friend_invites to service_role;

create policy "friend_invites: read own" on public.friend_invites
for select to authenticated
using (created_by = (select auth.uid()));

create policy "friend_invites: revoke own" on public.friend_invites
for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

insert into private.notification_types (type, category) values ('friend.added', 'groups')
on conflict (type) do nothing;

-- Both directions at once; blocks win.
create or replace function private.befriend(a uuid, b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.has_block(a, b) then
    raise exception using message = 'blocked', detail = 'You cannot add this person', errcode = '42501';
  end if;
  insert into public.friendships (user_id, friend_id)
  values (a, b), (b, a)
  on conflict do nothing;
end;
$$;

revoke execute on function private.befriend(uuid, uuid) from public, anon, authenticated;

-- The personal link: one open at a time; `rotate` retires it and makes a new one.
create or replace function public.my_friend_link(rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  found text;
begin
  perform pg_advisory_xact_lock(hashtextextended('friend-link:' || uid::text, 0));

  if rotate then
    update public.friend_invites i set revoked_at = now()
    where i.created_by = uid and i.email is null and i.max_uses is null and i.revoked_at is null;
  else
    select i.code into found
    from public.friend_invites i
    where i.created_by = uid and i.email is null and i.max_uses is null and i.revoked_at is null
    order by i.created_at desc
    limit 1;
    if found is not null then
      return found;
    end if;
  end if;

  insert into public.friend_invites (created_by) values (uid) returning code into found;
  return found;
end;
$$;

revoke execute on function public.my_friend_link(boolean) from public, anon;
grant execute on function public.my_friend_link(boolean) to authenticated, service_role;

-- A single-use link only the owner of `email` can accept (after verifying it).
create or replace function public.create_friend_invite(email text)
returns public.friend_invites
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  clean text := private.placeholder_email(create_friend_invite.email);
  inv public.friend_invites;
begin
  if clean is null then
    raise exception using message = 'invalid_email', detail = 'That email address does not look right', errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where u.id = uid and private.ascii_lower(u.email) = clean) then
    raise exception using message = 'invalid_friend', detail = 'You cannot add yourself', errcode = '22023';
  end if;
  if (
    select count(*) from public.friend_invites i
    where i.created_by = uid and i.email is not null and i.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception using message = 'too_many_invites', detail = 'That is a lot of invites for one day. Try again tomorrow', errcode = '23514';
  end if;

  insert into public.friend_invites (created_by, email, max_uses, expires_at)
  values (uid, clean, 1, now() + interval '30 days')
  returning * into inv;
  return inv;
end;
$$;

revoke execute on function public.create_friend_invite(text) from public, anon;
grant execute on function public.create_friend_invite(text) to authenticated, service_role;

-- What a friend link shows before signing in: the inviter's first name and face.
create or replace function public.friend_invite_preview(code text)
returns table (name text, avatar_path text, status text, is_friend boolean, is_self boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  inv public.friend_invites;
  uid uuid := auth.uid();
begin
  select * into inv from public.friend_invites i where i.code = friend_invite_preview.code;
  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;

  return query
  with preview as (
    select
      p.id,
      p.display_name,
      p.avatar_path,
      exists (select 1 from public.friendships f where f.user_id = uid and f.friend_id = p.id) as friends,
      case
        when p.deleted_at is not null or inv.revoked_at is not null then 'revoked'
        when uid is not null and private.has_block(uid, p.id) then 'revoked'
        when uid is not null and (uid = p.id or exists (
          select 1 from public.friendships f where f.user_id = uid and f.friend_id = p.id
        )) then 'valid'
        when inv.expires_at is not null and inv.expires_at <= now() then 'expired'
        when inv.max_uses is not null and inv.uses >= inv.max_uses then 'used_up'
        else 'valid'
      end as status
    from public.profiles p
    where p.id = inv.created_by
  )
  -- Only a live link says who it is from.
  select
    case when pv.status = 'valid' then split_part(pv.display_name, ' ', 1) end,
    case when pv.status = 'valid' then pv.avatar_path end,
    pv.status,
    uid is not null and pv.status = 'valid' and pv.friends,
    uid is not null and pv.status = 'valid' and uid = pv.id
  from preview pv;
end;
$$;

revoke execute on function public.friend_invite_preview(text) from public;
grant execute on function public.friend_invite_preview(text) to anon, authenticated, service_role;

create or replace function public.accept_friend_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  inv public.friend_invites;
  my_email text;
  verified boolean;
begin
  select * into inv from public.friend_invites i where i.code = accept_friend_invite.code for update;
  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;
  if inv.created_by = uid then
    raise exception using message = 'invalid_friend', detail = 'You cannot add yourself', errcode = '22023';
  end if;
  if exists (select 1 from public.friendships f where f.user_id = uid and f.friend_id = inv.created_by) then
    return inv.created_by;
  end if;
  if inv.revoked_at is not null
     or exists (select 1 from public.profiles p where p.id = inv.created_by and p.deleted_at is not null)
     or private.has_block(uid, inv.created_by) then
    raise exception using message = 'invite_revoked', detail = 'This invite has been revoked', errcode = '23514';
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception using message = 'invite_expired', detail = 'This invite has expired', errcode = '23514';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception using message = 'invite_used_up', detail = 'This invite has been used up', errcode = '23514';
  end if;
  if inv.email is not null then
    select private.ascii_lower(u.email), u.email_confirmed_at is not null into my_email, verified
    from auth.users u where u.id = uid;
    if my_email is distinct from inv.email then
      raise exception using message = 'invite_wrong_email', detail = 'This invite was sent to a different email address', errcode = '42501';
    end if;
    if not coalesce(verified, false) then
      raise exception using message = 'email_not_verified', detail = 'Confirm your email address first', errcode = '42501';
    end if;
  end if;

  perform private.befriend(uid, inv.created_by);
  update public.friend_invites i set uses = i.uses + 1 where i.id = inv.id;

  perform private.notify(array[inv.created_by], 'friend.added', jsonb_build_object('user_id', uid), uid);
  return inv.created_by;
end;
$$;

revoke execute on function public.accept_friend_invite(text) from public, anon;
grant execute on function public.accept_friend_invite(text) to authenticated, service_role;

-- Adds someone you share a group with (the friends page suggests them).
create or replace function public.add_friend(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  if add_friend.user_id = uid then
    raise exception using message = 'invalid_friend', detail = 'You cannot add yourself', errcode = '22023';
  end if;
  if not private.shares_group_with(add_friend.user_id)
     or private.has_block(uid, add_friend.user_id)
     or not exists (
       select 1 from public.profiles p
       where p.id = add_friend.user_id and p.deleted_at is null and not p.is_placeholder
     ) then
    raise exception using message = 'not_a_friend', detail = 'You can only add people you share a group with', errcode = '42501';
  end if;
  perform private.befriend(uid, add_friend.user_id);
end;
$$;

revoke execute on function public.add_friend(uuid) from public, anon;
grant execute on function public.add_friend(uuid) to authenticated, service_role;

-- Drops the friendship both ways. Shared groups stay; an open 1:1 balance must be settled.
create or replace function public.remove_friend(friend_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  if exists (
    select 1 from public.groups g
    join public.group_members a on a.group_id = g.id and a.user_id = uid
    join public.group_members b on b.group_id = g.id and b.user_id = remove_friend.friend_id
    where g.is_direct and private.member_balance(g.id, uid) <> 0
  ) then
    raise exception using message = 'friend_has_balance', detail = 'Settle up before removing this friend', errcode = '23514';
  end if;

  delete from public.friendships f
  where (f.user_id = uid and f.friend_id = remove_friend.friend_id)
     or (f.user_id = remove_friend.friend_id and f.friend_id = uid);
end;
$$;

revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated, service_role;

-- Blocks someone you know (they are not told) and ends the friendship both ways.
-- Unblocking is a direct delete on blocks ("blocks: delete own").
create or replace function public.block_user(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  if block_user.user_id = uid then
    raise exception using message = 'invalid_friend', detail = 'You cannot block yourself', errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = block_user.user_id
      and not p.is_placeholder
      and (
        p.id in (select private.my_contact_ids())
        or p.id in (select private.my_former_contact_ids())
      )
  ) then
    raise exception using message = 'person_not_found', detail = 'You can only block people you know here', errcode = 'PT404';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (uid, block_user.user_id)
  on conflict do nothing;

  delete from public.friendships f
  where (f.user_id = uid and f.friend_id = block_user.user_id)
     or (f.user_id = block_user.user_id and f.friend_id = uid);
end;
$$;

revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated, service_role;

-- The viewer's blocked list with names: a blocked person may no longer be a contact,
-- so their profile is out of reach of the profiles policy.
create or replace function public.my_blocks()
returns table (user_id uuid, display_name text, avatar_path text, blocked_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  return query
  select b.blocked_id, p.display_name, p.avatar_path, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = uid
  order by b.created_at desc, b.blocked_id;
end;
$$;

revoke execute on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated, service_role;

-- A 1:1 tab across a block: the blocked person can no longer change its money (expenses,
-- payments, repeating expenses), and is told what a stranger is told. The person who blocked
-- them still can, so nothing they need to see happens behind the mute (ADR 19). Turning a
-- repeating expense off is always allowed, and the nightly run of one (no signed in user) is
-- not a change by anyone.
create or replace function private.freeze_blocked_direct_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  gid uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'group_id')::uuid;
begin
  if uid is null or private.claiming() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'recurring_expenses' and tg_op = 'UPDATE'
     and (to_jsonb(old) ->> 'active')::boolean and not (to_jsonb(new) ->> 'active')::boolean then
    return new;
  end if;
  if exists (select 1 from public.groups g where g.id = gid and g.is_direct)
     and exists (
       select 1 from public.blocks b
       join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
       where b.blocked_id = uid
     ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function private.freeze_blocked_direct_money() from public, anon, authenticated;

create trigger expenses_freeze_blocked_direct
before insert or update or delete on public.expenses
for each row execute function private.freeze_blocked_direct_money();

create trigger settlements_freeze_blocked_direct
before insert or update or delete on public.settlements
for each row execute function private.freeze_blocked_direct_money();

create trigger recurring_expenses_freeze_blocked_direct
before insert or update or delete on public.recurring_expenses
for each row execute function private.freeze_blocked_direct_money();
