-- Activity feed, comments, notifications, push tokens and app config.

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  verb text not null,
  subject_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity is 'Group feed. Written only by triggers.';

create index activity_group_id_created_at_idx on public.activity (group_id, created_at desc);
create index activity_actor_id_idx on public.activity (actor_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  expense_id uuid references public.expenses (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((expense_id is null) <> (event_id is null))
);

comment on column public.comments.group_id is 'Copied from the expense or event on insert, used by RLS.';

create index comments_group_id_idx on public.comments (group_id);
create index comments_expense_id_idx on public.comments (expense_id, created_at);
create index comments_event_id_idx on public.comments (event_id, created_at);
create index comments_author_id_idx on public.comments (author_id);

-- group_id is always derived from the parent, whatever the client sent.
create or replace function private.comments_set_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expense_id is not null then
    select e.group_id into new.group_id from public.expenses e where e.id = new.expense_id;
  else
    select ev.group_id into new.group_id from public.events ev where ev.id = new.event_id;
  end if;
  return new;
end;
$$;

create trigger comments_set_group
before insert on public.comments
for each row execute function private.comments_set_group();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.push_tokens (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  token text not null check (char_length(token) <= 2048),
  platform public.push_platform not null,
  subscription jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is 'Feature flags and min_client_version. Readable by everyone.';

create trigger app_config_set_updated_at
before update on public.app_config
for each row execute function private.set_updated_at();

insert into public.app_config (key, value) values
  ('calendar_import', 'false'),
  ('google_auth', 'false'),
  ('apple_auth', 'false'),
  ('web_push', 'true'),
  ('multi_currency', 'true'),
  ('recurring', 'true'),
  ('min_client_version', '{"web": "0.0.0", "ios": "0.0.0", "android": "0.0.0"}')
on conflict (key) do nothing;

revoke all on table public.activity, public.comments, public.notifications,
  public.push_tokens, public.app_config from anon, authenticated;

grant select on table public.activity to authenticated;
grant select on table public.comments to authenticated;
grant insert (expense_id, event_id, body) on table public.comments to authenticated;
grant update (body, deleted_at) on table public.comments to authenticated;
grant select, delete on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select, insert, update, delete on table public.push_tokens to authenticated;
grant select on table public.app_config to anon, authenticated;

grant all on table public.activity, public.comments, public.notifications,
  public.push_tokens, public.app_config to service_role;
