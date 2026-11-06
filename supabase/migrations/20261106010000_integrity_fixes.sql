-- Ledger and membership integrity. Every function keeps its signature and grants.
--
--   * Blocks: nobody joins a group through an invite while a block stands
--     between them and someone already in it (accept_invite raises blocked).
--     invite_preview reports blocked and archived so the join page can say so.
--   * Former members stay readable: co-members can read the profile of anyone
--     who has left one of their groups (private.former_members), so old
--     expenses, payments and activity keep their names.

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

-- Former members ------------------------------------------------------------------------------

-- Who has left which group (or had their account closed). Kept so the people
-- still there can read the name on old expenses, payments and activity.
-- Rejoining removes the row; deleting the group removes them all.
create table private.former_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  left_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index former_members_user_id_idx on private.former_members (user_id);

alter table private.former_members enable row level security;
revoke all on table private.former_members from public, anon, authenticated;
grant all on table private.former_members to service_role;

create or replace function private.track_former_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    delete from private.former_members f
    where f.group_id = new.group_id and f.user_id = new.user_id;
    return null;
  end if;

  -- Rows removed by a cascading group delete have nothing to point at.
  if exists (select 1 from public.groups g where g.id = old.group_id) then
    insert into private.former_members (group_id, user_id)
    values (old.group_id, old.user_id)
    on conflict (group_id, user_id) do update set left_at = excluded.left_at;
  end if;
  return null;
end;
$$;

create trigger group_members_track_former
after insert or delete on public.group_members
for each row execute function private.track_former_members();

-- Everyone who left before this table existed and is still referenced in the group.
insert into private.former_members (group_id, user_id)
select x.group_id, x.user_id
from (
  select e.group_id, e.paid_by as user_id from public.expenses e
  union
  select e.group_id, s.user_id from public.expense_splits s join public.expenses e on e.id = s.expense_id
  union
  select st.group_id, st.from_user from public.settlements st
  union
  select st.group_id, st.to_user from public.settlements st
  union
  select c.group_id, c.author_id from public.comments c
  union
  select a.group_id, a.actor_id from public.activity a
  union
  select a.group_id, a.subject_id from public.activity a where a.verb like 'member.%'
) x
where x.user_id is not null
  and exists (select 1 from public.profiles p where p.id = x.user_id)
  and not exists (
    select 1 from public.group_members m where m.group_id = x.group_id and m.user_id = x.user_id
  )
on conflict do nothing;

-- People who have left one of my groups.
create or replace function private.my_former_contact_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id
  from public.group_members mine
  join private.former_members f on f.group_id = mine.group_id
  where mine.user_id = (select auth.uid());
$$;

grant execute on function private.my_former_contact_ids() to authenticated, service_role;

alter policy "profiles: read self and contacts" on public.profiles
using (
  id = (select auth.uid())
  or id in (select private.my_contact_ids())
  or id in (select private.my_former_contact_ids())
);

revoke execute on function private.track_former_members() from public, anon, authenticated;
