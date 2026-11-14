-- Sessions signed out elsewhere: the pre-request check refuses a token whose session is gone
-- (20261114072312_signed_out_sessions).
begin;
select plan(8);

select tests.create_user('ava');
select tests.create_user('ben');

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('5e551011-0000-4000-8000-000000000001', tests.uid('ava'), now(), now()),
  ('5e551011-0000-4000-8000-000000000002', tests.uid('ava'), now(), now()),
  ('5e551011-0000-4000-8000-000000000003', tests.uid('ben'), now(), now());

-- Adds the `session_id` claim to the current test login, as Supabase Auth puts it in tokens.
create function pg_temp.on_session(sid text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('session_id', sid))::text,
    true
  );
$$;
grant execute on function pg_temp.on_session(text) to authenticated, anon;

select tests.login('ava');
select lives_ok($$ select private.check_request() $$, 'a token without a session id is left alone');

select pg_temp.on_session('5e551011-0000-4000-8000-000000000001');
select ok(private.session_active(), 'a live session is active');
select lives_ok($$ select private.check_request() $$, 'a live session goes through');

-- Sign out everywhere: Supabase Auth deletes every session of the account.
reset role;
delete from auth.sessions where user_id = tests.uid('ava');

select tests.login('ava');
select pg_temp.on_session('5e551011-0000-4000-8000-000000000002');
select ok(not private.session_active(), 'a signed out session is not active');
select throws_ok(
  $$ select private.check_request() $$, '42501', 'session_ended',
  'a token from a signed out session is refused before anything else'
);

select tests.login('ben');
select pg_temp.on_session('5e551011-0000-4000-8000-000000000003');
select lives_ok($$ select private.check_request() $$, 'other accounts keep their sessions');

select tests.login('ben');
select pg_temp.on_session('not-a-session');
select lives_ok($$ select private.check_request() $$, 'a malformed claim is left to Supabase Auth');

select tests.login_anon();
select lives_ok($$ select private.check_request() $$, 'signed out callers are left to RLS');

select * from finish();
rollback;
