-- RLS: profiles, friendships, blocks, reports, calendar connections.

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.calendar_connections enable row level security;

-- Profiles: yourself, people you share a group with, and friends.
create policy "profiles: read self and contacts"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or id in (select private.my_contact_ids())
);

create policy "profiles: update self"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Friendships: both directions are visible to either side; either side can unfriend.
create policy "friendships: read own"
on public.friendships for select
to authenticated
using (user_id = (select auth.uid()) or friend_id = (select auth.uid()));

create policy "friendships: delete own"
on public.friendships for delete
to authenticated
using (user_id = (select auth.uid()) or friend_id = (select auth.uid()));

-- Blocks are private to the blocker.
create policy "blocks: read own"
on public.blocks for select
to authenticated
using (blocker_id = (select auth.uid()));

create policy "blocks: create own"
on public.blocks for insert
to authenticated
with check (blocker_id = (select auth.uid()));

create policy "blocks: delete own"
on public.blocks for delete
to authenticated
using (blocker_id = (select auth.uid()));

-- Reports: write-only from the app, the reporter can see what they filed.
create policy "reports: read own"
on public.reports for select
to authenticated
using (reporter_id = (select auth.uid()));

create policy "reports: create own"
on public.reports for insert
to authenticated
with check (
  reporter_id = (select auth.uid())
  and (group_id is null or (select private.is_group_member(group_id)))
);

create policy "calendar_connections: read own"
on public.calendar_connections for select
to authenticated
using (user_id = (select auth.uid()));

create policy "calendar_connections: delete own"
on public.calendar_connections for delete
to authenticated
using (user_id = (select auth.uid()));
