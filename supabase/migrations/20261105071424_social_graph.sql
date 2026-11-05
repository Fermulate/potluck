-- Friendships, blocks and abuse reports.

create table public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

comment on table public.friendships is 'Stored in both directions. Created when two users share a group.';

create index friendships_friend_id_idx on public.friendships (friend_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on public.blocks (blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject_user_id uuid references public.profiles (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (subject_user_id is not null or group_id is not null)
);

create index reports_reporter_id_idx on public.reports (reporter_id);
create index reports_subject_user_id_idx on public.reports (subject_user_id);
create index reports_group_id_idx on public.reports (group_id);

-- Joining a group befriends every other member (both directions), unless one
-- of them has blocked the other.
create or replace function private.befriend_group_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.friendships (user_id, friend_id)
  select pair.a, pair.b
  from public.group_members m
  cross join lateral (
    values (new.user_id, m.user_id), (m.user_id, new.user_id)
  ) as pair (a, b)
  where m.group_id = new.group_id
    and m.user_id <> new.user_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = new.user_id and b.blocked_id = m.user_id)
         or (b.blocker_id = m.user_id and b.blocked_id = new.user_id)
    )
  on conflict do nothing;

  return null;
end;
$$;

create trigger group_members_befriend
after insert on public.group_members
for each row execute function private.befriend_group_members();

revoke all on table public.friendships, public.blocks, public.reports from anon, authenticated;
grant select, delete on table public.friendships to authenticated;
grant select, insert, delete on table public.blocks to authenticated;
grant select, insert on table public.reports to authenticated;
grant all on table public.friendships, public.blocks, public.reports to service_role;
