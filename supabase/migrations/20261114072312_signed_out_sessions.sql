-- "Sign out everywhere" and a password change delete the account's other sessions in Supabase
-- Auth, but an access token already handed out stays valid until it expires (up to an hour).
-- PostgREST does not ask Auth about it, so another device kept loading pages until then.
--
-- Every access token names its session (`session_id`). The pre-request hook now refuses a token
-- whose session is gone with `session_ended` (42501); the app signs that device out when it sees
-- it. Tokens without the claim (the service role, signed out callers, pgTAP logins) pass.
--
-- check_request: body as in 20261113100257_two_factor_enforcement plus the session check first.

-- True unless the caller's token names a session that no longer exists.
create or replace function private.session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select auth.jwt() ->> 'session_id'), '') !~ '^[0-9a-fA-F-]{36}$' then true
    else exists (
      select 1 from auth.sessions s
      where s.id = ((select auth.jwt() ->> 'session_id'))::uuid
    )
  end;
$$;

revoke all on function private.session_active() from public;
grant execute on function private.session_active() to anon, authenticated, service_role;

-- PostgREST runs this before every request, after switching to the caller's role.
create or replace function private.check_request() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.session_active() then
    raise exception using
      message = 'session_ended',
      detail = 'This session was signed out',
      errcode = '42501';
  end if;
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

notify pgrst, 'reload config';
