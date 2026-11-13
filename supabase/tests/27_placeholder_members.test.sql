-- Placeholder members and claiming them (ADR 19), friend links, removing and blocking friends.
-- Money cases: Groceries 30 paid by Ava for Ava, Ben and Sam; Taxi 12 paid by Sam for Ava and
-- Sam; Ava pays Sam 3. Balances Ava +17, Ben -10, Sam -7 before and after Sam claims his seat.
begin;
select plan(104);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.create_user('eve');
select tests.create_user('mallory');
select tests.create_user('nora');

select tests.remember('g', tests.group_with('ava', array['ben', 'dan'], '{}', 'Roommates', 'USD'));
select tests.remember('arch', tests.group_with('ava', array['ben'], '{}', 'Old trip', 'USD'));
select tests.remember('tmp', tests.group_with('ava', '{}', '{}', 'Weekend', 'USD'));
select tests.remember('solo', tests.group_with('ava', '{}', '{}', 'Solo', 'USD'));

insert into public.blocks (blocker_id, blocked_id) values (tests.uid('ava'), tests.uid('eve'));

create function pg_temp.bal(gkey text, who uuid) returns bigint language sql as $$
  select coalesce((select net_cents from public.group_balances
                   where group_id = tests.id(gkey) and user_id = who), 0)
$$;
create function pg_temp.code(ph uuid) returns text language sql security definer as $$
  select i.code from public.group_invites i
  where i.placeholder_id = ph and i.revoked_at is null
  order by i.created_at desc limit 1
$$;
create function pg_temp.person(who uuid) returns jsonb language sql as $$
  select jsonb_build_object('user_id', who)
$$;

-- Adding someone by name ------------------------------------------------------------------

select tests.login('cleo');
select throws_ok(
  format($$ select public.add_placeholder_member(%L, 'Sam') $$, tests.id('g')),
  '42501', 'not_a_member', 'outsiders cannot add people'
);
select tests.login_anon();
select throws_ok(
  format($$ select public.add_placeholder_member(%L, 'Sam') $$, tests.id('g')),
  '42501', null, 'anon cannot add people'
);

select tests.login('ben');
select throws_ok(
  format($$ select public.add_placeholder_member(%L, '   ') $$, tests.id('g')),
  '22023', 'invalid_name', 'a placeholder needs a name'
);
select throws_ok(
  format($$ select public.add_placeholder_member(%L, 'Sam', 'not an email') $$, tests.id('g')),
  '22023', 'invalid_email', 'the email must look like one'
);
select tests.remember('sam', public.add_placeholder_member(tests.id('g'), ' Sam ', 'Sam@Test.Local'));
reset role;

select ok(
  (select p.is_placeholder and p.display_name = 'Sam' from public.profiles p where p.id = tests.id('sam'))
  and not exists (select 1 from auth.users u where u.id = tests.id('sam')),
  'a placeholder is a profile without an account'
);
select is(
  (select (x.email, x.created_by)::text from public.placeholders x where x.profile_id = tests.id('sam')),
  (select ('sam@test.local', tests.uid('ben'))::text),
  'its email is stored lower case with who added it'
);
select is(
  (select m.role::text from public.group_members m where m.group_id = tests.id('g') and m.user_id = tests.id('sam')),
  'member',
  'it is a plain member of the group'
);
select is(
  (select count(*)::int from public.group_invites i
   where i.placeholder_id = tests.id('sam') and i.email = 'sam@test.local' and i.max_uses = 1 and i.revoked_at is null),
  1,
  'it gets a single-use claim link bound to its email'
);
select is(
  (select a.actor_id from public.activity a
   where a.group_id = tests.id('g') and a.verb = 'member.added' and a.subject_id = tests.id('sam')),
  tests.uid('ben'),
  'the feed says Ben added Sam'
);
select ok(
  (select not ('push' = any (n.channels)) from public.notifications n
   where n.user_id = tests.id('sam') and n.type = 'member.added'),
  'the invite notification never goes to push'
);
select is(
  (select count(*)::int from public.friendships f where tests.id('sam') in (f.user_id, f.friend_id)),
  0,
  'placeholders make no friends'
);
select is(
  (select count(*)::int from public.notifications n
   where n.type = 'member.joined' and n.data ->> 'user_id' = tests.id('sam')::text),
  0,
  'admins are not told a placeholder joined'
);

select tests.login('ben');
select throws_ok(
  format($$ select public.add_placeholder_member(%L, 'Sammy', 'sam@test.local') $$, tests.id('g')),
  '23514', 'placeholder_exists', 'one waiting seat per email per group'
);

-- Who can read what

select tests.login('dan');
select is(
  (select p.is_placeholder from public.profiles p where p.id = tests.id('sam')),
  true,
  'group mates read the placeholder profile'
);
select is(
  (select x.email_hint from public.placeholders x where x.profile_id = tests.id('sam')),
  's***@test.local',
  'group mates see a masked email'
);
select throws_ok(
  $$ select email from public.placeholders $$,
  '42501', null, 'the address itself is not readable'
);
select tests.login('cleo');
select is((select count(*)::int from public.placeholders), 0, 'outsiders see no placeholders');

-- Money with a placeholder -------------------------------------------------------------------

select tests.login('ava');
select tests.remember('groceries', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Groceries', 'amount_cents', 3000, 'paid_by', tests.uid('ava'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ava')), pg_temp.person(tests.uid('ben')), pg_temp.person(tests.id('sam')))))));
select tests.remember('taxi', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Taxi', 'amount_cents', 1200, 'paid_by', tests.id('sam'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ava')), pg_temp.person(tests.id('sam')))))));
select tests.remember('pay', (select id from public.settle_up(tests.id('g'), tests.id('sam'), 300)));
reset role;

select is(
  array[pg_temp.bal('g', tests.uid('ava')), pg_temp.bal('g', tests.uid('ben')), pg_temp.bal('g', tests.id('sam'))],
  array[1700, -1000, -700]::bigint[],
  'a placeholder pays, owes and gets paid like anyone'
);
select is(
  (select count(*)::int from public.notifications n where n.user_id = tests.id('sam') and n.type <> 'member.added'),
  0,
  'a placeholder gets no other notification'
);

-- Managing a placeholder

select tests.login('cleo');
select throws_ok(
  format($$ select public.update_placeholder(%L, 'Sammy') $$, tests.id('sam')),
  '42501', 'not_a_member', 'outsiders cannot rename a placeholder'
);
select tests.login('ben');
select lives_ok(
  format($$ select public.update_placeholder(%L, 'Sam Lee') $$, tests.id('sam')),
  'whoever added them renames them'
);
select is((select display_name from public.profiles where id = tests.id('sam')), 'Sam Lee', 'the new name sticks');

select tests.login('dan');
select lives_ok(format($$ select public.remind_placeholder(%L) $$, tests.id('sam')), 'any member sends the one reminder');
select throws_ok(
  format($$ select public.remind_placeholder(%L) $$, tests.id('sam')),
  '23514', 'placeholder_already_reminded', 'there is only one reminder'
);
select throws_ok(
  format($$ select public.remove_placeholder(%L) $$, tests.id('sam')),
  '42501', 'not_allowed', 'a member who did not add them cannot remove them'
);
select tests.login('ava');
select throws_ok(
  format($$ select public.remove_placeholder(%L) $$, tests.id('sam')),
  '23514', 'member_has_balance', 'a placeholder with a balance stays'
);
select throws_ok(
  format($$ select public.set_member_role(%L, %L, 'admin') $$, tests.id('g'), tests.id('sam')),
  '23514', 'placeholder_member', 'a placeholder cannot be an admin'
);

-- Archived groups

select tests.remember('pat', public.add_placeholder_member(tests.id('arch'), 'Pat'));
select tests.remember('old', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('arch'), 'description', 'Ferry', 'amount_cents', 1000, 'paid_by', tests.uid('ava'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ava')), pg_temp.person(tests.id('pat')))))));
reset role;
update public.groups set archived_at = now() where id = tests.id('arch');
select tests.login('ava');
select throws_ok(
  format($$ select public.add_placeholder_member(%L, 'Late') $$, tests.id('arch')),
  '23514', 'group_archived', 'nobody is added to an archived group'
);
select throws_ok(
  format($$ select public.remove_placeholder(%L) $$, tests.id('pat')),
  '23514', 'group_archived', 'nobody is removed from an archived group'
);

-- Claiming: who cannot ----------------------------------------------------------------------

select tests.remember('danny', public.add_placeholder_member(tests.id('g'), 'Danny'));
select tests.remember('evie', public.add_placeholder_member(tests.id('g'), 'Evie'));
reset role;

select tests.login('mallory');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, pg_temp.code(tests.id('sam'))),
  '42501', 'invite_wrong_email', 'someone else cannot take a seat saved for an email'
);

-- Sam signs up but has not confirmed his email yet.
reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'sam@test.local', '', null, '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Samuel Real"}', now(), now());
select ok(
  exists (select 1 from public.profiles p where p.id = tests.id('sam') and p.is_placeholder),
  'an unconfirmed sign up claims nothing'
);
select tests.login('sam');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, pg_temp.code(tests.id('sam'))),
  '42501', 'email_not_verified', 'the claim link needs a confirmed email'
);
reset role;
select throws_ok(
  format($$ select private.claim_placeholder(%L, %L) $$, tests.id('danny'), tests.uid('dan')),
  '23514', 'placeholder_claim_conflict', 'someone already in the group cannot take a seat too'
);
select tests.login('eve');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, pg_temp.code(tests.id('evie'))),
  '42501', 'blocked', 'someone blocked in the group cannot take a seat'
);
select tests.login('ben');
select throws_ok(
  format($$ select private.claim_placeholder(%L, %L) $$, tests.id('danny'), tests.uid('ben')),
  '42501', null, 'clients cannot call the claim directly'
);

-- Claiming by confirming the email ----------------------------------------------------------

reset role;
update auth.users set email_confirmed_at = now() where email = 'sam@test.local';
select tests.remember('real', tests.uid('sam'));

select is(
  (select count(*)::int from public.profiles p where p.id = tests.id('sam')),
  0,
  'the placeholder is gone once Sam confirms his email'
);
select is(
  array[pg_temp.bal('g', tests.uid('ava')), pg_temp.bal('g', tests.uid('ben')), pg_temp.bal('g', tests.id('real'))],
  array[1700, -1000, -700]::bigint[],
  'every balance is where it was, now on Sam''s account'
);
select is(
  (select m.role::text from public.group_members m where m.group_id = tests.id('g') and m.user_id = tests.id('real')),
  'member',
  'Sam is a member under his own account'
);
select is(
  (select (e.paid_by, p.user_id, p.paid_cents)::text from public.expenses e
   join public.expense_payers p on p.expense_id = e.id where e.id = tests.id('taxi')),
  (select (tests.id('real'), tests.id('real'), 1200)::text),
  'what Sam paid is his'
);
select is(
  (select s.share_cents from public.expense_splits s where s.expense_id = tests.id('groceries') and s.user_id = tests.id('real')),
  1000::bigint,
  'his share of the groceries is his'
);
select is(
  (select s.to_user from public.settlements s where s.id = tests.id('pay')),
  tests.id('real'),
  'the payment to him is his'
);
select is(
  (select count(*)::int from public.activity a
   where a.group_id = tests.id('g')
     and (a.subject_id = tests.id('sam') or strpos(a.data::text, tests.id('sam')::text) > 0)),
  0,
  'the feed no longer names the placeholder'
);
select is(
  (select a.actor_id from public.activity a where a.group_id = tests.id('g') and a.verb = 'member.claimed'),
  tests.id('real'),
  'the feed says Sam took his seat'
);
select is(
  (select count(*)::int from public.friendships f where f.user_id = tests.id('real')),
  3,
  'Sam is friends with Ava, Ben and Dan'
);
select is(
  (select count(*)::int from public.notifications n
   where n.type = 'member.joined' and n.data ->> 'user_id' = tests.id('real')::text),
  2,
  'the owner and whoever added him are told'
);
select is(
  (select count(*)::int from public.notifications n where n.user_id = tests.id('real') and n.type = 'member.added'),
  1,
  'Sam finds out who added him'
);
select is(
  (select count(*)::int from public.notifications n
   where n.type = 'expense.updated' and n.data ->> 'group_id' = tests.id('g')::text),
  0,
  'the claim is not an expense change'
);
select is(
  (select count(*)::int from public.activity a where a.group_id = tests.id('g') and a.verb = 'expense.updated'),
  0,
  'nor in the feed'
);
select is(
  (select count(*)::int from public.group_invites i
   where i.group_id = tests.id('g') and i.email = 'sam@test.local' and i.revoked_at is null),
  0,
  'the claim link is spent'
);
select tests.login('sam');
select is(
  (select count(*)::int from public.expenses e where e.group_id = tests.id('g')),
  2,
  'Sam sees the history'
);
reset role;
select is(
  (select sum(net_cents)::bigint from public.group_balances where group_id = tests.id('g')),
  0::bigint,
  'the group still nets to zero'
);

-- Claiming by link, in an archived group ------------------------------------------------------

select tests.create_user('pat');
select tests.login('pat');
select is(public.accept_invite(pg_temp.code(tests.id('pat'))), tests.id('arch'), 'Pat takes his seat with the link');
reset role;
select is(pg_temp.bal('arch', tests.uid('pat')), -500::bigint, 'his share follows him, archived or not');
select is((select count(*)::int from public.profiles p where p.id = tests.id('pat')), 0, 'his placeholder is gone');
select set_config('tests.pat_link',
  (select i.code from public.group_invites i where i.group_id = tests.id('arch') and i.email is null order by i.created_at desc limit 1), true);
select tests.login('mallory');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, current_setting('tests.pat_link')),
  '23514', 'invite_revoked', 'a claim link works once'
);

-- Departed placeholders ---------------------------------------------------------------------

select tests.login('ava');
select tests.remember('gus', public.add_placeholder_member(tests.id('g'), 'Gus'));
select tests.remember('snacks', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Snacks', 'amount_cents', 600, 'paid_by', tests.uid('ava'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ava')), pg_temp.person(tests.id('gus')))))));
select public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Coffee', 'amount_cents', 300, 'paid_by', tests.id('gus'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ava')))));
select lives_ok(format($$ select public.remove_placeholder(%L) $$, tests.id('gus')), 'a settled placeholder can be removed');
reset role;
select ok(
  exists (select 1 from public.profiles p where p.id = tests.id('gus') and p.is_placeholder)
  and exists (select 1 from private.former_members f where f.group_id = tests.id('g') and f.user_id = tests.id('gus')),
  'one the history names stays as a former member'
);
select tests.login('ava');
select throws_ok(
  format($$ select public.delete_expense(%L) $$, tests.id('snacks')),
  '23514', 'split_member_not_in_group', 'his old expenses cannot move his balance'
);
select set_config('tests.gus_link',
  (select i.code from public.group_invites i where i.placeholder_id = tests.id('gus')), true);
select tests.login('mallory');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, current_setting('tests.gus_link')),
  '23514', 'invite_revoked', 'a removed placeholder cannot be claimed by link'
);
reset role;
select throws_ok(
  format($$ select private.claim_placeholder(%L, %L) $$, tests.id('gus'), tests.uid('mallory')),
  'PT404', 'placeholder_not_found', 'nor any other way'
);

select tests.login('ava');
select tests.remember('hal', public.add_placeholder_member(tests.id('g'), 'Hal'));
select lives_ok(format($$ select public.remove_placeholder(%L) $$, tests.id('hal')), 'a placeholder with no history can be removed');
reset role;
select is((select count(*)::int from public.profiles p where p.id = tests.id('hal')), 0, 'and is deleted outright');

-- Groups going away take their placeholders along

select tests.login('ava');
select tests.remember('ivy', public.add_placeholder_member(tests.id('tmp'), 'Ivy'));
select public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('tmp'), 'description', 'Bus', 'amount_cents', 100, 'paid_by', tests.id('ivy'),
  'splits', jsonb_build_array(pg_temp.person(tests.id('ivy')))));
select lives_ok(format($$ select public.delete_group(%L) $$, tests.id('tmp')), 'a group with a placeholder can be deleted');
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.profiles p where p.id = tests.id('ivy')), 0, 'its placeholders go with it');

select tests.login('ava');
select tests.remember('jo', public.add_placeholder_member(tests.id('solo'), 'Jo'));
select lives_ok(format($$ select public.leave_group(%L) $$, tests.id('solo')), 'the owner left with placeholders only can leave');
reset role;
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::int from public.groups g where g.id = tests.id('solo'))
    + (select count(*)::int from public.profiles p where p.id = tests.id('jo')),
  0,
  'which closes the group, placeholders and all'
);

-- Plans and notifications skip placeholders

select tests.login('ava');
with e as (
  insert into public.events (group_id, title)
  values (tests.id('g'), 'Dinner')
  returning id
)
select tests.remember('ev', (select e.id from e));
select is(public.request_availability(tests.id('ev')), 3, 'placeholders are never asked for their availability');
reset role;
insert into public.notifications (user_id, type, data) values (tests.id('danny'), 'expense.created', '{}');
select is(
  (select count(*)::int from public.notifications n where n.user_id = tests.id('danny') and n.type <> 'member.added'),
  0,
  'any other notification for a placeholder is dropped'
);

-- Profiles and accounts

select throws_ok(
  $$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Ghost') $$,
  '23514', 'profile_without_account', 'a real profile still needs an account'
);
select tests.create_user('zed');
select tests.remember('zed', tests.uid('zed'));
delete from auth.users where id = tests.id('zed');
select is((select count(*)::int from public.profiles p where p.id = tests.id('zed')), 0, 'deleting the account deletes its profile');

-- The invite email and the join page

update public.app_config set value = 'true' where key = 'email_notifications';
select tests.login('ava');
select tests.remember('kim', public.add_placeholder_member(tests.id('g'), 'Kim Park', 'kim@test.local'));
reset role;
select is(
  (select n.channels from public.notifications n where n.user_id = tests.id('kim') and n.type = 'member.added'),
  array['email'],
  'with email on, the invite goes to the saved address only'
);
select is(
  (select count(*)::int from private.email_outbox o where o.user_id = tests.id('kim')),
  1,
  'one invite email is queued'
);
update private.email_outbox set queued_at = now() - interval '5 minutes' where user_id = tests.id('kim');
select ok(private.send_email_notifications() >= 1, 'the sender hands it over');
select is(
  (select o.state from private.email_outbox o where o.user_id = tests.id('kim')),
  'sending',
  'to the address saved for Kim'
);
update public.app_config set value = 'false' where key = 'email_notifications';

select tests.login_anon();
select is(
  (select (v.placeholder_name, v.email_hint, v.status, v.member_count)::text
   from public.invite_preview_v2(pg_temp.code(tests.id('kim'))) v),
  '(Kim,k***@test.local,valid,4)',
  'the join page shows whose seat it is and only real members'
);
reset role;
select set_config('tests.sam_link',
  (select i.code from public.group_invites i where i.group_id = tests.id('g') and i.email = 'sam@test.local' limit 1), true);
select tests.login('sam');
select is(
  (select v.status from public.invite_preview_v2(current_setting('tests.sam_link')) v),
  'valid',
  'a member opening their used link is offered the group'
);

-- Friends ------------------------------------------------------------------------------------

select tests.login('ava');
select set_config('tests.link', public.my_friend_link(), true);
select is(public.my_friend_link(), current_setting('tests.link'), 'the personal link stays the same');
select isnt(public.my_friend_link(true), current_setting('tests.link'), 'rotating it makes a new one');
select set_config('tests.link', public.my_friend_link(), true);

select tests.login_anon();
select is(
  (select (p.name, p.status)::text from public.friend_invite_preview(current_setting('tests.link')) p),
  '(Ava,valid)',
  'anyone with the link sees who it is from'
);
select tests.login('cleo');
select is(public.accept_friend_invite(current_setting('tests.link')), tests.uid('ava'), 'Cleo accepts Ava''s link');
reset role;
select is(
  (select count(*)::int from public.friendships f
   where (f.user_id, f.friend_id) in ((tests.uid('ava'), tests.uid('cleo')), (tests.uid('cleo'), tests.uid('ava')))),
  2,
  'they are friends both ways'
);
select is(
  (select count(*)::int from public.notifications n where n.user_id = tests.uid('ava') and n.type = 'friend.added'),
  1,
  'Ava hears about it'
);
select tests.login('ava');
select throws_ok(
  format($$ select public.accept_friend_invite(%L) $$, current_setting('tests.link')),
  '22023', 'invalid_friend', 'nobody befriends themselves'
);
select tests.login('eve');
select throws_ok(
  format($$ select public.accept_friend_invite(%L) $$, current_setting('tests.link')),
  '42501', 'blocked', 'a blocked person cannot use the link'
);

select tests.login('ava');
select throws_ok(
  $$ select public.create_friend_invite('nope') $$,
  '22023', 'invalid_email', 'an email invite needs an email'
);
select set_config('tests.mail', (select i.code from public.create_friend_invite('Mallory@Test.Local') i), true);
select tests.login('nora');
select throws_ok(
  format($$ select public.accept_friend_invite(%L) $$, current_setting('tests.mail')),
  '42501', 'invite_wrong_email', 'an email invite is for that email only'
);
select tests.login('mallory');
select is(public.accept_friend_invite(current_setting('tests.mail')), tests.uid('ava'), 'Mallory accepts hers');
select tests.login('nora');
select throws_ok(
  format($$ select public.accept_friend_invite(%L) $$, current_setting('tests.mail')),
  '23514', 'invite_used_up', 'and it works once'
);

select tests.login('ava');
select lives_ok(format($$ select public.remove_friend(%L) $$, tests.uid('cleo')), 'Ava removes Cleo');
select is(
  (select count(*)::int from public.friendships f where tests.uid('cleo') in (f.user_id, f.friend_id)),
  0,
  'in both directions'
);
select throws_ok(
  format($$ select public.add_friend(%L) $$, tests.uid('cleo')),
  '42501', 'not_a_friend', 'adding back needs a shared group or a link'
);
select lives_ok(format($$ select public.remove_friend(%L) $$, tests.uid('ben')), 'Ava removes Ben');
select lives_ok(format($$ select public.add_friend(%L) $$, tests.uid('ben')), 'and adds him back from their group');
select is(
  (select count(*)::int from public.friendships f
   where (f.user_id, f.friend_id) in ((tests.uid('ava'), tests.uid('ben')), (tests.uid('ben'), tests.uid('ava')))),
  2,
  'friends again'
);
select throws_ok(
  format($$ select public.add_friend(%L) $$, tests.id('danny')),
  '42501', 'not_a_friend', 'a placeholder is not a friend'
);
select tests.remember('direct', public.get_or_create_direct_group(tests.uid('ben')));
select public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('direct'), 'description', 'Lunch', 'amount_cents', 1000, 'paid_by', tests.uid('ava'),
  'splits', jsonb_build_array(pg_temp.person(tests.uid('ben')))));
select throws_ok(
  format($$ select public.remove_friend(%L) $$, tests.uid('ben')),
  '23514', 'friend_has_balance', 'a friend with an open 1:1 balance stays'
);

-- Blocking -----------------------------------------------------------------------------------

select tests.login('ben');
select lives_ok(format($$ select public.block_user(%L) $$, tests.uid('dan')), 'Ben blocks Dan');
select is(
  (select count(*)::int from public.friendships f
   where (f.user_id, f.friend_id) in ((tests.uid('ben'), tests.uid('dan')), (tests.uid('dan'), tests.uid('ben')))),
  0,
  'their friendship ends both ways'
);
select is((select string_agg(b.display_name, ',') from public.my_blocks() b), 'Dan Tester', 'Dan is on Ben''s blocked list');
select throws_ok(
  format($$ select public.block_user(%L) $$, tests.id('danny')),
  'PT404', 'person_not_found', 'placeholders cannot be blocked'
);
select throws_ok(
  format($$ select public.block_user(%L) $$, tests.uid('nora')),
  'PT404', 'person_not_found', 'only people you know can be blocked'
);

reset role;
select tests.remember('b2', tests.group_with('ben', '{}', '{}', 'Book club', 'USD'));
select tests.login('ben');
select set_config('tests.b2_link', (select i.code from public.create_invite(tests.id('b2')) i), true);
select tests.login('dan');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, current_setting('tests.b2_link')),
  '42501', 'blocked', 'Dan cannot join Ben''s groups'
);
select tests.login('ben');
delete from public.blocks where blocked_id = tests.uid('dan');
select tests.login('dan');
select is(public.accept_invite(current_setting('tests.b2_link')), tests.id('b2'), 'after Unblock he can');

select tests.login('ben');
select lives_ok(
  format($$ insert into public.reports (subject_user_id, reason) values (%L, 'Spam') $$, tests.uid('dan')),
  'Ben reports Dan'
);

select * from finish();
rollback;
