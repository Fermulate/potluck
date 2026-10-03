-- Profiles, friendships, blocks, reports.
begin;
select plan(26);

select tests.create_user('alice', 'Alice Doe');
select tests.create_user('bob', 'Bob Roe');
select tests.create_user('stranger', 'Sam Stranger');

-- Signup trigger
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
        'noname.person@test.local', '', '{}', now(), now());

select is(
  (select display_name from public.profiles where id = tests.uid('alice')),
  'Alice Doe',
  'profile is created from signup metadata'
);
select is(
  (select display_name from public.profiles where id = tests.uid('noname.person')),
  'noname.person',
  'display name falls back to the email local part'
);
select is(
  (select timezone || '|' || default_currency || '|' || locale from public.profiles where id = tests.uid('alice')),
  'UTC|USD|en',
  'profile defaults'
);

select tests.remember('g', tests.group_with('alice', array['bob']));

select is(
  (select count(*)::int from public.friendships
   where (user_id, friend_id) in ((tests.uid('alice'), tests.uid('bob')), (tests.uid('bob'), tests.uid('alice')))),
  2,
  'sharing a group creates friendships in both directions'
);

-- Profile visibility
select tests.login('alice');
select is((select count(*)::int from public.profiles where id = tests.uid('alice')), 1, 'sees own profile');
select is((select count(*)::int from public.profiles where id = tests.uid('bob')), 1, 'sees a group mate');
select is((select count(*)::int from public.profiles where id = tests.uid('stranger')), 0, 'does not see strangers');

update public.profiles set display_name = 'Alice D' where id = tests.uid('alice');
select is((select display_name from public.profiles where id = tests.uid('alice')), 'Alice D', 'can rename self');

update public.profiles set display_name = 'Hacked' where id = tests.uid('bob');
reset role;
select is((select display_name from public.profiles where id = tests.uid('bob')), 'Bob Roe', 'cannot rename someone else');

select tests.login('alice');
select throws_ok(
  $$ update public.profiles set deleted_at = now() where id = tests.uid('alice') $$,
  '42501', null, 'deleted_at is not writable by clients'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x') $$,
  '42501', null, 'profiles cannot be inserted by clients'
);

-- Friendships
select is((select count(*)::int from public.friendships), 2, 'sees both directions of own friendship');
select throws_ok(
  $$ insert into public.friendships (user_id, friend_id) values (tests.uid('alice'), tests.uid('stranger')) $$,
  '42501', null, 'friendships cannot be created directly'
);

select tests.login('stranger');
select is((select count(*)::int from public.friendships), 0, 'strangers see no friendships of others');

select tests.login('bob');
delete from public.friendships where friend_id = tests.uid('alice') or user_id = tests.uid('alice');
reset role;
select is((select count(*)::int from public.friendships), 0, 'either side can unfriend');

-- Blocks
select tests.login('alice');
select lives_ok(
  $$ insert into public.blocks (blocker_id, blocked_id) values (tests.uid('alice'), tests.uid('stranger')) $$,
  'can block someone'
);
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id) values (tests.uid('bob'), tests.uid('stranger')) $$,
  '42501', null, 'cannot block on behalf of someone else'
);
select is((select count(*)::int from public.blocks), 1, 'blocker sees the block');

select tests.login('stranger');
select is((select count(*)::int from public.blocks), 0, 'the blocked person does not see it');

-- A blocked pair does not get befriended by a shared group.
reset role;
insert into public.group_members (group_id, user_id) values (tests.id('g'), tests.uid('stranger'));
select is(
  (select count(*)::int from public.friendships
   where user_id = tests.uid('stranger') or friend_id = tests.uid('stranger')),
  2,
  'joining befriends members except blocked ones'
);

-- Reports
select tests.login('bob');
select lives_ok(
  $$ insert into public.reports (subject_user_id, reason) values (tests.uid('stranger'), 'spam') $$,
  'can report a user'
);
select throws_ok(
  $$ insert into public.reports (reporter_id, subject_user_id, reason) values (tests.uid('alice'), tests.uid('stranger'), 'x') $$,
  '42501', null, 'cannot file a report as someone else'
);
select is((select count(*)::int from public.reports), 1, 'reporter sees own report');

select tests.login('alice');
select is((select count(*)::int from public.reports), 0, 'others do not see the report');

-- Anonymous visitors
select tests.login_anon();
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select * from public.friendships $$, '42501', null, 'anon cannot read friendships');

select * from finish();
rollback;
