-- Helpers used inside RLS policies. security definer so they can read
-- group_members without recursing into its own policies; they only ever answer
-- questions about the calling user (auth.uid()).

create or replace function private.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.group_role(gid uuid)
returns public.group_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.group_members m
  where m.group_id = gid and m.user_id = (select auth.uid());
$$;

create or replace function private.is_group_admin(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

-- Set returning variants: `group_id in (select private.my_group_ids())` runs
-- once per statement instead of once per row.
create or replace function private.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.group_id from public.group_members m where m.user_id = (select auth.uid());
$$;

create or replace function private.my_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.events e
  join public.group_members m on m.group_id = e.group_id
  where m.user_id = (select auth.uid());
$$;

create or replace function private.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

-- Users I share a group with or am friends with (whose profile I may see).
create or replace function private.my_contact_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select theirs.user_id
  from public.group_members mine
  join public.group_members theirs on theirs.group_id = mine.group_id
  where mine.user_id = (select auth.uid())
  union
  select f.friend_id from public.friendships f where f.user_id = (select auth.uid());
$$;

-- Owner/admin of the event's group, or the member who created the event.
create or replace function private.can_manage_event(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    join public.group_members m on m.group_id = e.group_id and m.user_id = (select auth.uid())
    where e.id = eid
      and (m.role in ('owner', 'admin') or e.created_by = m.user_id)
  );
$$;

grant execute on function
  private.is_group_member(uuid),
  private.group_role(uuid),
  private.is_group_admin(uuid),
  private.my_group_ids(),
  private.my_event_ids(),
  private.shares_group_with(uuid),
  private.my_contact_ids(),
  private.can_manage_event(uuid)
to authenticated, service_role;
