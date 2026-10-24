-- create_group, set_member_role, remove_member, leave_group, transfer_ownership,
-- get_or_create_direct_group.
begin;
select plan(41);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('admin2');
select tests.create_user('member');
select tests.create_user('member2');
select tests.create_user('outsider');

update public.profiles set default_currency = 'EUR' where id = tests.uid('owner');

-- create_group
select tests.login('owner');
select tests.remember('g', (select id from create_group('Hike crew', 'x', 'green')));
select is((select currency from public.groups where id = tests.id('g')), 'EUR'::char(3), 'currency defaults to the creator''s default currency');
select is((select private.group_role(tests.id('g'))), 'owner'::public.group_role, 'creator becomes owner');
select is((select currency from create_group('USD group', null, null, 'usd')), 'USD'::char(3), 'explicit currency is normalized to upper case');
select throws_ok($$ select create_group('   ') $$, '22023', 'group_name_required', 'blank names are rejected');
select throws_ok($$ select create_group('x', null, null, 'EURO') $$, '22023', 'invalid_currency', 'bad currency codes are rejected');

select tests.login_anon();
select throws_ok($$ select create_group('anon group') $$, '42501', null, 'anon cannot create groups');

reset role;
insert into public.group_members (group_id, user_id, role) values
  (tests.id('g'), tests.uid('admin'), 'admin'),
  (tests.id('g'), tests.uid('admin2'), 'admin'),
  (tests.id('g'), tests.uid('member'), 'member'),
  (tests.id('g'), tests.uid('member2'), 'member');

-- set_member_role
select tests.login('member');
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('member2'), 'admin') $$,
  '42501', 'not_allowed', 'members cannot change roles'
);

select tests.login('outsider');
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('member2'), 'admin') $$,
  '42501', 'not_a_member', 'outsiders cannot change roles'
);

select tests.login('admin');
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('admin2'), 'member') $$,
  '42501', 'not_allowed', 'admins cannot demote other admins'
);
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('owner'), 'member') $$,
  '42501', 'cannot_change_owner', 'nobody changes the owner''s role'
);
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('member'), 'owner') $$,
  '22023', 'use_transfer_ownership', 'owner role is only reachable by transfer'
);
select lives_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('member2'), 'admin') $$,
  'admins can promote a member'
);
select is((select role from public.group_members where group_id = tests.id('g') and user_id = tests.uid('member2')), 'admin'::public.group_role, 'promotion stuck');

select tests.login('owner');
select lives_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('member2'), 'member') $$,
  'the owner can demote an admin'
);
select throws_ok(
  $$ select set_member_role(tests.id('g'), tests.uid('outsider'), 'admin') $$,
  'PT404', 'member_not_found', 'target must be a member'
);

-- remove_member
select tests.login('member');
select throws_ok(
  $$ select remove_member(tests.id('g'), tests.uid('member2')) $$,
  '42501', 'not_allowed', 'members cannot remove people'
);

select tests.login('admin');
select throws_ok(
  $$ select remove_member(tests.id('g'), tests.uid('admin2')) $$,
  '42501', 'not_allowed', 'admins cannot remove admins'
);
select throws_ok(
  $$ select remove_member(tests.id('g'), tests.uid('owner')) $$,
  '42501', 'cannot_remove_owner', 'nobody removes the owner'
);
select throws_ok(
  $$ select remove_member(tests.id('g'), tests.uid('admin')) $$,
  '22023', 'use_leave_group', 'remove_member is not for yourself'
);

-- A balance blocks removal.
select tests.login('owner');
select create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Snacks', 'amount_cents', 1000,
  'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('member2')))
));
select tests.login('admin');
select throws_ok(
  $$ select remove_member(tests.id('g'), tests.uid('member2')) $$,
  '23514', 'member_has_balance', 'members with a balance cannot be removed'
);
select lives_ok($$ select remove_member(tests.id('g'), tests.uid('member')) $$, 'admins remove members with no balance');
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('g') and user_id = tests.uid('member')),
  0, 'member is gone'
);

select tests.login('owner');
select lives_ok($$ select remove_member(tests.id('g'), tests.uid('admin2')) $$, 'the owner removes admins');

-- leave_group
select tests.login('member2');
select throws_ok(
  $$ select leave_group(tests.id('g')) $$,
  '23514', 'member_has_balance', 'cannot leave with a balance'
);
select settle_up(tests.id('g'), tests.uid('owner'), 1000);
select lives_ok($$ select leave_group(tests.id('g')) $$, 'can leave once settled');
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('g') and user_id = tests.uid('member2')),
  0, 'left the group'
);
select tests.login('member2');
select is((select count(*)::int from public.groups where id = tests.id('g')), 0, 'a former member no longer sees the group');

select tests.login('owner');
select throws_ok(
  $$ select leave_group(tests.id('g')) $$,
  '23514', 'owner_must_transfer', 'the owner must hand over first'
);

-- transfer_ownership
select tests.login('admin');
select throws_ok(
  $$ select transfer_ownership(tests.id('g'), tests.uid('admin')) $$,
  '42501', 'not_allowed', 'admins cannot take ownership'
);
select tests.login('owner');
select throws_ok(
  $$ select transfer_ownership(tests.id('g'), tests.uid('outsider')) $$,
  'PT404', 'member_not_found', 'new owner must be a member'
);
select lives_ok($$ select transfer_ownership(tests.id('g'), tests.uid('admin')) $$, 'owner hands over');
select results_eq(
  $$ select user_id, role from public.group_members where group_id = tests.id('g') order by role, user_id $$,
  $$ values (tests.uid('admin'), 'owner'::public.group_role), (tests.uid('owner'), 'admin'::public.group_role) $$,
  'new owner promoted, old owner became admin'
);
select lives_ok($$ select leave_group(tests.id('g')) $$, 'the old owner can now leave');

select tests.login('admin');
select lives_ok($$ select leave_group(tests.id('g')) $$, 'the last member leaving...');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('g')), 0, '...deletes the group');

-- get_or_create_direct_group
select tests.remember('h', tests.group_with('owner', array['member']));
select tests.login('owner');
select throws_ok(
  $$ select get_or_create_direct_group(tests.uid('outsider')) $$,
  '42501', 'not_a_friend', 'strangers cannot be split with'
);
select throws_ok(
  $$ select get_or_create_direct_group(tests.uid('owner')) $$,
  '22023', 'invalid_friend', 'not with yourself'
);
select tests.remember('d', get_or_create_direct_group(tests.uid('member')));
select is((select is_direct from public.groups where id = tests.id('d')), true, 'creates a hidden direct group');
select is(get_or_create_direct_group(tests.uid('member')), tests.id('d'), 'returns the same group the second time');

select tests.login('member');
select is(get_or_create_direct_group(tests.uid('owner')), tests.id('d'), 'and from the other side');

insert into public.blocks (blocker_id, blocked_id) values (tests.uid('member'), tests.uid('owner'));
reset role;
delete from public.group_members where group_id = tests.id('d');
delete from public.groups where id = tests.id('d');
select tests.login('owner');
select throws_ok(
  $$ select get_or_create_direct_group(tests.uid('member')) $$,
  '42501', 'blocked', 'blocked pairs cannot open a direct group'
);

select * from finish();
rollback;
