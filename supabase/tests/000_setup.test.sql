-- Test helpers, installed once before the other test files run (files run in
-- name order). Lives in its own `tests` schema, never in migrations.
--
--   tests.create_user('alice')            auth user alice@test.local, returns id
--   tests.uid('alice')                    id of a test user
--   tests.login('alice')                  become that user (role authenticated + JWT claims)
--   tests.login_anon()                    become an anonymous visitor
--   reset role                            back to the superuser (plain SQL)
--   tests.group_with(owner, members[], admins[], name)  group built directly, returns id
--   tests.remember('g', id) / tests.id('g')             stash ids for later statements

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.create_user(handle text, display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    handle || '@test.local', '', now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('display_name', coalesce(display_name, initcap(handle) || ' Tester')),
    now(), now()
  );
  return new_id;
end;
$$;

create or replace function tests.uid(handle text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  select u.id into found_id from auth.users u where u.email = handle || '@test.local';
  if found_id is null then
    raise exception 'test user % does not exist', handle;
  end if;
  return found_id;
end;
$$;

create or replace function tests.login(handle text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  id uuid := tests.uid(handle);
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', id,
    'role', 'authenticated',
    'aud', 'authenticated',
    'email', handle || '@test.local'
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.login_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Builds a group as the superuser, skipping the RPCs.
create or replace function tests.group_with(
  owner_handle text,
  member_handles text[] default '{}',
  admin_handles text[] default '{}',
  group_name text default 'Test group',
  group_currency text default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
  h text;
begin
  insert into public.groups (name, currency, created_by)
  values (group_name, group_currency, tests.uid(owner_handle))
  returning id into gid;

  insert into public.group_members (group_id, user_id, role)
  values (gid, tests.uid(owner_handle), 'owner');

  foreach h in array admin_handles loop
    insert into public.group_members (group_id, user_id, role) values (gid, tests.uid(h), 'admin');
  end loop;
  foreach h in array member_handles loop
    insert into public.group_members (group_id, user_id, role) values (gid, tests.uid(h), 'member');
  end loop;

  return gid;
end;
$$;

-- Stash ids in transaction-local settings so any role can read them back.
create or replace function tests.remember(key text, value uuid)
returns uuid
language sql
set search_path = ''
as $$
  select set_config('tests.' || key, value::text, true)::uuid;
$$;

create or replace function tests.id(key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('tests.' || key, true), '')::uuid;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

begin;
select plan(1);
select ok(true, 'test helpers installed');
select * from finish();
rollback;
