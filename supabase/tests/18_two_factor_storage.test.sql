-- Two-step sign in, continued (20261113090527_two_factor_storage_and_limits): storage refuses an
-- unfinished sign in, recovery tries are limited, and codes go when two-step sign in goes.
begin;
select plan(17);

select tests.create_user('alice');
select tests.create_user('bob');
select tests.remember('g', tests.group_with('alice', array['bob'], '{}', 'Storage crew'));

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-8000-0000000000f1', tests.uid('alice'), 'phone', 'totp', 'verified', now(), now(), 'secret');

-- A receipt in the group, put there before anyone signs in.
insert into storage.objects (bucket_id, name, owner_id)
values ('receipts', tests.id('g') || '/dinner.png', tests.uid('bob'));

create function pg_temp.aal(level text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('aal', level))::text,
    true
  );
$$;
create function pg_temp.put(bucket text, path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id) values (bucket, path, auth.uid()::text)
$$;
grant execute on function pg_temp.aal(text) to authenticated;
grant execute on function pg_temp.put(text, text) to authenticated;

-- Storage at aal1, with a verified factor: nothing.
select tests.login('alice');
select pg_temp.aal('aal1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts'),
  0,
  'aal1 cannot list or download receipts'
);
select throws_ok(
  format($$ select pg_temp.put('receipts', '%s/evil.png') $$, tests.id('g')),
  '42501', null, 'aal1 cannot upload a receipt'
);
select throws_ok(
  format($$ select pg_temp.put('avatars', '%s/evil.png') $$, tests.uid('alice')),
  '42501', null, 'aal1 cannot upload an avatar'
);
select throws_ok(
  format($$ select pg_temp.put('group-covers', '%s/evil.jpg') $$, tests.id('g')),
  '42501', null, 'aal1 cannot upload a group cover'
);
update storage.objects set name = name || '.bak' where bucket_id = 'receipts';
reset role;
select is(
  (select name from storage.objects where bucket_id = 'receipts'),
  tests.id('g') || '/dinner.png',
  'aal1 cannot replace a receipt'
);

-- The same person at aal2: as before.
select tests.login('alice');
select pg_temp.aal('aal2');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts'),
  1,
  'aal2 reads receipts'
);
select lives_ok(
  format($$ select pg_temp.put('receipts', '%s/lunch.png') $$, tests.id('g')),
  'aal2 uploads a receipt'
);
select lives_ok(
  format($$ select pg_temp.put('avatars', '%s/me.png') $$, tests.uid('alice')),
  'aal2 uploads an avatar'
);

-- Without a factor, aal1 is a full sign in.
select tests.login('bob');
select pg_temp.aal('aal1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts'),
  2,
  'no factor: aal1 reads receipts'
);
select lives_ok(
  format($$ select pg_temp.put('avatars', '%s/me.png') $$, tests.uid('bob')),
  'no factor: aal1 uploads an avatar'
);

-- Recovery tries: five per fifteen minutes, service role only.
select ok(
  not has_function_privilege('authenticated', 'public.record_mfa_recover_attempt(uuid)', 'execute'),
  'clients cannot record tries'
);
reset role;
select is(
  (select array_agg(public.record_mfa_recover_attempt(tests.uid('alice'))) from generate_series(1, 6)),
  array[true, true, true, true, true, false],
  'the sixth try in fifteen minutes is refused'
);
select ok(public.record_mfa_recover_attempt(tests.uid('bob')), 'the limit is per account');
update private.mfa_recover_attempts set attempted_at = now() - interval '16 minutes'
where user_id = tests.uid('alice');
select ok(public.record_mfa_recover_attempt(tests.uid('alice')), 'tries older than the window do not count');

-- Clearing codes.
select tests.login('alice');
select pg_temp.aal('aal2');
select public.create_mfa_recovery_codes();
select is(public.clear_mfa_recovery_codes(), 0, 'codes stay while two-step sign in is on');
reset role;
delete from auth.mfa_factors where user_id = tests.uid('alice');
select tests.login('alice');
select is(public.clear_mfa_recovery_codes(), 10, 'turning it off clears the codes');
select is(public.mfa_recovery_codes_left(), 0, 'nothing left after clearing');

select * from finish();
rollback;
