-- Public profile for every auth user. Rows are created by a trigger on auth.users
-- and never hard deleted by the app: delete_my_account() turns them into tombstones
-- so shared expense history stays intact.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  avatar_path text,
  timezone text not null default 'UTC',
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  locale text not null default 'en',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. Tombstoned (not deleted) when an account is closed.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- Display name comes from sign-up metadata, OAuth profile, or the email local part.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text;
begin
  name := nullif(btrim(coalesce(
    meta ->> 'display_name',
    meta ->> 'full_name',
    meta ->> 'name',
    split_part(coalesce(new.email, ''), '@', 1)
  )), '');

  insert into public.profiles (id, display_name, timezone, locale)
  values (
    new.id,
    left(coalesce(name, 'New member'), 80),
    coalesce(nullif(meta ->> 'timezone', ''), 'UTC'),
    coalesce(nullif(meta ->> 'locale', ''), 'en')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Explicit grants: tables are not exposed to the Data API unless granted.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_path, timezone, default_currency, locale)
  on table public.profiles to authenticated;
grant all on table public.profiles to service_role;
