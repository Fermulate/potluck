-- Groups, membership and invite links.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  emoji text check (char_length(emoji) <= 16),
  color text check (char_length(color) <= 32),
  cover_path text,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  simplify_debts boolean not null default true,
  members_can_invite boolean not null default true,
  is_direct boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on column public.groups.is_direct is 'Hidden two-person group used for 1:1 expenses between friends.';

create index groups_created_by_idx on public.groups (created_by);

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- At most one owner per group; the deferred trigger below enforces at least one.
create unique index group_members_one_owner_idx
  on public.group_members (group_id)
  where role = 'owner';
create index group_members_user_id_idx on public.group_members (user_id);

-- Exactly one owner per group, checked at commit so ownership transfers can
-- demote and promote inside one transaction.
create or replace function private.check_group_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
  owners int;
begin
  if tg_table_name = 'groups' then
    gid := new.id;
  elsif tg_op = 'DELETE' then
    gid := old.group_id;
  else
    gid := new.group_id;
  end if;

  if not exists (select 1 from public.groups g where g.id = gid) then
    return null;
  end if;

  select count(*) into owners
  from public.group_members m
  where m.group_id = gid and m.role = 'owner';

  if owners <> 1 then
    raise exception using
      message = 'A group must have exactly one owner',
      hint = 'group_owner_required',
      errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger group_members_owner_check
after insert or update or delete on public.group_members
deferrable initially deferred
for each row execute function private.check_group_has_owner();

create constraint trigger groups_owner_check
after insert on public.groups
deferrable initially deferred
for each row execute function private.check_group_has_owner();

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  code text not null unique default private.random_code(9)
    check (code ~ '^[A-Za-z0-9_-]{10,64}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  role public.group_role not null default 'member' check (role <> 'owner'),
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index group_invites_group_id_idx on public.group_invites (group_id);
create index group_invites_created_by_idx on public.group_invites (created_by);

revoke all on table public.groups, public.group_members, public.group_invites from anon, authenticated;

grant select, delete on table public.groups to authenticated;
grant update (name, emoji, color, cover_path, currency, simplify_debts, members_can_invite, archived_at)
  on table public.groups to authenticated;

grant select on table public.group_members to authenticated;

grant select, delete on table public.group_invites to authenticated;
grant update (revoked_at) on table public.group_invites to authenticated;

grant all on table public.groups, public.group_members, public.group_invites to service_role;
