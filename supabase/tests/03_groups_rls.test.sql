-- Group, membership and invite RLS across owner / admin / member / outsider / anon.
begin;
select plan(30);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('member');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('owner', array['member'], array['admin'], 'Roommates'));
select tests.remember('other', tests.group_with('outsider', '{}', '{}', 'Elsewhere'));

-- Reading
select tests.login('member');
select is((select count(*)::int from public.groups), 1, 'member sees only their group');
select is((select count(*)::int from public.group_members), 3, 'member sees all members of their group');
select is((select count(*)::int from public.group_members where group_id = tests.id('other')), 0, 'member does not see other groups'' members');

select tests.login('outsider');
select is((select count(*)::int from public.groups where id = tests.id('g')), 0, 'outsider cannot see the group');
select is((select count(*)::int from public.group_members where group_id = tests.id('g')), 0, 'outsider cannot see its members');

select tests.login_anon();
select throws_ok($$ select * from public.groups $$, '42501', null, 'anon cannot read groups');
select throws_ok($$ select * from public.group_members $$, '42501', null, 'anon cannot read members');

-- Editing settings
select tests.login('member');
update public.groups set name = 'Member edit' where id = tests.id('g');
select tests.login('outsider');
update public.groups set name = 'Outsider edit' where id = tests.id('g');
reset role;
select is((select name from public.groups where id = tests.id('g')), 'Roommates', 'members and outsiders cannot edit settings');

select tests.login('admin');
update public.groups set name = 'Flat 4B', members_can_invite = false where id = tests.id('g');
reset role;
select is((select name from public.groups where id = tests.id('g')), 'Flat 4B', 'admins edit settings');

select tests.login('admin');
select throws_ok(
  $$ update public.groups set is_direct = true where id = tests.id('g') $$,
  '42501', null, 'is_direct is not editable'
);
select throws_ok(
  $$ update public.groups set created_by = tests.uid('admin') where id = tests.id('g') $$,
  '42501', null, 'created_by is not editable'
);
select throws_ok(
  $$ insert into public.groups (name) values ('direct insert') $$,
  '42501', null, 'groups are created through create_group only'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values (tests.id('g'), tests.uid('outsider')) $$,
  '42501', null, 'members are added through RPCs only'
);
select throws_ok(
  $$ update public.group_members set role = 'owner' where user_id = tests.uid('admin') $$,
  '42501', null, 'roles change through RPCs only'
);

-- Deleting (only through delete_group, owner only)
select tests.login('admin');
select throws_ok($$ select delete_group(tests.id('g')) $$, '42501', 'not_allowed', 'admins cannot delete the group');
select tests.login('member');
select throws_ok($$ select delete_group(tests.id('g')) $$, '42501', 'not_allowed', 'members cannot delete the group');
select throws_ok($$ delete from public.groups where id = tests.id('g') $$, '42501', null, 'nobody deletes a group directly');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('g')), 1, 'admins and members cannot delete the group');

-- Currency is locked once money exists.
select tests.login('owner');
select lives_ok(
  $$ update public.groups set currency = 'EUR' where id = tests.id('g') $$,
  'currency can change while the group has no expenses'
);
select create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Rent', 'amount_cents', 1000,
  'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('owner')))
));
select throws_ok(
  $$ update public.groups set currency = 'GBP' where id = tests.id('g') $$,
  '23514', 'group_currency_locked', 'currency is locked once expenses exist'
);

-- Invites
reset role;
select tests.login('owner');
select tests.remember('owner_inv', (select id from create_invite(tests.id('g'))));
select tests.login('admin');
select tests.remember('admin_inv', (select id from create_invite(tests.id('g'))));

reset role;
update public.groups set members_can_invite = true where id = tests.id('g');
select tests.login('member');
select tests.remember('member_inv', (select id from create_invite(tests.id('g'))));

select is((select count(*)::int from public.group_invites), 1, 'members see only their own invites');

select tests.login('admin');
select is((select count(*)::int from public.group_invites), 3, 'admins see every invite of the group');

select tests.login('outsider');
select is((select count(*)::int from public.group_invites where group_id = tests.id('g')), 0, 'outsiders see no invites');
update public.group_invites set revoked_at = now() where id = tests.id('owner_inv');

select tests.login('member');
update public.group_invites set revoked_at = now() where id = tests.id('owner_inv');
update public.group_invites set revoked_at = now() where id = tests.id('member_inv');
select throws_ok(
  $$ update public.group_invites set uses = 0 where id = tests.id('member_inv') $$,
  '42501', null, 'only revoked_at is editable on invites'
);

reset role;
select is((select revoked_at is null from public.group_invites where id = tests.id('owner_inv')), true, 'members and outsiders cannot revoke others'' invites');
select is((select revoked_at is not null from public.group_invites where id = tests.id('member_inv')), true, 'members can revoke their own invite');

select tests.login('admin');
delete from public.group_invites where id = tests.id('owner_inv');
reset role;
select is((select count(*)::int from public.group_invites where id = tests.id('owner_inv')), 0, 'admins can delete any invite');

-- Exactly one owner
select throws_ok(
  $$ insert into public.group_members (group_id, user_id, role) values (tests.id('g'), tests.uid('outsider'), 'owner') $$,
  '23505', null, 'a second owner violates the one-owner index'
);
select throws_ok(
  $$ update public.group_members set role = 'admin' where group_id = tests.id('g') and user_id = tests.uid('owner'); set constraints all immediate $$,
  '23514', 'group_owner_required', 'a group cannot be left without an owner'
);

-- Owner deletes
select tests.login('owner');
select delete_group(tests.id('g'));
reset role;
select isnt((select deleted_at from public.groups where id = tests.id('g')), null,
  'owner can delete the group (it can be restored for 30 days, 28_groups)');

select * from finish();
rollback;
