-- Ledger and membership integrity: blocks on invites, former members, splits-only
-- edits, payments with people who left, owners left with closed accounts,
-- rescheduling reminders and FX precision.
begin;
select plan(57);

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
select tests.create_user('gone');
select tests.create_user('unseen');
select tests.create_user('later');
select tests.create_user('boss');
select tests.create_user('ghost');
select tests.create_user('multi');

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
select is((select status from invite_preview('blockparty-1')), 'revoked', 'preview: a member blocked the visitor, who sees a revoked link');
select throws_ok($$ select accept_invite('blockparty-1') $$, '23514', 'invite_revoked', 'joining is refused when a member blocked you, like a revoked link');

select tests.login('rev');
select is((select status from invite_preview('blockparty-1')), 'revoked', 'preview: the visitor blocked a member');
select throws_ok($$ select accept_invite('blockparty-1') $$, '23514', 'invite_revoked', 'joining is refused when you blocked a member');

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

select tests.remember('t', tests.group_with('stayer', array['closer', 'quitter', 'unseen'], '{}', 'Tombstones'));
select tests.login('closer');
select tests.remember('groceries', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('t'), 'description', 'Groceries', 'amount_cents', 1000, 'splits', tests.people('closer', 'stayer')))));
select tests.login('stayer');
select settle_up(tests.id('t'), tests.uid('closer'), 500);
select tests.login('closer');
select delete_my_account();
select tests.login('quitter');
insert into public.comments (expense_id, body) values (tests.id('groceries'), 'Thanks for getting these');
select leave_group(tests.id('t'));
select tests.login('unseen');
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
-- Someone joining later never shared the group with the leavers, so only what the group still
-- shows of them (an expense, a comment) keeps their name readable.
reset role;
insert into public.group_members (group_id, user_id) values (tests.id('t'), tests.uid('later'));
select tests.login('later');
select is(
  (select display_name from public.profiles where id = tests.uid('closer')),
  'Former member',
  'a later joiner reads who paid an old expense'
);
select is(
  (select display_name from public.profiles where id = tests.uid('quitter')),
  'Quinn Quitter',
  'and who commented on it'
);
select is(
  (select count(*)::int from public.profiles where id = tests.uid('unseen')),
  0,
  'but not someone who only joined and left'
);
reset role;
insert into public.group_members (group_id, user_id) values (tests.id('t'), tests.uid('quitter'));
select is(
  (select count(*)::int from private.former_members where group_id = tests.id('t') and user_id = tests.uid('quitter')),
  0,
  'rejoining clears the former member row'
);

-- Operators hard-delete accounts (the app only soft-closes them); the membership goes with the
-- profile and leaves no tombstone behind.
select tests.remember('gone', tests.uid('gone'));
insert into public.group_members (group_id, user_id) values (tests.id('t'), tests.id('gone'));
select lives_ok(
  $$ delete from auth.users where id = tests.id('gone') $$,
  'hard-deleting a member with no money in the group works'
);
select is(
  (select count(*)::int from private.former_members where user_id = tests.id('gone')),
  0,
  'and records no former member for the vanished profile'
);

-- Owner left with closed accounts ---------------------------------------------------------------

select tests.remember('o', tests.group_with('boss', array['ghost'], '{}', 'Haunted'));
select tests.remember('o2', tests.group_with('boss', array['stayer'], '{}', 'Busy'));
select tests.login('ghost');
select create_expense(jsonb_build_object(
  'group_id', tests.id('o'), 'description', 'Seance', 'amount_cents', 1000, 'splits', tests.people('ghost', 'boss')));
select delete_my_account();
reset role;
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('o') and user_id = tests.uid('ghost')),
  1,
  'the closed account with an open balance stays in the group'
);

select tests.login('boss');
select throws_ok(
  $$ select transfer_ownership(tests.id('o'), tests.uid('ghost')) $$,
  'PT404', 'member_not_found',
  'ownership cannot go to a closed account'
);
select lives_ok($$ select leave_group(tests.id('o')) $$, 'the last active member can leave');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('o')), 0, 'which deletes the group');
select tests.login('boss');
select throws_ok(
  $$ select leave_group(tests.id('o2')) $$,
  '23514', 'owner_must_transfer',
  'with someone active left, the owner still has to transfer'
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

-- Closing an account in several groups ----------------------------------------------------------

select tests.remember('mo', tests.group_with('multi', array['pal'], '{}', 'Owned by multi'));
select tests.remember('mz', tests.group_with('own', array['multi'], '{}', 'Settled'));
select tests.remember('md', tests.group_with('own', array['multi'], '{}', 'Owing'));
select tests.login('own');
select create_expense(jsonb_build_object(
  'group_id', tests.id('md'), 'description', 'Rent', 'amount_cents', 1000, 'splits', tests.people('own', 'multi')));
select tests.login('multi');
select lives_ok($$ select delete_my_account() $$, 'closing an account locks and walks every group it is in');
reset role;
select results_eq(
  $$ select g, (select m.role::text from public.group_members m where m.group_id = g and m.user_id = tests.uid('multi'))
     from unnest(array[tests.id('mo'), tests.id('mz'), tests.id('md')]) g $$,
  $$ values (tests.id('mo'), null::text), (tests.id('mz'), null::text), (tests.id('md'), 'member'::text) $$,
  'settled memberships removed (the owned one after handing it over), open balance kept'
);
select is(
  (select user_id from public.group_members where group_id = tests.id('mo') and role = 'owner'),
  tests.uid('pal'),
  'the heir owns the group'
);

-- Recurring expenses job ------------------------------------------------------------------------

select tests.remember('rj', tests.group_with('own', array['pal'], '{}', 'Rent share'));
select tests.remember('ra', tests.group_with('own', array['pal'], '{}', 'Old flat'));
select tests.login('own');
select tests.remember('rj_t', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rj'), 'description', 'Rent', 'amount_cents', 2000, 'spent_at', current_date - 40,
  'recurrence', 'monthly', 'splits', tests.people('own', 'pal')))));
select tests.remember('ra_t', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('ra'), 'description', 'Old rent', 'amount_cents', 2000, 'spent_at', current_date - 40,
  'recurrence', 'monthly', 'splits', tests.people('own', 'pal')))));
reset role;
select set_config('request.jwt.claims', '', true);
update public.groups set archived_at = now() where id = tests.id('ra');
select private.materialize_recurring_expenses(current_date);
select is(
  (select count(*)::int from public.expenses where recurring_id = tests.id('rj_t')),
  2,
  'the job still adds the due expense in an open group'
);
select ok(
  (select next_run_on > current_date from public.recurring_expenses where id = tests.id('rj_t')),
  'and moves the next run past today'
);
select results_eq(
  $$ select active, (select count(*)::int from public.expenses e where e.recurring_id = r.id)
     from public.recurring_expenses r where r.id = tests.id('ra_t') $$,
  $$ values (false, 1) $$,
  'a template in an archived group is paused without a new expense'
);
select tests.login('own');
select throws_ok(
  $$ update public.recurring_expenses set active = true where id = tests.id('ra_t') $$,
  '23514', 'group_archived',
  'people still cannot touch templates in an archived group after the job ran'
);
reset role;

-- FX precision ----------------------------------------------------------------------------------

insert into public.fx_rates (base, quote, day, rate) values
  ('IDR', 'USD', current_date, 0.000061714286),
  ('USD', 'KRW', current_date, 1400)
on conflict (base, quote, day) do update set rate = excluded.rate;
delete from public.fx_rates where base = 'KRW' and quote = 'USD';

select is(
  (select rate from public.fx_rates where base = 'IDR' and quote = 'USD' and day = current_date),
  0.000061714286::numeric,
  'rates keep 12 decimals'
);
select is(private.fx_rate('KRW', 'USD', current_date), 0.000714285714::numeric, 'inverse rates are rounded to 12 decimals');

select tests.login('own');
select tests.remember('rupiah', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('m'), 'description', 'Villa', 'amount_cents', 10000000000, 'currency', 'IDR',
  'splits', tests.people('own')))));
reset role;
select is(
  (select fx_rate from public.expenses where id = tests.id('rupiah')),
  0.000061714286::numeric,
  'the expense snapshots the full rate'
);
select is(
  (select private.convert_minor(e.amount_cents, e.fx_rate, e.currency, 'USD') from public.expenses e where e.id = tests.id('rupiah')),
  617143::bigint,
  '100,000,000 IDR converts to 6,171.43 USD (8 decimals gave 6,171.00)'
);
select is(private.convert_minor(1050, 1.1, 'EUR', 'USD'), 1155::bigint, 'ordinary conversions are unchanged');

select has_index('public', 'fx_rates', 'fx_rates_quote_day_idx', 'currency picker lookups by quote are indexed');

select * from finish();
rollback;
