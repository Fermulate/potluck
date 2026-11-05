-- Hooks from the database into Edge Functions, and the calendar feed token.
--
-- Calls go out through pg_net. The project URL and a shared secret live in
-- Vault (`project_url`, `edge_secret`) and are set once per environment:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random>', 'edge_secret');
-- When either is missing (local stack, CI) the hooks do nothing, so tests and
-- local development never call out.

create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'edge_secret';
  if base_url is null or secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/' || fn,
    body := body,
    headers := jsonb_build_object('content-type', 'application/json', 'x-potluck-secret', secret),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke execute on function private.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- Every new notification fans out to push (web now, Expo later).
create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.invoke_edge_function(
    'notify',
    jsonb_build_object('id', new.id, 'user_id', new.user_id, 'type', new.type, 'data', new.data)
  );
  return null;
end;
$$;

revoke execute on function private.push_notification() from public, anon, authenticated;

create trigger notifications_push
after insert on public.notifications
for each row execute function private.push_notification();

-- Daily FX rates. The ECB publishes around 16:00 CET.
select cron.schedule('fx-sync', '30 16 * * *', $$select private.invoke_edge_function('fx-sync')$$);

-- Personal calendar feed (.ics). The token is the only credential for the
-- feed URL, so it is long, random, and can be rotated.
create table public.calendar_feed_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  created_at timestamptz not null default now()
);

comment on table public.calendar_feed_tokens is 'Secret token per user for the ics-feed edge function. Read only by its owner.';

alter table public.calendar_feed_tokens enable row level security;

revoke all on table public.calendar_feed_tokens from anon, authenticated;
grant select on table public.calendar_feed_tokens to authenticated;
grant all on table public.calendar_feed_tokens to service_role;

create policy "owners read their feed token"
on public.calendar_feed_tokens for select
to authenticated
using (user_id = (select auth.uid()));

-- Returns the caller's feed token, creating it (or a fresh one when rotate is
-- true, which breaks old subscriptions).
create or replace function public.calendar_feed_token(rotate boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result text;
begin
  if uid is null then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;

  if rotate then
    delete from public.calendar_feed_tokens t where t.user_id = uid;
  end if;

  insert into public.calendar_feed_tokens (user_id, token)
  values (uid, private.random_code(24))
  on conflict (user_id) do nothing;

  select t.token into result from public.calendar_feed_tokens t where t.user_id = uid;
  return result;
end;
$$;

revoke execute on function public.calendar_feed_token(boolean) from public, anon;
grant execute on function public.calendar_feed_token(boolean) to authenticated, service_role;

-- Hosted projects ship an event-trigger helper in public that the API roles
-- should not call directly. It does not exist on the local stack.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
