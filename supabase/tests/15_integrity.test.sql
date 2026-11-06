-- Ledger and membership integrity: blocks on invites, former members, splits-only
-- edits, payments with people who left, owners left with closed accounts,
-- rescheduling reminders and FX precision.
begin;
select plan(34);

select tests.create_user('own');
select tests.create_user('mem');
select tests.create_user('pal');
select tests.create_user('blk');
select tests.create_user('rev');
select tests.create_user('joiner');
select tests.create_user('stranger');
select tests.create_user('closer', 'Cora Closer');
select tests.create_user('stayer');
select tests.create_user('quitter', 'Quinn Quitter');
select tests.create_user('boss');
select tests.create_user('ghost');

-- Blocks and invites ----------------------------------------------------------------------------

select tests.remember('g', tests.group_with('own', array['mem'], '{}', 'Block party'));
select tests.remember('arch', tests.group_with('own', '{}', '{}', 'Old trip'));
reset role;
insert into public.group_invites (group_id, code, created_by) values
  (tests.id('g'), 'blockparty-1', tests.uid('own')),
  (tests.id('arch'), 'oldtrip-0001', tests.uid('own'));
update public.groups set archived_at = now() where id = tests.id('arch');
-- own blocked blk; rev blocked mem.
insert into public.blocks (blocker_id, blocked_id) values
  (tests.uid('own'), tests.uid('blk')),
  (tests.uid('rev'), tests.uid('mem'));

select tests.login('blk');
select is((select status from invite_preview('blockparty-1')), 'blocked', 'preview: a member blocked the visitor');
select throws_ok($$ select accept_invite('blockparty-1') $$, '42501', 'blocked', 'joining is refused when a member blocked you');

select tests.login('rev');
select is((select status from invite_preview('blockparty-1')), 'blocked', 'preview: the visitor blocked a member');
select throws_ok($$ select accept_invite('blockparty-1') $$, '42501', 'blocked', 'joining is refused when you blocked a member');

select tests.login_anon();
select is((select status from invite_preview('blockparty-1')), 'valid', 'anonymous visitors see a valid invite');
select is((select status from invite_preview('oldtrip-0001')), 'archived', 'preview: archived group is unavailable');

select tests.login('joiner');
select is((select status from invite_preview('blockparty-1')), 'valid', 'preview: no block, valid');
select lives_ok($$ select accept_invite('blockparty-1') $$, 'people without blocks still join');
select throws_ok($$ select accept_invite('oldtrip-0001') $$, '23514', 'group_archived', 'archived groups still refuse joins');
reset role;
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('g') and user_id in (tests.uid('blk'), tests.uid('rev'))),
  0,
  'blocked people never got a membership'
);

-- Splits-only edits -----------------------------------------------------------------------------

select tests.remember('m', tests.group_with('own', array['mem', 'pal'], '{}', 'Money'));
select tests.login('own');
select tests.remember('dinner', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('m'), 'description', 'Dinner', 'amount_cents', 3000, 'splits', tests.people('own', 'mem')))));
set constraints all immediate;
set constraints all deferred;

select tests.login('own');
select lives_ok(
  $$ select update_expense(tests.id('dinner'), jsonb_build_object('splits', tests.people('own', 'mem', 'pal'))) $$,
  'splits-only edit saves'
);
set constraints all immediate;
set constraints all deferred;
reset role;
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('dinner') and verb = 'expense.updated'),
  1,
  'splits-only edit is in the activity feed'
);
select results_eq(
  $$ select user_id from public.notifications
     where type = 'expense.updated' and data ->> 'expense_id' = tests.id('dinner')::text
     order by user_id $$,
  $$ select u from unnest(array[tests.uid('mem'), tests.uid('pal')]) u order by u $$,
  'splits-only edit notifies everyone in the old and new split but the editor'
);
select is(
  (select data ->> 'description' from public.notifications
   where type = 'expense.updated' and data ->> 'expense_id' = tests.id('dinner')::text and user_id = tests.uid('pal')),
  'Dinner',
  'with the usual payload'
);

select tests.login('own');
select update_expense(tests.id('dinner'), jsonb_build_object('splits', tests.people('own', 'mem', 'pal')));
set constraints all immediate;
set constraints all deferred;
reset role;
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('dinner') and verb = 'expense.updated'),
  1,
  'resaving the same split logs nothing'
);

select tests.login('own');
select update_expense(tests.id('dinner'), jsonb_build_object('description', 'Late dinner', 'splits', tests.people('own', 'pal')));
set constraints all immediate;
set constraints all deferred;
reset role;
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('dinner') and verb = 'expense.updated'),
  2,
  'an edit that also changes details is logged once'
);
select is(
  (select count(*)::int from public.notifications
   where type = 'expense.updated' and data ->> 'expense_id' = tests.id('dinner')::text and user_id = tests.uid('pal')),
  2,
  'and notified once'
);

-- People who left -------------------------------------------------------------------------------

select tests.remember('s', tests.group_with('own', array['mem'], '{}', 'Taxi pool'));
select tests.login('own');
select tests.remember('taxi', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('s'), 'description', 'Taxi', 'amount_cents', 1000, 'splits', tests.people('own', 'mem')))));
select tests.login('mem');
select tests.remember('pay', (select id from settle_up(tests.id('s'), tests.uid('own'), 500)));
select lives_ok($$ select leave_group(tests.id('s')) $$, 'settled member leaves');

select tests.login('own');
select throws_ok(
  $$ select delete_settlement(tests.id('pay')) $$,
  '23514', 'member_not_in_group',
  'a payment with someone who left cannot be removed'
);
select throws_ok(
  $$ select update_expense(tests.id('taxi'), jsonb_build_object('amount_cents', 2000)) $$,
  '23514', 'split_member_not_in_group',
  'the amount of an expense shared with someone who left is locked'
);
select throws_ok(
  $$ select update_expense(tests.id('taxi'), jsonb_build_object('splits', tests.people('own'))) $$,
  '23514', 'split_member_not_in_group',
  'so is dropping them from the split'
);
select lives_ok(
  $$ select update_expense(tests.id('taxi'), jsonb_build_object('description', 'Cab', 'notes', 'airport')) $$,
  'details can still change'
);
select throws_ok(
  $$ select delete_expense(tests.id('taxi')) $$,
  '23514', 'split_member_not_in_group',
  'and the expense cannot be deleted'
);
reset role;
select is(
  (select net_cents from public.group_balances where group_id = tests.id('s') and user_id = tests.uid('mem')),
  0::bigint,
  'the former member stays settled'
);

select tests.remember('s2', tests.group_with('own', array['pal'], '{}', 'Paid by a leaver'));
select tests.login('pal');
select tests.remember('beer', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('s2'), 'description', 'Beer', 'amount_cents', 800, 'splits', tests.people('own')))));
select tests.login('own');
select settle_up(tests.id('s2'), tests.uid('pal'), 800);
select tests.login('pal');
select leave_group(tests.id('s2'));
select tests.login('own');
select throws_ok(
  $$ select update_expense(tests.id('beer'), jsonb_build_object('amount_cents', 900, 'splits', tests.people('own'))) $$,
  '23514', 'split_member_not_in_group',
  'the amount of an expense paid by someone who left is locked'
);
select lives_ok(
  $$ select update_expense(tests.id('beer'), jsonb_build_object('category', 'drinks')) $$,
  'its details are not'
);

-- Former members stay readable ------------------------------------------------------------------

select tests.remember('t', tests.group_with('stayer', array['closer', 'quitter'], '{}', 'Tombstones'));
select tests.login('closer');
select create_expense(jsonb_build_object(
  'group_id', tests.id('t'), 'description', 'Groceries', 'amount_cents', 1000, 'splits', tests.people('closer', 'stayer')));
select tests.login('stayer');
select settle_up(tests.id('t'), tests.uid('closer'), 500);
select tests.login('closer');
select delete_my_account();
select tests.login('quitter');
select leave_group(tests.id('t'));
reset role;
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('t') and user_id = tests.uid('closer')),
  0,
  'the closed account had a zero balance, so its membership is gone'
);

select tests.login('stayer');
select is(
  (select display_name from public.profiles where id = tests.uid('closer')),
  'Former member',
  'co-members still read the closed account on old expenses'
);
select is(
  (select display_name from public.profiles where id = tests.uid('quitter')),
  'Quinn Quitter',
  'and people who left'
);
select tests.login('stranger');
select is(
  (select count(*)::int from public.profiles where id in (tests.uid('closer'), tests.uid('quitter'))),
  0,
  'other people still cannot'
);
select tests.login('quitter');
select is(
  (select count(*)::int from public.profiles where id = tests.uid('closer')),
  0,
  'nor can former members read each other'
);
reset role;
insert into public.group_members (group_id, user_id) values (tests.id('t'), tests.uid('quitter'));
select is(
  (select count(*)::int from private.former_members where group_id = tests.id('t') and user_id = tests.uid('quitter')),
  0,
  'rejoining clears the former member row'
);

-- Rescheduling ----------------------------------------------------------------------------------

select tests.login('own');
with ev as (
  insert into public.events (group_id, title, window_start, window_end)
  values (tests.id('m'), 'Picnic', current_date + 3, current_date + 9)
  returning id
)
select tests.remember('ev', id) from ev;
select schedule_event(tests.id('ev'), date_trunc('hour', now()) + interval '2 days');
reset role;
update public.events set reminder_sent_at = now() where id = tests.id('ev');

select tests.login('own');
select schedule_event(tests.id('ev'), date_trunc('hour', now()) + interval '2 days');
reset role;
select isnt(
  (select reminder_sent_at from public.events where id = tests.id('ev')),
  null,
  'locking in the same time again keeps the reminder as sent'
);
select tests.login('own');
select schedule_event(tests.id('ev'), date_trunc('hour', now()) + interval '2 days 1 hour');
reset role;
select is(
  (select reminder_sent_at from public.events where id = tests.id('ev')),
  null,
  'moving the time sends the reminder again'
);

select * from finish();
rollback;
