-- delete_my_account()
begin;
select plan(20);

select tests.create_user('leaver', 'Lena Leaver');
select tests.create_user('admin');
select tests.create_user('friend');
select tests.create_user('other');

-- solo: only the leaver -> deleted
select tests.remember('solo', tests.group_with('leaver', '{}', '{}', 'Solo'));
-- owned: leaver owns, admin should inherit even though friend joined first
select tests.remember('owned', tests.group_with('leaver', array['friend'], '{}', 'Owned'));
reset role;
insert into public.group_members (group_id, user_id, role, joined_at)
values (tests.id('owned'), tests.uid('admin'), 'admin', now() + interval '1 minute');
-- debt: leaver owes money here -> membership kept
select tests.remember('debt', tests.group_with('other', array['leaver'], '{}', 'Debt'));
-- clean: leaver is a settled member -> membership removed
select tests.remember('clean', tests.group_with('other', array['leaver'], '{}', 'Clean'));

select tests.login('other');
select create_expense(jsonb_build_object('group_id', tests.id('debt'), 'description', 'Lunch', 'amount_cents', 2000,
  'splits', tests.people('other', 'leaver')));
select tests.login('leaver');
select create_invite(tests.id('owned'));
update public.profiles set avatar_path = tests.uid('leaver') || '/me.png', timezone = 'Europe/Paris' where id = tests.uid('leaver');
insert into public.push_tokens (token, platform) values ('tok', 'web');
insert into public.busy_blocks (starts_at, ends_at) values (now(), now() + interval '1 hour');

select tests.login_anon();
select throws_ok($$ select delete_my_account() $$, '42501', null, 'anon cannot call it');

select tests.login('leaver');
select lives_ok($$ select delete_my_account() $$, 'account closed');

reset role;
select results_eq(
  $$ select display_name, avatar_path, timezone, deleted_at is not null from public.profiles where id = tests.uid('leaver') $$,
  $$ values ('Former member'::text, null::text, 'UTC'::text, true) $$,
  'profile is tombstoned'
);
select is((select count(*)::int from auth.users where id = tests.uid('leaver')), 1, 'the auth user is left for the edge function');
select is((select count(*)::int from public.groups where id = tests.id('solo')), 0, 'a group with nobody else is deleted');
select is(
  (select user_id from public.group_members where group_id = tests.id('owned') and role = 'owner'),
  tests.uid('admin'),
  'ownership passes to the admin first'
);
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('owned') and user_id = tests.uid('leaver')),
  0,
  'settled memberships are removed'
);
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('debt') and user_id = tests.uid('leaver')),
  1,
  'memberships with an open balance stay'
);
select is(
  (select net_cents from public.group_balances where group_id = tests.id('debt') and user_id = tests.uid('leaver')),
  -1000::bigint,
  'and the debt is still visible'
);
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('clean') and user_id = tests.uid('leaver')),
  0,
  'zero-balance memberships are removed'
);
select is((select count(*)::int from public.push_tokens where user_id = tests.uid('leaver')), 0, 'push tokens removed');
select is((select count(*)::int from public.busy_blocks where user_id = tests.uid('leaver')), 0, 'busy blocks removed');
select is(
  (select count(*)::int from public.friendships where user_id = tests.uid('leaver') or friend_id = tests.uid('leaver')),
  0,
  'friendships removed'
);
select is(
  (select count(*)::int from public.group_invites where created_by = tests.uid('leaver') and revoked_at is null),
  0,
  'open invites revoked'
);

select tests.login('other');
select is(
  (select display_name from public.profiles where id = tests.uid('leaver')),
  'Former member',
  'others see the tombstone name'
);

select tests.login('leaver');
select lives_ok($$ select delete_my_account() $$, 'calling again is harmless');
select throws_ok(
  $$ select create_group('Comeback') $$,
  '42501', 'account_deleted', 'a closed account cannot use RPCs'
);
select throws_ok(
  $$ select settle_up(tests.id('debt'), tests.uid('other'), 1000) $$,
  '42501', 'account_deleted', 'not even to settle'
);

select tests.login('other');
select throws_ok(
  $$ select transfer_ownership(tests.id('debt'), tests.uid('leaver')) $$,
  'PT404', 'member_not_found', 'closed accounts cannot receive ownership'
);
select set_config('tests.code', (select code from create_invite(tests.id('debt'))), true);
select is(
  (select first_names from invite_preview(current_setting('tests.code'))),
  array['Other'],
  'closed accounts are not shown on invite previews'
);

select * from finish();
rollback;
