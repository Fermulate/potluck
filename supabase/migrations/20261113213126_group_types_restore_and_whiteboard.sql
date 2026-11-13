-- Groups, Splitwise parity (ADR 20):
--
-- 1. Group type (home, trip, couple, other) and trip dates. create_group_v2 takes them;
--    create_group stays for older clients and makes an `other` group. Admins change them with
--    the same direct update as the other settings.
-- 2. Deleting a group can be undone for 30 days. delete_group keeps its signature and checks
--    but now only stamps groups.deleted_at (and closes the group's open invite links);
--    restore_group brings it back for any member; purge-deleted-groups removes it for good
--    after 30 days. While deleted the group is invisible: my_group_ids, is_group_member,
--    is_group_admin, group_role and require_member leave it out, so every policy and RPC
--    treats it as gone. Bodies as in 20261105071444_policy_helpers.sql plus the deleted_at
--    test; require_member as in 20261105071504_rpc_groups.sql plus group_deleted.
--    Nothing new can land in a deleted group: expenses (the recurring job) and memberships are
--    refused by trigger, and notifications about it are dropped.
-- 3. Group covers: members read the bucket listing (anon and outsiders no longer can); the
--    public URL still serves the image to the join page. Writes stay owner and admin only, and
--    the restrictive two-step policy from 20261113100301 still sits on top.
-- 4. Whiteboard: shared notes per group in group_whiteboards, live over realtime, saved through
--    save_group_whiteboard with a version check, logged as group.notes_updated (edits by the
--    same person within ten minutes fold into one line).
-- groups_activity: body as in 20261105071528_activity_triggers.sql plus type and trip dates.

-- 1. Type and trip dates ----------------------------------------------------------------------

create type public.group_type as enum ('home', 'trip', 'couple', 'other');

alter table public.groups
  add column type public.group_type not null default 'other',
  add column starts_on date,
  add column ends_on date,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id) on delete set null,
  add constraint groups_trip_dates_check
    check (starts_on is null or ends_on is null or ends_on >= starts_on);

comment on column public.groups.type is 'home, trip, couple or other. Mostly a label; trips carry dates.';
comment on column public.groups.deleted_at is
  'Set by delete_group. Hidden from everyone until restore_group, purged after 30 days.';

create index groups_deleted_by_idx on public.groups (deleted_by);
create index groups_deleted_at_idx on public.groups (deleted_at) where deleted_at is not null;

grant update (type, starts_on, ends_on) on public.groups to authenticated;

create or replace function public.create_group_v2(
  name text,
  emoji text default null,
  color text default null,
  currency text default null,
  type public.group_type default 'other',
  starts_on date default null,
  ends_on date default null
) returns public.groups
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  cur text;
  kind public.group_type := coalesce(create_group_v2.type, 'other');
  g public.groups;
begin
  if create_group_v2.name is null or char_length(btrim(create_group_v2.name)) = 0 then
    raise exception using message = 'group_name_required', detail = 'Give the group a name', errcode = '22023';
  end if;
  if kind = 'trip' and create_group_v2.starts_on is not null and create_group_v2.ends_on is not null
     and create_group_v2.ends_on < create_group_v2.starts_on then
    raise exception using message = 'trip_dates_invalid', detail = 'A trip cannot end before it starts', errcode = '22023';
  end if;

  cur := upper(coalesce(
    nullif(btrim(create_group_v2.currency), ''),
    (select p.default_currency from public.profiles p where p.id = uid),
    'USD'
  ));
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;

  insert into public.groups (name, emoji, color, currency, created_by, type, starts_on, ends_on)
  values (
    btrim(create_group_v2.name), create_group_v2.emoji, create_group_v2.color, cur, uid, kind,
    case when kind = 'trip' then create_group_v2.starts_on end,
    case when kind = 'trip' then create_group_v2.ends_on end
  )
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, uid, 'owner');

  return g;
end;
$$;

revoke execute on function public.create_group_v2(text, text, text, text, public.group_type, date, date) from public, anon;
grant execute on function public.create_group_v2(text, text, text, text, public.group_type, date, date) to authenticated, service_role;

create or replace function private.groups_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.id, coalesce(auth.uid(), new.created_by), 'group.created', new.id,
      jsonb_build_object('name', new.name));
  elsif (new.name, new.emoji, new.color, new.cover_path, new.currency, new.simplify_debts,
         new.members_can_invite, new.archived_at, new.type, new.starts_on, new.ends_on)
        is distinct from
        (old.name, old.emoji, old.color, old.cover_path, old.currency, old.simplify_debts,
         old.members_can_invite, old.archived_at, old.type, old.starts_on, old.ends_on) then
    perform private.log_activity(new.id, auth.uid(), 'group.updated', new.id,
      jsonb_build_object('name', new.name, 'archived', new.archived_at is not null));
  end if;
  return null;
end;
$$;

-- 2. Delete, restore, purge -------------------------------------------------------------------

create or replace function private.my_group_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.group_id
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = (select auth.uid()) and g.deleted_at is null;
$$;

create or replace function private.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.group_id = gid and m.user_id = (select auth.uid()) and g.deleted_at is null
  );
$$;

create or replace function private.is_group_admin(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.group_id = gid
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
      and g.deleted_at is null
  );
$$;

create or replace function private.group_role(gid uuid) returns public.group_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.group_id = gid and m.user_id = (select auth.uid()) and g.deleted_at is null;
$$;

create or replace function private.require_member(gid uuid) returns public.group_role
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.group_role;
  gone timestamptz;
begin
  select m.role, g.deleted_at into r, gone
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.group_id = gid and m.user_id = (select private.require_user());

  if r is null then
    raise exception using message = 'not_a_member', detail = 'You are not a member of this group', errcode = '42501';
  end if;
  if gone is not null then
    raise exception using message = 'group_deleted', detail = 'This group was deleted', errcode = 'PT404';
  end if;
  return r;
end;
$$;

-- Owner only, every balance settled, as before. Stamps the group instead of removing it, and
-- closes its open invite links with the same timestamp so restoring can reopen exactly those.
create or replace function public.delete_group(group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(delete_group.group_id);
  uid uuid := auth.uid();
  stamp timestamptz := now();
begin
  if my_role <> 'owner' then
    raise exception using message = 'not_allowed', detail = 'Only the owner can delete the group', errcode = '42501';
  end if;
  perform 1 from public.groups g where g.id = delete_group.group_id for update;
  if exists (
    select 1 from public.group_balances b
    where b.group_id = delete_group.group_id and b.net_cents <> 0
  ) then
    raise exception using
      message = 'group_has_balances',
      detail = 'Settle every balance before deleting this group',
      errcode = '23514';
  end if;

  update public.groups g set deleted_at = stamp, deleted_by = uid where g.id = delete_group.group_id;
  update public.group_invites i set revoked_at = stamp
  where i.group_id = delete_group.group_id and i.revoked_at is null;
  perform private.log_activity(delete_group.group_id, uid, 'group.deleted', delete_group.group_id,
    jsonb_build_object('name', (select g.name from public.groups g where g.id = delete_group.group_id)));
end;
$$;

-- Any member brings a deleted group back while it is still there. Restoring a group that is
-- not deleted returns it unchanged.
create or replace function public.restore_group(group_id uuid) returns public.groups
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  g public.groups;
begin
  select * into g from public.groups x where x.id = restore_group.group_id for update;
  if g.id is null then
    raise exception using message = 'group_not_found', detail = 'This group is gone for good', errcode = 'PT404';
  end if;
  if not exists (
    select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid
  ) then
    raise exception using message = 'not_a_member', detail = 'You are not a member of this group', errcode = '42501';
  end if;
  if g.deleted_at is null then
    return g;
  end if;

  update public.group_invites i set revoked_at = null
  where i.group_id = g.id and i.revoked_at = g.deleted_at;
  update public.groups x set deleted_at = null, deleted_by = null
  where x.id = g.id
  returning * into g;
  perform private.log_activity(g.id, uid, 'group.restored', g.id, jsonb_build_object('name', g.name));
  return g;
end;
$$;

revoke execute on function public.restore_group(uuid) from public, anon;
grant execute on function public.restore_group(uuid) to authenticated, service_role;

-- What the Groups page lists under "Recently deleted": the caller's deleted groups that can
-- still be restored, newest first.
create or replace function public.my_deleted_groups()
returns table (
  id uuid,
  name text,
  emoji text,
  color text,
  type public.group_type,
  cover_path text,
  deleted_at timestamptz,
  deleted_by uuid,
  purge_after timestamptz,
  member_count integer
)
language sql stable security definer set search_path = '' as $$
  select
    g.id, g.name, g.emoji, g.color, g.type, g.cover_path, g.deleted_at, g.deleted_by,
    g.deleted_at + interval '30 days',
    (select count(*)::int from public.group_members x where x.group_id = g.id)
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = (select private.require_user())
  where g.deleted_at is not null and g.deleted_at > now() - interval '30 days'
  order by g.deleted_at desc, g.id;
$$;

revoke execute on function public.my_deleted_groups() from public, anon;
grant execute on function public.my_deleted_groups() to authenticated, service_role;

-- Nightly: groups deleted more than `keep` ago go for good, with everything in them. One
-- group that cannot go (it never should: deleting needs settled balances) is skipped, not fatal.
create or replace function private.purge_deleted_groups(keep interval default '30 days')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid;
  purged int := 0;
begin
  for gid in
    select g.id from public.groups g
    where g.deleted_at is not null and g.deleted_at <= now() - keep
    order by g.id
  loop
    begin
      delete from public.groups g
      where g.id = gid and g.deleted_at is not null and g.deleted_at <= now() - keep;
      if found then
        purged := purged + 1;
      end if;
    exception
      when others then
        raise warning 'deleted group % kept: %', gid, sqlerrm;
    end;
  end loop;
  return purged;
end;
$$;

revoke execute on function private.purge_deleted_groups(interval) from public, anon, authenticated;

select cron.schedule('purge-deleted-groups', '20 3 * * *', $$select private.purge_deleted_groups()$$);

-- Nothing new lands in a deleted group. The recurring job skips the group (its per template
-- exception handler catches this) and picks up again after a restore.
create or replace function private.require_live_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.groups g where g.id = new.group_id and g.deleted_at is not null) then
    raise exception using message = 'group_deleted', detail = 'This group was deleted', errcode = 'PT404';
  end if;
  return new;
end;
$$;

revoke execute on function private.require_live_group() from public;

create trigger expenses_require_live_group
before insert on public.expenses
for each row execute function private.require_live_group();

create trigger group_members_require_live_group
before insert on public.group_members
for each row execute function private.require_live_group();

-- Plan reminders and anything else about a deleted group stay quiet. Runs before the routing
-- trigger (triggers fire in name order).
create or replace function private.drop_deleted_group_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.groups g
    where g.id = private.try_uuid(new.data ->> 'group_id') and g.deleted_at is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function private.drop_deleted_group_notification() from public;

create trigger notifications_drop_deleted_group
before insert on public.notifications
for each row execute function private.drop_deleted_group_notification();

-- 3. Covers -----------------------------------------------------------------------------------

drop policy "group-covers: public read" on storage.objects;

create policy "group-covers: members read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'group-covers'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
);

-- 4. Whiteboard -------------------------------------------------------------------------------

create table public.group_whiteboards (
  group_id uuid primary key references public.groups (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  version integer not null default 0 check (version >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.group_whiteboards is
  'Shared notes, one row per group. Written only by save_group_whiteboard.';

create index group_whiteboards_updated_by_idx on public.group_whiteboards (updated_by);

revoke all on public.group_whiteboards from anon, authenticated;
grant select (group_id, body, version, updated_by, updated_at) on public.group_whiteboards to authenticated;
grant all on public.group_whiteboards to service_role;

alter table public.group_whiteboards enable row level security;

create policy "group_whiteboards: members read" on public.group_whiteboards
  for select to authenticated
  using (group_id = any (array(select private.my_group_ids())));

create policy "group_whiteboards: two-step sign in done" on public.group_whiteboards
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));

alter publication supabase_realtime add table public.group_whiteboards;

-- Saves the notes if nobody saved since `base_version` (the version the editor started from);
-- otherwise raises whiteboard_conflict so the editor can show the newer text first.
create or replace function public.save_group_whiteboard(group_id uuid, body text, base_version integer)
returns public.group_whiteboards
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  text_in text := coalesce(save_group_whiteboard.body, '');
  w public.group_whiteboards;
  recent uuid;
begin
  perform private.require_member(save_group_whiteboard.group_id);
  perform private.require_group_open(save_group_whiteboard.group_id);
  if char_length(text_in) > 10000 then
    raise exception using message = 'whiteboard_too_long', detail = 'Notes are limited to 10000 characters', errcode = '22023';
  end if;

  insert into public.group_whiteboards (group_id) values (save_group_whiteboard.group_id)
  on conflict (group_id) do nothing;
  select * into w from public.group_whiteboards x
  where x.group_id = save_group_whiteboard.group_id
  for update;

  if w.version <> coalesce(save_group_whiteboard.base_version, -1) then
    raise exception using
      message = 'whiteboard_conflict',
      detail = 'Someone else saved the notes first',
      errcode = '23514';
  end if;
  if w.body = text_in then
    return w;
  end if;

  update public.group_whiteboards x
  set body = text_in, version = x.version + 1, updated_by = uid, updated_at = now()
  where x.group_id = w.group_id
  returning * into w;

  -- One line per sitting: the same person's edits within ten minutes update that line.
  select a.id into recent from public.activity a
  where a.group_id = w.group_id and a.verb = 'group.notes_updated' and a.actor_id = uid
    and a.created_at > now() - interval '10 minutes'
  order by a.created_at desc
  limit 1;
  if recent is not null then
    update public.activity a
    set created_at = now(),
        data = jsonb_build_object('version', w.version, 'excerpt', left(w.body, 140))
    where a.id = recent;
  else
    perform private.log_activity(w.group_id, uid, 'group.notes_updated', w.group_id,
      jsonb_build_object('version', w.version, 'excerpt', left(w.body, 140)));
  end if;
  return w;
end;
$$;

revoke execute on function public.save_group_whiteboard(uuid, text, integer) from public, anon;
grant execute on function public.save_group_whiteboard(uuid, text, integer) to authenticated, service_role;
