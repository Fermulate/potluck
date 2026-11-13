-- Two-step sign in: the pre-request check, the realtime gate and recovery codes
-- (20261113100257_two_factor_enforcement).
begin;
select plan(25);

select tests.create_user('alice');
select tests.create_user('bob');
select tests.create_user('carol');
select tests.remember('g', tests.group_with('alice', array['bob'], '{}', 'Two step crew'));

-- alice has a verified authenticator; carol started one but never finished it.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values
  (gen_random_uuid(), tests.uid('alice'), 'phone', 'totp', 'verified', now(), now(), 'secret'),
  (gen_random_uuid(), tests.uid('carol'), 'phone', 'totp', 'unverified', now(), now(), 'secret');

insert into public.notifications (user_id, type, data) values (tests.uid('alice'), 'member.joined', '{}');

-- Adds the `aal` claim to the current test login.
create function pg_temp.aal(level text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('aal', level))::text,
    true
  );
$$;
grant execute on function pg_temp.aal(text) to authenticated, anon;

select is(
  (select setting from pg_db_role_setting s, unnest(s.setconfig) setting
   where s.setrole = 'authenticator'::regrole and setting like 'pgrst.db_pre_request=%'),
  'pgrst.db_pre_request=private.check_request',
  'PostgREST runs the two-step check before every request'
);

-- Without a factor, aal1 is enough.
select tests.login('bob');
select pg_temp.aal('aal1');
select ok(private.mfa_satisfied(), 'no factor: aal1 passes');
select lives_ok($$ select private.check_request() $$, 'no factor: requests go through');
select is((select count(*)::int from public.group_members), 2, 'no factor: realtime tables readable');

select tests.login('carol');
select pg_temp.aal('aal1');
select ok(private.mfa_satisfied(), 'an unfinished factor does not count');

-- With a verified factor, aal1 is refused everywhere.
select tests.login('alice');
select pg_temp.aal('aal1');
select ok(not private.mfa_satisfied(), 'verified factor at aal1 fails the check');
select throws_ok($$ select private.check_request() $$, '42501', 'mfa_required', 'aal1 requests are refused');
select is((select count(*)::int from public.group_members), 0, 'aal1 sees no group_members rows');
select is((select count(*)::int from public.notifications), 0, 'aal1 sees no notifications');
select throws_ok(
  $$ select public.create_mfa_recovery_codes() $$, '42501', 'mfa_required',
  'recovery codes need aal2'
);

-- A token without the claim counts as aal1.
select tests.login('alice');
select ok(not private.mfa_satisfied(), 'missing aal claim is aal1');

select tests.login('alice');
select pg_temp.aal('aal2');
select ok(private.mfa_satisfied(), 'aal2 passes');
select lives_ok($$ select private.check_request() $$, 'aal2 requests go through');
select is((select count(*)::int from public.group_members), 2, 'aal2 sees group_members');
select ok((select count(*) from public.notifications) > 0, 'aal2 sees notifications');

select tests.login_anon();
select lives_ok($$ select private.check_request() $$, 'anon requests are left to RLS');

-- Recovery codes
select tests.login('alice');
select pg_temp.aal('aal2');
select ok(
  (select bool_and(c ~ '^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$') and count(*) = 10
   from public.create_mfa_recovery_codes() c),
  'ten codes like ABCDE-23456'
);
select set_config('tests.old_code', (select c from public.create_mfa_recovery_codes() c limit 1), true);
select set_config('tests.code', (select c from public.create_mfa_recovery_codes() c limit 1), true);
select is(public.mfa_recovery_codes_left(), 10, 'new codes replace the old ones');
select throws_ok(
  $$ select count(*) from private.mfa_recovery_codes $$, '42501', null,
  'clients cannot read the hashes'
);

select tests.login('bob');
select is(public.mfa_recovery_codes_left(), 0, 'nobody else sees your count');
select ok(
  not has_function_privilege('authenticated', 'public.mfa_recovery_code_matches(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.forget_mfa_recovery_codes(uuid)', 'execute'),
  'only the service role checks and clears codes'
);

reset role;
select ok(
  public.mfa_recovery_code_matches(tests.uid('alice'), lower(replace(current_setting('tests.code'), '-', ' '))),
  'a code matches whatever its case and separator'
);
select ok(
  not public.mfa_recovery_code_matches(tests.uid('alice'), current_setting('tests.old_code')),
  'replaced codes no longer match'
);
select ok(
  not public.mfa_recovery_code_matches(tests.uid('bob'), current_setting('tests.code')),
  'a code only matches its owner'
);
select public.forget_mfa_recovery_codes(tests.uid('alice'));

select tests.login('alice');
select pg_temp.aal('aal2');
select is(public.mfa_recovery_codes_left(), 0, 'forgetting clears every code');

select * from finish();
rollback;
