-- Review fixes: archived groups are read only for money, groups with open
-- balances cannot be deleted, resuming a paused recurring expense never
-- back-charges, recurring templates stop for closed accounts, and editing an
-- expense's details keeps a former member's share.
begin;
select plan(27);

select tests.create_user('own');
select tests.create_user('ann');
select tests.create_user('bob');
select tests.create_user('cat');
select tests.create_user('dan');
select tests.create_user('eve');

-- Archived groups ----------------------------------------------------------------------------

select tests.remember('arch', tests.group_with('own', array['ann'], '{}', 'Archived'));
select tests.login('own');
select tests.remember('live', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('arch'), 'description', 'Rent', 'amount_cents', 1000,
  'splits', tests.people('own', 'ann')))));
select tests.remember('gone', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('arch'), 'description', 'Old', 'amount_cents', 1000,
  'splits', tests.people('own', 'ann')))));
select delete_expense(tests.id('gone'));
select tests.remember('paid', (select id from settle_up(tests.id('arch'), tests.uid('ann'), 100)));
reset role;
update public.groups set archived_at = now() where id = tests.id('arch');

select tests.login('own');
select throws_ok($$ select delete_expense(tests.id('live')) $$, '23514', 'group_archived',
  'delete_expense rejects an archived group');
select throws_ok($$ select restore_expense(tests.id('gone')) $$, '23514', 'group_archived',
  'restore_expense rejects an archived group');
select throws_ok($$ select settle_up(tests.id('arch'), tests.uid('ann'), 100) $$, '23514', 'group_archived',
  'settle_up rejects an archived group');
select throws_ok($$ select delete_settlement(tests.id('paid')) $$, '23514', 'group_archived',
  'delete_settlement rejects an archived group');
reset role;
select results_eq(
  $$ select (select deleted_at is null from public.expenses where id = tests.id('live')),
            (select deleted_at is not null from public.expenses where id = tests.id('gone')),
            (select deleted_at is null from public.settlements where id = tests.id('paid')),
            (select count(*)::int from public.settlements where group_id = tests.id('arch')) $$,
  $$ values (true, true, true, 1) $$,
  'nothing in the archived group changed'
);

-- Deleting groups with open balances ---------------------------------------------------------

select tests.remember('owed', tests.group_with('own', array['ann'], '{}', 'Owed'));
select tests.login('own');
select create_expense(jsonb_build_object(
  'group_id', tests.id('owed'), 'description', 'Dinner', 'amount_cents', 2000,
  'splits', tests.people('own', 'ann')));
select throws_ok($$ delete from public.groups where id = tests.id('owed') $$, '23514', 'group_has_balances',
  'an owner cannot delete a group with open balances');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('owed')), 1, 'the group is still there');

select tests.login('ann');
select settle_up(tests.id('owed'), tests.uid('own'), 1000);
select tests.login('own');
select lives_ok($$ delete from public.groups where id = tests.id('owed') $$, 'a settled group can be deleted');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('owed')), 0, 'and is gone');

select tests.remember('direct', tests.group_with('own', array['ann'], '{}', 'Direct'));
update public.groups set is_direct = true, members_can_invite = false where id = tests.id('direct');
select tests.login('own');
select create_expense(jsonb_build_object(
  'group_id', tests.id('direct'), 'description', 'Taxi', 'amount_cents', 500,
  'splits', tests.people('own', 'ann')));
select throws_ok($$ delete from public.groups where id = tests.id('direct') $$, '23514', 'group_has_balances',
  'one-on-one groups with a balance are protected too');
reset role;
select throws_ok($$ delete from public.groups where id = tests.id('direct') $$, '23514', 'group_has_balances',
  'the guard is a trigger, so it holds for every role');

-- The last active member closing their account still removes the group.
select tests.remember('lone', tests.group_with('cat', array['dan'], '{}', 'Lone'));
select tests.login('cat');
select create_expense(jsonb_build_object(
  'group_id', tests.id('lone'), 'description', 'Fuel', 'amount_cents', 2000,
  'splits', tests.people('cat', 'dan')));
select tests.login('dan');
select delete_my_account();
select tests.login('cat');
select lives_ok($$ select delete_my_account() $$, 'closing the last active account in a group with balances works');
reset role;
select is((select count(*)::int from public.groups where id = tests.id('lone')), 0, 'and removes that group');
select throws_ok($$ delete from public.groups where id = tests.id('direct') $$, '23514', 'group_has_balances',
  'deletes later in the same transaction are still guarded');

-- Resuming a paused recurring expense --------------------------------------------------------

select tests.remember('rg', tests.group_with('own', array['ann', 'bob'], '{}', 'Recurring'));
select tests.login('own');
select tests.remember('monthly', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Rent', 'amount_cents', 1000, 'recurrence', 'monthly',
  'spent_at', '2025-01-31', 'splits', tests.people('own', 'ann')))));
select tests.remember('weekly', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Cleaner', 'amount_cents', 3000, 'recurrence', 'weekly',
  'spent_at', '2025-01-01', 'splits', tests.people('own', 'ann')))));
select tests.remember('future', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Gym', 'amount_cents', 2000, 'recurrence', 'monthly',
  'splits', tests.people('own', 'ann')))));
update public.recurring_expenses set active = false
where id in (tests.id('monthly'), tests.id('weekly'), tests.id('future'));
update public.recurring_expenses set description = 'Flat rent' where id = tests.id('monthly');
select is(
  (select next_run_on from public.recurring_expenses where id = tests.id('monthly')),
  '2025-02-28'::date,
  'pausing and editing a paused template leave the next run alone'
);

update public.recurring_expenses set active = true
where id in (tests.id('monthly'), tests.id('weekly'), tests.id('future'));
reset role;
select ok(
  (select next_run_on >= current_date and next_run_on < current_date + 31
   from public.recurring_expenses where id = tests.id('monthly')),
  'resuming moves a monthly run to its next occurrence from today'
);
select is(
  (select extract(day from next_run_on)::int from public.recurring_expenses where id = tests.id('monthly')),
  (select least(31, extract(day from (date_trunc('month', next_run_on) + interval '1 month - 1 day'))::int)
   from public.recurring_expenses where id = tests.id('monthly')),
  'and keeps the series anchor day (the 31st, clamped to the month end)'
);
select ok(
  (select next_run_on >= current_date and next_run_on < current_date + 7
          and (next_run_on - '2025-01-08'::date) % 7 = 0
   from public.recurring_expenses where id = tests.id('weekly')),
  'resuming a weekly run keeps its weekday, from today on'
);
select is(
  (select next_run_on from public.recurring_expenses where id = tests.id('future')),
  (current_date + interval '1 month')::date,
  'a next run already in the future is kept'
);
select private.materialize_recurring_expenses(current_date);
select is(
  (select count(*)::int from public.expenses
   where recurring_id in (tests.id('monthly'), tests.id('weekly')) and spent_at < current_date),
  2,
  'resumed templates never back-charge the paused periods'
);

-- Recurring templates and closed accounts ----------------------------------------------------

select tests.login('own');
select tests.remember('splits_bob', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Internet', 'amount_cents', 1000, 'recurrence', 'monthly',
  'splits', tests.people('own', 'bob')))));
select tests.remember('splits_ann', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Water', 'amount_cents', 1000, 'recurrence', 'monthly',
  'spent_at', (current_date - 40)::text, 'splits', tests.people('own', 'ann')))));
select tests.login('bob');
select tests.remember('bob_pays', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('rg'), 'description', 'Power', 'amount_cents', 3000, 'recurrence', 'monthly',
  'splits', tests.people('own', 'bob')))));
select delete_my_account();
reset role;
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('rg') and user_id = tests.uid('bob')),
  1,
  'bob keeps his membership because of an open balance'
);
select results_eq(
  $$ select active from public.recurring_expenses
     where id in (tests.id('splits_bob'), tests.id('bob_pays'), tests.id('monthly'))
     order by description $$,
  $$ values (true), (false), (false) $$,
  'closing an account stops the templates it pays or splits, and only those'
);

-- ann closes her account without delete_my_account (still a member); the job notices.
update public.profiles set deleted_at = now() where id = tests.uid('ann');
select private.materialize_recurring_expenses(current_date);
select is(
  (select active from public.recurring_expenses where id = tests.id('splits_ann')),
  false,
  'the job deactivates a template that splits with a closed account'
);
select is(
  (select count(*)::int from public.expenses where recurring_id = tests.id('splits_ann')),
  1,
  'and charges nobody for it'
);
update public.profiles set deleted_at = null where id = tests.uid('ann');

-- Editing an expense that splits with a former member ----------------------------------------

select tests.remember('fg', tests.group_with('own', array['eve'], '{}', 'Former'));
select tests.login('own');
select tests.remember('fe', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('fg'), 'description', 'Snacks', 'amount_cents', 1000,
  'splits', tests.people('own', 'eve')))));
select tests.login('eve');
select settle_up(tests.id('fg'), tests.uid('own'), 500);
select leave_group(tests.id('fg'));
select tests.login('own');
select lives_ok(
  $$ select update_expense(tests.id('fe'), '{"description": "Party snacks", "category": "food"}') $$,
  'details can be edited without resending the split'
);
select throws_ok(
  $$ select update_expense(tests.id('fe'), jsonb_build_object('splits', tests.people('own', 'eve'))) $$,
  '23514', 'split_member_not_in_group',
  'resending a former member in the split is rejected'
);
reset role;
select results_eq(
  $$ select user_id, share_cents from public.expense_splits where expense_id = tests.id('fe') order by share_cents, user_id $$,
  $$ select * from (values (tests.uid('own'), 500::bigint), (tests.uid('eve'), 500::bigint)) v order by 2, 1 $$,
  'the former member keeps their share'
);

select * from finish();
rollback;
