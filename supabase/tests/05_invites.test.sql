-- create_invite, invite_preview, accept_invite.
begin;
select plan(30);

select tests.create_user('owner', 'Olivia Owner');
select tests.create_user('admin', 'Adam Admin');
select tests.create_user('member', 'Mia Member');
select tests.create_user('joiner', 'Jo Joiner');
select tests.create_user('late', 'Lee Late');
select tests.create_user('invited');

select tests.remember('g', tests.group_with('owner', array['member'], array['admin'], 'Dim sum club'));

-- create_invite permissions
select tests.login('member');
select lives_ok($$ select create_invite(tests.id('g')) $$, 'members can invite when members_can_invite');
select throws_ok(
  $$ select create_invite(tests.id('g'), 'admin') $$,
  '42501', 'not_allowed', 'members cannot create admin invites'
);

reset role;
update public.groups set members_can_invite = false where id = tests.id('g');
select tests.login('member');
select throws_ok(
  $$ select create_invite(tests.id('g')) $$,
  '42501', 'not_allowed', 'members cannot invite when disabled'
);

select tests.login('admin');
select lives_ok($$ select create_invite(tests.id('g')) $$, 'admins can always invite');
select throws_ok(
  $$ select create_invite(tests.id('g'), 'admin') $$,
  '42501', 'not_allowed', 'admins cannot create admin invites'
);
select throws_ok(
  $$ select create_invite(tests.id('g'), 'owner') $$,
  '22023', 'invalid_role', 'owner invites are impossible'
);
select throws_ok(
  $$ select create_invite(tests.id('g'), 'member', 0) $$,
  '22023', 'invalid_max_uses', 'max_uses must be positive'
);
select throws_ok(
  $$ select create_invite(tests.id('g'), 'member', null, now() - interval '1 minute') $$,
  '22023', 'invalid_expiry', 'expiry must be in the future'
);

select tests.login('joiner');
select throws_ok(
  $$ select create_invite(tests.id('g')) $$,
  '42501', 'not_a_member', 'outsiders cannot invite'
);

select tests.login('owner');
select tests.remember('inv', (select id from create_invite(tests.id('g'), 'admin', 2, now() + interval '7 days')));
reset role;
select ok(
  (select code ~ '^[A-Za-z0-9_-]{10,}$' from public.group_invites where id = tests.id('inv')),
  'codes are url-safe and at least 10 characters'
);
select set_config('tests.code', (select code from public.group_invites where id = tests.id('inv')), true);

-- invite_preview for anonymous visitors
select tests.login_anon();
select results_eq(
  $$ select name, member_count, first_names[1], (select array_agg(n order by n) from unnest(first_names) n), status, is_member
     from invite_preview(current_setting('tests.code')) $$,
  $$ values ('Dim sum club'::text, 3, 'Olivia'::text, array['Adam', 'Mia', 'Olivia'], 'valid'::text, false) $$,
  'anon gets the group name, member count and first names (owner first)'
);
select throws_ok(
  $$ select * from invite_preview('does-not-exist-123') $$,
  'P0002', 'invite_not_found', 'unknown codes raise'
);
select throws_ok(
  $$ select accept_invite(current_setting('tests.code')) $$,
  '42501', null, 'anon cannot accept invites'
);

-- accept_invite
select tests.login('joiner');
select is(accept_invite(current_setting('tests.code')), tests.id('g'), 'accepting returns the group id');
select is(private.group_role(tests.id('g')), 'admin'::public.group_role, 'joins with the invite role');
select is((select uses from public.group_invites where id = tests.id('inv')), 1, 'a use is counted');
select is(accept_invite(current_setting('tests.code')), tests.id('g'), 'accepting again is harmless');
reset role;
select is((select uses from public.group_invites where id = tests.id('inv')), 1, 'and does not use up the invite');
select is(
  (select count(*)::int from public.friendships where user_id = tests.uid('joiner')),
  3,
  'joining befriends every member'
);

select tests.login('joiner');
select is(
  (select is_member from invite_preview(current_setting('tests.code'))),
  true,
  'preview knows the caller is already a member'
);

select tests.login('late');
select lives_ok($$ select accept_invite(current_setting('tests.code')) $$, 'second use works');
select tests.login('invited');
select throws_ok(
  $$ select accept_invite(current_setting('tests.code')) $$,
  '23514', 'invite_used_up', 'max_uses is enforced'
);
select is((select status from invite_preview(current_setting('tests.code'))), 'used_up', 'preview shows used_up');

-- expiry
reset role;
update public.group_invites set uses = 0, max_uses = null, expires_at = now() - interval '1 second' where id = tests.id('inv');
select tests.login('invited');
select throws_ok(
  $$ select accept_invite(current_setting('tests.code')) $$,
  '23514', 'invite_expired', 'expired invites are rejected'
);
select is((select status from invite_preview(current_setting('tests.code'))), 'expired', 'preview shows expired');

-- revoke
reset role;
update public.group_invites set expires_at = null where id = tests.id('inv');
select tests.login('owner');
update public.group_invites set revoked_at = now() where id = tests.id('inv');
select tests.login('invited');
select throws_ok(
  $$ select accept_invite(current_setting('tests.code')) $$,
  '23514', 'invite_revoked', 'revoked invites are rejected'
);
select is((select status from invite_preview(current_setting('tests.code'))), 'revoked', 'preview shows revoked');

-- email-bound invite
select tests.login('owner');
select set_config('tests.code2', (select code from create_invite(tests.id('g'), 'member', null, null, 'Invited@Test.local')), true);
select tests.login('late');
select is(accept_invite(current_setting('tests.code2')), tests.id('g'), 'members are let through regardless of email');
reset role;
delete from public.group_members where group_id = tests.id('g') and user_id = tests.uid('late');
select tests.login('late');
select throws_ok(
  $$ select accept_invite(current_setting('tests.code2')) $$,
  '42501', 'invite_wrong_email', 'email-bound invites check the email'
);
select tests.login('invited');
select lives_ok($$ select accept_invite(current_setting('tests.code2')) $$, 'the right email can join (case-insensitive)');

select * from finish();
rollback;
