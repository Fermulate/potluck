-- Two-step sign in (TOTP through Supabase Auth) is enforced by the database, not only by the
-- app (ADR 11). Someone who knows a password but not the code gets an aal1 session; with it:
--
-- 1. every REST and RPC call fails with mfa_required (42501), through a PostgREST pre-request
--    hook, private.check_request();
-- 2. Realtime, which does not go through PostgREST, sends no rows: the published tables get a
--    restrictive select policy on the same check;
-- 3. recovery codes live hashed in private.mfa_recovery_codes. The app creates them with
--    create_mfa_recovery_codes() (aal2 only) and counts them with mfa_recovery_codes_left();
--    only the mfa-recover edge function (service role) checks and clears them.

-- The check ----------------------------------------------------------------------------------

-- True unless the caller has a verified second factor and their token is only aal1. Signed out
-- callers and the service role (no `sub`) pass: their access is decided elsewhere.
create or replace function private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is null
    or coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    );
$$;

revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to anon, authenticated, service_role;

-- PostgREST runs this before every request, after switching to the caller's role.
create or replace function private.check_request() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.mfa_satisfied() then
    raise exception using
      message = 'mfa_required',
      detail = 'Finish two-step sign in first',
      errcode = '42501';
  end if;
end;
$$;

revoke all on function private.check_request() from public;
grant execute on function private.check_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'private.check_request';
notify pgrst, 'reload config';

-- Realtime ----------------------------------------------------------------------------------

create policy "activity: two-step sign in done" on public.activity
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "availability: two-step sign in done" on public.availability
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "event_rsvps: two-step sign in done" on public.event_rsvps
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "events: two-step sign in done" on public.events
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "expense_splits: two-step sign in done" on public.expense_splits
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "expenses: two-step sign in done" on public.expenses
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "group_members: two-step sign in done" on public.group_members
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "notifications: two-step sign in done" on public.notifications
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));
create policy "settlements: two-step sign in done" on public.settlements
  as restrictive for select to authenticated using ((select private.mfa_satisfied()));

-- Recovery codes ----------------------------------------------------------------------------

create table private.mfa_recovery_codes (
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, code_hash)
);

comment on table private.mfa_recovery_codes is
  'SHA-256 of each unused two-step recovery code. Codes are random, so no salt is needed.';

revoke all on table private.mfa_recovery_codes from public, anon, authenticated;

-- Codes are shown as XXXXX-XXXXX; spaces, dashes and case do not matter when typed back.
create or replace function private.recovery_code_hash(code text) returns text
language sql immutable set search_path = '' as $$
  select encode(
    extensions.digest(upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')), 'sha256'),
    'hex'
  );
$$;

revoke all on function private.recovery_code_hash(text) from public;

-- Ten fresh codes, returned once in plain text; any older codes stop working.
create or replace function public.create_mfa_recovery_codes() returns setof text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  -- 32 symbols without 0, O, 1 and I, so a byte modulo 32 picks each one equally often.
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea;
  code text;
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception using
      message = 'mfa_required',
      detail = 'Recovery codes need a two-step sign in',
      errcode = '42501';
  end if;

  delete from private.mfa_recovery_codes where user_id = uid;
  for i in 1..10 loop
    bytes := extensions.gen_random_bytes(10);
    code := '';
    for j in 0..9 loop
      code := code || substr(alphabet, get_byte(bytes, j) % 32 + 1, 1);
    end loop;
    insert into private.mfa_recovery_codes (user_id, code_hash)
    values (uid, private.recovery_code_hash(code))
    on conflict do nothing;
    return next substr(code, 1, 5) || '-' || substr(code, 6, 5);
  end loop;
end;
$$;

revoke execute on function public.create_mfa_recovery_codes() from public, anon;
grant execute on function public.create_mfa_recovery_codes() to authenticated, service_role;

create or replace function public.mfa_recovery_codes_left() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from private.mfa_recovery_codes r where r.user_id = (select auth.uid());
$$;

revoke execute on function public.mfa_recovery_codes_left() from public, anon;
grant execute on function public.mfa_recovery_codes_left() to authenticated, service_role;

-- Service role only (the mfa-recover edge function): does `code` belong to `target`? The
-- function then removes the factors and calls forget_mfa_recovery_codes.
create or replace function public.mfa_recovery_code_matches(target uuid, code text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.mfa_recovery_codes r
    where r.user_id = target and r.code_hash = private.recovery_code_hash(code)
  );
$$;

revoke execute on function public.mfa_recovery_code_matches(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mfa_recovery_code_matches(uuid, text) to service_role;

create or replace function public.forget_mfa_recovery_codes(target uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from private.mfa_recovery_codes r where r.user_id = target;
$$;

revoke execute on function public.forget_mfa_recovery_codes(uuid)
  from public, anon, authenticated;
grant execute on function public.forget_mfa_recovery_codes(uuid) to service_role;
