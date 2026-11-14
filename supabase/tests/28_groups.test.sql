-- Groups (20261113213126_group_types_restore_and_whiteboard, ADR 20): type and trip dates,
-- delete that can be undone for 30 days and the purge after it, cover storage, whiteboard.
begin;
select plan(95);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('member');
select tests.create_user('outsider');
select tests.remember('g', tests.group_with('owner', array['member'], array['admin'], 'Flat 4B'));

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
grant execute on function pg_temp.put(text, text) to authenticated, anon;

-- Type and trip dates ------------------------------------------------------------------------

select tests.login('owner');
select tests.remember('trip', (select id from public.create_group_v2(
  'Lisbon', '🧳', 'sea', 'EUR', 'trip', '2026-06-03', '2026-06-10')));
reset role;
select results_eq(
  format($$ select type::text, starts_on::text, ends_on::text, currency::text from public.groups where id = %L $$, tests.id('trip')),
  $$ values ('trip', '2026-06-03', '2026-06-10', 'EUR') $$,
  'create_group_v2 stores the type and the trip dates'
);
select is(
  (select role::text from public.group_members where group_id = tests.id('trip') and user_id = tests.uid('owner')),
  'owner',
  'and makes the caller the owner'
);

select tests.login('owner');
select throws_ok(
  $$ select public.create_group_v2('Backwards', null, null, null, 'trip', '2026-06-10', '2026-06-03') $$,
  '22023', 'trip_dates_invalid', 'a trip cannot end before it starts'
);
select is(
  (select row(type, starts_on, ends_on)::text from public.create_group_v2('Home', null, null, null, 'home', '2026-01-01', '2026-02-01')),
  row('home'::public.group_type, null::date, null::date)::text,
  'only trips keep dates'
);
select is(
  (select type::text from public.create_group('Old client')),
  'other',
  'create_group still works and makes an other group'
);

select tests.login('admin');
update public.groups set type = 'trip', starts_on = '2026-07-01', ends_on = '2026-07-04' where id = tests.id('g');
select tests.login('member');
update public.groups set type = 'couple' where id = tests.id('g');
reset role;
select is((select type::text from public.groups where id = tests.id('g')), 'trip',
  'admins change the type, members cannot');
select tests.login('admin');
select throws_ok(
  format($$ update public.groups set ends_on = '2026-06-01' where id = %L $$, tests.id('g')),
  '23514', null, 'the dates check holds on direct updates'
);
select tests.login_anon();
select throws_ok($$ select public.create_group_v2('Sneaky') $$, '42501', null, 'anon cannot create groups');

-- Deleting and restoring ---------------------------------------------------------------------

select tests.login('owner');
select tests.remember('inv_open', (select id from public.create_invite(tests.id('g'))));
select tests.remember('inv_closed', (select id from public.create_invite(tests.id('g'))));
update public.group_invites set revoked_at = now() - interval '1 day' where id = tests.id('inv_closed');
select tests.login('member');
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Pizza', 'amount_cents', 1000,
  'splits', tests.people('member', 'owner')));

select tests.login('admin');
select throws_ok(format($$ select public.delete_group(%L) $$, tests.id('g')), '42501', 'not_allowed',
  'admins cannot delete the group');
select tests.login('owner');
select throws_ok(format($$ select public.delete_group(%L) $$, tests.id('g')), '23514', 'group_has_balances',
  'a group with open balances cannot be deleted');
select settle_up(tests.id('g'), tests.uid('member'), 500);
select lives_ok(format($$ select public.delete_group(%L) $$, tests.id('g')), 'a settled group can be deleted');

reset role;
select isnt((select deleted_at from public.groups where id = tests.id('g')), null, 'the group is only stamped');
select is((select deleted_by from public.groups where id = tests.id('g')), tests.uid('owner'), 'with who deleted it');
select is(
  (select revoked_at from public.group_invites where id = tests.id('inv_open')),
  (select deleted_at from public.groups where id = tests.id('g')),
  'its open invite links close at the same moment'
);

select tests.login('member');
select is((select count(*)::int from public.groups where id = tests.id('g')), 0, 'members no longer see it');
select is((select count(*)::int from public.expenses where group_id = tests.id('g')), 0, 'nor its expenses');
select is((select count(*)::int from public.group_members where group_id = tests.id('g')), 0, 'nor its members');
select is((select array_agg(verb) from public.activity where group_id = tests.id('g')), array['group.deleted'],
  'nor its activity, only the line saying it was deleted');
select throws_ok(
  format($$ select create_expense(jsonb_build_object('group_id', %L, 'description', 'Late', 'amount_cents', 100,
    'splits', tests.people('member'))) $$, tests.id('g')),
  'PT404', 'group_deleted', 'RPCs refuse a deleted group'
);
select tests.login('admin');
update public.groups set name = 'Renamed' where id = tests.id('g');
reset role;
select is((select name from public.groups where id = tests.id('g')), 'Flat 4B', 'admins cannot edit a deleted group');

select tests.login('member');
select results_eq(
  format($$ select id, name, purge_after = deleted_at + interval '30 days', member_count from public.my_deleted_groups() where id = %L $$, tests.id('g')),
  format($$ values (%L::uuid, 'Flat 4B'::text, true, 3) $$, tests.id('g')),
  'members see it under recently deleted, with when it goes for good'
);
select tests.login('outsider');
select is((select count(*)::int from public.my_deleted_groups()), 0, 'outsiders do not');

reset role;
select throws_ok(
  format($$ insert into public.group_members (group_id, user_id, role) values (%L, %L, 'member') $$,
    tests.id('g'), tests.uid('outsider')),
  'PT404', 'group_deleted', 'nobody joins a deleted group'
);
select private.notify(array[tests.uid('member')], 'event.reminder',
  jsonb_build_object('group_id', tests.id('g'), 'event_id', gen_random_uuid()));
select is(
  (select count(*)::int from public.notifications where user_id = tests.uid('member') and type = 'event.reminder'),
  0,
  'notifications about a deleted group are dropped'
);

select tests.login('outsider');
select throws_ok(format($$ select public.restore_group(%L) $$, tests.id('g')), '42501', 'not_a_member',
  'outsiders cannot restore it');
select throws_ok(format($$ select public.restore_group(%L) $$, gen_random_uuid()), 'PT404', 'group_not_found',
  'a purged or unknown group cannot be restored');
select tests.login('member');
select is((select deleted_at from public.restore_group(tests.id('g'))), null, 'any member restores it');
select is((select count(*)::int from public.groups where id = tests.id('g')), 1, 'and sees it again');
select is((select count(*)::int from public.expenses where group_id = tests.id('g')), 1, 'with its expenses');
select lives_ok(format($$ select public.restore_group(%L) $$, tests.id('g')), 'restoring a live group changes nothing');
reset role;
select is((select revoked_at from public.group_invites where id = tests.id('inv_open')), null,
  'the links it closed open again');
select isnt((select revoked_at from public.group_invites where id = tests.id('inv_closed')), null,
  'links revoked before stay revoked');
select results_eq(
  format($$ select verb, actor_id from public.activity where group_id = %L and verb in ('group.deleted', 'group.restored') order by created_at, verb $$, tests.id('g')),
  format($$ values ('group.deleted'::text, %L::uuid), ('group.restored', %L::uuid) $$, tests.uid('owner'), tests.uid('member')),
  'deleting and restoring are in the activity'
);

-- Purge
select tests.remember('old', tests.group_with('owner', '{}', '{}', 'Old'));
select tests.remember('recent', tests.group_with('owner', '{}', '{}', 'Recent'));
update public.groups set deleted_at = now() - interval '31 days' where id = tests.id('old');
update public.groups set deleted_at = now() - interval '29 days' where id = tests.id('recent');
select tests.login('owner');
select is(
  (select array_agg(name order by name) from public.my_deleted_groups()),
  array['Recent'],
  'a group past 30 days is no longer offered'
);
select throws_ok(format($$ select public.restore_group(%L) $$, tests.id('old')), 'PT404', 'group_not_found',
  'nor restored, even before the purge runs');
reset role;
select is(private.purge_deleted_groups(), 1, 'the purge removes groups deleted more than 30 days ago');
select is((select count(*)::int from public.groups where id = tests.id('old')), 0, 'for good');
select is((select count(*)::int from public.groups where id = tests.id('recent')), 1, 'and keeps the rest');
select ok(
  has_function_privilege('authenticated', 'private.purge_deleted_groups(interval)', 'execute') is false,
  'clients cannot run the purge'
);

-- Covers -------------------------------------------------------------------------------------

select tests.login('admin');
select lives_ok(format($$ select pg_temp.put('group-covers', '%s/cover-1.jpg') $$, tests.id('g')),
  'admins upload a cover');
select tests.login('member');
select throws_ok(format($$ select pg_temp.put('group-covers', '%s/cover-2.jpg') $$, tests.id('g')),
  '42501', null, 'members cannot');
select is((select count(*)::int from storage.objects where bucket_id = 'group-covers'), 1, 'members list their group covers');
select tests.login('outsider');
select throws_ok(format($$ select pg_temp.put('group-covers', '%s/cover-3.jpg') $$, tests.id('g')),
  '42501', null, 'outsiders cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'group-covers'), 0, 'or list');
select tests.login_anon();
select throws_ok(format($$ select pg_temp.put('group-covers', '%s/cover-4.jpg') $$, tests.id('g')),
  '42501', null, 'anon cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'group-covers'), 0, 'or list');

reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-8000-0000000000c1', tests.uid('admin'), 'phone', 'totp', 'verified', now(), now(), 'secret');
select tests.login('admin');
select pg_temp.aal('aal1');
select throws_ok(format($$ select pg_temp.put('group-covers', '%s/cover-5.jpg') $$, tests.id('g')),
  '42501', null, 'an admin who still owes the two-step code cannot upload');
select tests.login('admin');
select pg_temp.aal('aal2');
select lives_ok(format($$ select pg_temp.put('group-covers', '%s/cover-6.jpg') $$, tests.id('g')),
  'and can once it is done');
update public.groups set cover_path = tests.id('g') || '/cover-6.jpg' where id = tests.id('g');
reset role;
select is((select cover_path from public.groups where id = tests.id('g')), tests.id('g') || '/cover-6.jpg',
  'admins set the cover path');

update public.groups set deleted_at = now() where id = tests.id('trip');
select tests.login('owner');
select throws_ok(format($$ select pg_temp.put('group-covers', '%s/cover.jpg') $$, tests.id('trip')),
  '42501', null, 'nobody uploads a cover to a deleted group');

-- Whiteboard ---------------------------------------------------------------------------------

select tests.login('member');
select is((select count(*)::int from public.group_whiteboards where group_id = tests.id('g')), 0,
  'a group starts without notes');
select is(
  (select version from public.save_group_whiteboard(tests.id('g'), 'Wifi: potluck123', 0)),
  1,
  'members save the notes'
);
select is(
  (select version from public.save_group_whiteboard(tests.id('g'), 'Wifi: potluck123, bins on Tuesday', 1)),
  2,
  'and save again from the newest version'
);
select is(
  (select version from public.save_group_whiteboard(tests.id('g'), 'Wifi: potluck123, bins on Tuesday', 2)),
  2,
  'saving the same text changes nothing'
);
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, 'Old copy', 1) $$, tests.id('g')),
  '23514', 'whiteboard_conflict', 'saving over a newer version is refused'
);
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, repeat('x', 10001), 2) $$, tests.id('g')),
  '22023', 'whiteboard_too_long', 'notes are capped at 10000 characters'
);
select throws_ok(
  format($$ update public.group_whiteboards set body = 'sneaky' where group_id = %L $$, tests.id('g')),
  '42501', null, 'nobody writes the table directly'
);

select tests.login('owner');
select results_eq(
  format($$ select body, version, updated_by from public.group_whiteboards where group_id = %L $$, tests.id('g')),
  format($$ values ('Wifi: potluck123, bins on Tuesday'::text, 2, %L::uuid) $$, tests.uid('member')),
  'other members read the notes and who wrote them'
);
select lives_ok(
  format($$ select public.save_group_whiteboard(%L, 'Wifi: potluck123, bins on Wednesday', 2) $$, tests.id('g')),
  'the owner edits too'
);
reset role;
select results_eq(
  format($$ select actor_id, data ->> 'excerpt' from public.activity where group_id = %L and verb = 'group.notes_updated' order by data ->> 'excerpt' $$, tests.id('g')),
  format($$ values (%L::uuid, 'Wifi: potluck123, bins on Tuesday'::text), (%L::uuid, 'Wifi: potluck123, bins on Wednesday') $$,
    tests.uid('member'), tests.uid('owner')),
  'each person''s sitting is one line in the activity'
);

select tests.login('outsider');
select is((select count(*)::int from public.group_whiteboards where group_id = tests.id('g')), 0,
  'outsiders cannot read the notes');
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, 'Hi', 3) $$, tests.id('g')),
  '42501', 'not_a_member', 'or write them'
);
select tests.login_anon();
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, 'Hi', 3) $$, tests.id('g')),
  '42501', null, 'anon cannot call it'
);

select tests.login('admin');
select pg_temp.aal('aal1');
select is((select count(*)::int from public.group_whiteboards where group_id = tests.id('g')), 0,
  'an unfinished two-step sign in reads nothing');

reset role;
update public.groups set archived_at = now() where id = tests.id('g');
select tests.login('member');
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, 'Archived edit', 3) $$, tests.id('g')),
  '23514', 'group_archived', 'archived groups keep their notes as they are'
);
reset role;
update public.groups set archived_at = null, deleted_at = now() where id = tests.id('g');
select tests.login('member');
select throws_ok(
  format($$ select public.save_group_whiteboard(%L, 'Deleted edit', 3) $$, tests.id('g')),
  'PT404', 'group_deleted', 'deleted groups too'
);
select is((select count(*)::int from public.group_whiteboards where group_id = tests.id('g')), 0,
  'and their notes are hidden with them');

-- Deleted groups everywhere (20261113213127) -----------------------------------------------

reset role;
update public.groups set deleted_at = null, archived_at = null where id = tests.id('g');
select tests.remember('pg', tests.group_with('owner', array['member'], '{}', 'Plans crew'));
insert into public.events (id, group_id, title, status, starts_at, ends_at, created_by)
values (gen_random_uuid(), tests.id('pg'), 'Picnic', 'scheduled', now() + interval '1 day',
        now() + interval '1 day 2 hours', tests.uid('owner'))
returning tests.remember('ev', id);
insert into public.event_rsvps (event_id, user_id, status) values (tests.id('ev'), tests.uid('member'), 'going');
insert into public.availability (event_id, user_id, slot_start) values (tests.id('ev'), tests.uid('member'), now() + interval '1 day');
select tests.login('owner');
select create_expense(jsonb_build_object('group_id', tests.id('pg'), 'description', 'Blanket', 'amount_cents', 900,
  'splits', tests.people('owner')));

select tests.login('member');
select is((select count(*)::int from public.my_timeline() where group_id = tests.id('pg')), 1,
  'the plan is on the timeline while the group is there');
select tests.login('owner');
select public.delete_group(tests.id('pg'));

select tests.login('member');
select is((select count(*)::int from public.my_timeline() where group_id = tests.id('pg')), 0,
  'a deleted group''s plans leave the timeline');
select is((select count(*)::int from public.events where id = tests.id('ev')), 0, 'and the plan itself');
select is((select count(*)::int from public.event_rsvps where event_id = tests.id('ev')), 0, 'its RSVPs');
select is((select count(*)::int from public.availability where event_id = tests.id('ev')), 0, 'and its availability');
select is(
  (select array_agg(n.data ->> 'group_name') from public.notifications n
   where n.type = 'group.deleted' and n.data ->> 'deleted_group_id' = tests.id('pg')::text),
  array['Plans crew'],
  'the other members are told it was deleted'
);
select is((select count(*)::int from public.activity where group_id = tests.id('pg') and verb = 'group.deleted'), 1,
  'members still read the line saying it was deleted');

select tests.login('owner');
update public.events set title = 'Renamed' where id = tests.id('ev');
reset role;
select is((select title from public.events where id = tests.id('ev')), 'Picnic',
  'the plan''s creator cannot edit it in a deleted group');
select is(
  (select count(*)::int from jsonb_array_elements(private.monthly_summary(tests.uid('owner'), current_date) -> 'groups') x
   where x ->> 'group_id' = tests.id('pg')::text),
  0,
  'the monthly summary leaves deleted groups out'
);
select is((select count(*)::int from public.notifications where user_id = tests.uid('owner') and type = 'group.deleted'), 0,
  'whoever deleted it is not told');

select tests.login('outsider');
select is((select count(*)::int from public.activity where group_id = tests.id('pg')), 0,
  'outsiders read none of it');

select tests.login('member');
select public.restore_group(tests.id('pg'));
reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('owner') and type = 'group.restored'
  and data ->> 'group_id' = tests.id('pg')::text), 1,
  'restoring tells the others');

select tests.login('owner');
select tests.remember('direct', public.get_or_create_direct_group(tests.uid('member')));
select throws_ok(format($$ select public.delete_group(%L) $$, tests.id('direct')), '23514', 'direct_group_not_deletable',
  'a one-on-one tab cannot be deleted');

reset role;
select throws_ok(
  format($$ update public.groups set cover_path = 'someone-else/cover.jpg' where id = %L $$, tests.id('pg')),
  '23514', null, 'a cover must sit under its own group folder'
);

-- Debts in a circle (20261113213127) ----------------------------------------------------------

reset role;
select tests.create_user('c1');
select tests.create_user('c2');
select tests.create_user('c3');
select tests.remember('ring', tests.group_with('c1', array['c2', 'c3'], '{}', 'Ring'));
update public.groups set simplify_debts = false where id = tests.id('ring');
-- c2 owes c1, c3 owes c2, c1 owes c3: every net is zero, every pair still owes 10.00.
select tests.login('c1');
select create_expense(jsonb_build_object('group_id', tests.id('ring'), 'description', 'One', 'amount_cents', 1000,
  'splits', tests.people('c2')));
select tests.login('c2');
select create_expense(jsonb_build_object('group_id', tests.id('ring'), 'description', 'Two', 'amount_cents', 1000,
  'splits', tests.people('c3')));
select tests.login('c3');
select create_expense(jsonb_build_object('group_id', tests.id('ring'), 'description', 'Three', 'amount_cents', 1000,
  'splits', tests.people('c1')));

select tests.login('c1');
select throws_ok(format($$ select public.delete_group(%L) $$, tests.id('ring')), '23514', 'group_has_balances',
  'a group with debts in a circle cannot be deleted, though every net is zero');
reset role;
select throws_ok(format($$ delete from public.groups where id = %L $$, tests.id('ring')), '23514', 'group_has_balances',
  'nor removed past the RPC');

select tests.login('c1');
select is((select count(*)::int from public.friend_balances() where group_id = tests.id('ring')), 2,
  'friend_balances shows the circle while the group is there');
reset role;
update public.groups set deleted_at = now() where id = tests.id('ring');
select tests.login('c1');
select is((select count(*)::int from public.friend_balances() where group_id = tests.id('ring')), 0,
  'and leaves a deleted group out');
select is((select count(*)::int from public.settle_with_friend(tests.uid('c2'))), 0,
  'settle_with_friend pays nothing into a deleted group');
reset role;
select throws_ok(
  format($$ insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, created_by)
    values (%L, %L, %L, 100, 'USD', 1, %L) $$, tests.id('ring'), tests.uid('c2'), tests.uid('c1'), tests.uid('c2')),
  'PT404', 'group_deleted', 'no payment lands in a deleted group'
);

select throws_ok(
  format($$ update public.groups set cover_path = %L where id = %L $$, tests.id('ring') || '/../x.jpg', tests.id('ring')),
  '23514', null, 'a cover path cannot climb out of its folder'
);
select throws_ok(
  format($$ update public.groups set cover_path = %L where id = %L $$, tests.id('ring') || '/a/b.jpg', tests.id('ring')),
  '23514', null, 'or go deeper than one file'
);
select lives_ok(
  format($$ update public.groups set cover_path = %L where id = %L $$, tests.id('ring') || '/cover-x1.webp', tests.id('ring')),
  'one file in the group folder is fine'
);

-- Guest links, exports and imports (20261113213127) --------------------------------------------

reset role;
select tests.remember('gx', tests.group_with('owner', array['member'], '{}', 'Guests crew'));
insert into public.events (id, group_id, title, created_by)
values (gen_random_uuid(), tests.id('gx'), 'Brunch', tests.uid('owner'))
returning tests.remember('gx_ev', id);
insert into public.event_guest_links (id, event_id, group_id, created_by, max_guests, expires_at)
values (gen_random_uuid(), tests.id('gx_ev'), tests.id('gx'), tests.uid('owner'), 5, now() + interval '7 days')
returning tests.remember('gx_link', id);
select set_config('tests.gx_code_text', (select code from public.event_guest_links where id = tests.id('gx_link')), true);

select tests.login_anon();
select isnt((select status from public.guest_link_preview(current_setting('tests.gx_code_text'))), 'revoked',
  'a guest link is open while its group is there');
select tests.login('owner');
select public.delete_group(tests.id('gx'));
select tests.login_anon();
select is((select status from public.guest_link_preview(current_setting('tests.gx_code_text'))), 'revoked',
  'deleting the group closes its guest links');

select tests.login('owner');
select is(
  jsonb_path_exists(public.export_my_data(), '$.groups[*] ? (@.id == $id)',
    jsonb_build_object('id', tests.id('gx'))),
  false,
  'a backup leaves deleted groups out'
);
select throws_ok(
  format($$ select public.import_expenses(%L, jsonb_build_array(jsonb_build_object('description', 'Late'))) $$, tests.id('gx')),
  'PT404', 'group_deleted', 'nothing is imported into a deleted group'
);

select tests.login('member');
select public.restore_group(tests.id('gx'));
select tests.login_anon();
select isnt((select status from public.guest_link_preview(current_setting('tests.gx_code_text'))), 'revoked',
  'restoring reopens the links the delete closed');

select * from finish();
rollback;
