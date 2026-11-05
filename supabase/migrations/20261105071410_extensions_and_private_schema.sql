-- Extensions and the private schema that holds helpers not exposed over the Data API.

create extension if not exists pgcrypto with schema extensions;

-- Internal schema: policy helpers, trigger functions, cron jobs.
-- It is not listed in [api].schemas, so nothing here is reachable through PostgREST.
create schema if not exists private;
revoke all on schema private from public;
-- Policies evaluate helper functions as the calling role, so API roles need usage.
grant usage on schema private to anon, authenticated, service_role;

-- New functions in private are not executable by default; grant per function.
alter default privileges in schema private revoke execute on functions from public;

-- Keeps updated_at current on every row change.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Lenient uuid cast used by storage policies on user supplied folder names.
create or replace function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

grant execute on function private.try_uuid(text) to anon, authenticated, service_role;

-- Url-safe random code for invite links (base64url, no padding).
create or replace function private.random_code(bytes int default 9)
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(bytes), 'base64'), '+/=', '-_');
$$;
