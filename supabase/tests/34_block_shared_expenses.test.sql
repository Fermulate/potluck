-- A block reaches every expense (20261114154849_block_shared_expenses): once either person has
-- blocked the other, no new expense names both of them, as payers or with a share, in any group
-- or 1:1 tab. Creating, editing so someone comes in, repeating expenses and import are covered;
-- details of older expenses, payments and settling up keep working, and no answer says who
-- blocked whom. Ben and Cleo are the pair; Ava and Dan have no block with anyone.
begin;
select plan(36);

delete from public.fx_rates;

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');

select tests.remember('g', tests.group_with('ava', array['ben', 'cleo', 'dan'], '{}', 'Flat', 'USD'));

create function pg_temp.cents(handle text, cents bigint, key text) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), key, cents)
$$;
create function pg_temp.add(gkey text, payer text, variadic handles text[]) returns text language sql as $$
  select format(
    $f$ select public.create_expense_v2(jsonb_build_object('group_id', %L, 'description', 'Dinner',
        'amount_cents', 1200, 'paid_by', %L, 'splits', %L::jsonb)) $f$,
    tests.id(gkey), tests.uid(payer), tests.people(variadic handles))
$$;
create function pg_temp.import_row(payer text, variadic handles text[]) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'expense', 'description', 'Imported', 'amount_cents', 100 * cardinality(handles),
    'currency', 'USD', 'spent_at', '2026-03-01',
    'payers', jsonb_build_array(pg_temp.cents(payer, 100 * cardinality(handles), 'paid_cents')),
    'splits', (select jsonb_agg(pg_temp.cents(h, 100, 'share_cents')) from unnest(handles) h))
$$;
create function pg_temp.payment(from_handle text, to_handle text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'payment', 'from_user', tests.uid(from_handle),
    'to_user', tests.uid(to_handle), 'amount_cents', 100, 'currency', 'USD', 'paid_on', '2026-03-02')
$$;
-- The detail of the error a call raises: it must never name anyone.
create function pg_temp.detail_of(call text) returns text language plpgsql as $$
declare d text;
begin
  execute call;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end;
$$;

-- Before the block: a shared expense, a pair expense, a 1:1 tab, two repeating expenses -------

select tests.login('ava');
select tests.remember('old', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Groceries', 'amount_cents', 900, 'paid_by', tests.uid('ava'),
  'splits', tests.people('ava', 'ben', 'cleo')))));
select tests.remember('pair', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Taxi', 'amount_cents', 600, 'paid_by', tests.uid('ava'),
  'splits', tests.people('ava', 'ben')))));
select tests.remember('both_monthly', (select recurring_id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Internet', 'amount_cents', 3000, 'paid_by', tests.uid('ben'),
  'recurrence', 'monthly', 'spent_at', '2026-01-10', 'splits', tests.people('ben', 'cleo')))));
select tests.remember('other_monthly', (select recurring_id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Cleaner', 'amount_cents', 2000, 'paid_by', tests.uid('ava'),
  'recurrence', 'monthly', 'spent_at', '2026-01-10', 'splits', tests.people('ava', 'dan')))));
select tests.remember('ben_monthly', (select recurring_id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Gym', 'amount_cents', 2000, 'paid_by', tests.uid('ava'),
  'recurrence', 'monthly', 'spent_at', '2026-01-10', 'splits', tests.people('ava', 'ben')))));

select tests.login('ben');
select tests.remember('tab', public.get_or_create_direct_group(tests.uid('cleo')));
select tests.remember('tab_lunch', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('tab'), 'description', 'Lunch', 'amount_cents', 800, 'paid_by', tests.uid('ben'),
  'splits', tests.people('ben', 'cleo')))));

select tests.login('ben');
select public.block_user(tests.uid('cleo'));

-- New expenses in a group: refused for everyone, in both directions ------------------------

select tests.login('cleo');
select throws_ok(pg_temp.add('g', 'cleo', 'ben', 'cleo'), '23514', 'blocked_person',
  'the blocked person cannot add an expense with the blocker');
select tests.login('ben');
select throws_ok(pg_temp.add('g', 'ben', 'ben', 'cleo'), '23514', 'blocked_person',
  'nor can the person who blocked');
select throws_ok(pg_temp.add('g', 'cleo', 'ben'), '23514', 'blocked_person',
  'a payer counts as much as a share');
select tests.login('ava');
select throws_ok(pg_temp.add('g', 'ava', 'ava', 'ben', 'cleo'), '23514', 'blocked_person',
  'nor anyone else in the group');
select is(pg_temp.detail_of(pg_temp.add('g', 'ava', 'ava', 'ben', 'cleo')),
  'Some people in this expense cannot share one; take one of them out',
  'the answer names nobody and does not say who blocked whom');
select lives_ok(pg_temp.add('g', 'ava', 'ava', 'ben', 'dan'), 'people with no block between them still split');
select throws_ok(
  format($$ select public.create_expense_with_attachments(jsonb_build_object('group_id', %L,
    'description', 'Dinner', 'amount_cents', 1200, 'paid_by', %L, 'splits', %L::jsonb), '[]'::jsonb) $$,
    tests.id('g'), tests.uid('ava'), tests.people('ben', 'cleo')),
  '23514', 'blocked_person', 'an expense with files is refused the same way'
);
select throws_ok(
  format($$ select public.create_expense_v2(jsonb_build_object('group_id', %L, 'description', 'Rent',
    'amount_cents', 1200, 'paid_by', %L, 'recurrence', 'monthly', 'splits', %L::jsonb)) $$,
    tests.id('g'), tests.uid('ava'), tests.people('ben', 'cleo')),
  '23514', 'blocked_person', 'and so is a new repeating expense'
);

-- The other direction ------------------------------------------------------------------------

reset role;
delete from public.blocks where blocker_id = tests.uid('ben');
insert into public.blocks (blocker_id, blocked_id) values (tests.uid('cleo'), tests.uid('ben'));
select tests.login('ben');
select throws_ok(pg_temp.add('g', 'ben', 'ben', 'cleo'), '23514', 'blocked_person',
  'a block the other way stops the blocked side');
select tests.login('cleo');
select throws_ok(pg_temp.add('g', 'cleo', 'ben', 'cleo'), '23514', 'blocked_person',
  '...and the side who blocked');
select tests.login('ava');
select throws_ok(pg_temp.add('g', 'ava', 'ava', 'ben', 'cleo'), '23514', 'blocked_person',
  '...and everyone else');
reset role;
delete from public.blocks where blocker_id = tests.uid('cleo');
select tests.login('ava');
select lives_ok(pg_temp.add('g', 'ava', 'ben', 'cleo'), 'once the block is lifted they split again');
reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.uid('ben'), tests.uid('cleo'));

-- Edits ---------------------------------------------------------------------------------------

select tests.login('ava');
select lives_ok(
  format($$ select public.update_expense_v2(%L, '{"description": "Big shop", "notes": "Market"}') $$, tests.id('old')),
  'the details of an expense from before the block stay editable'
);
select lives_ok(
  format($$ select public.update_expense_v2(%L, '{"amount_cents": 1200, "category": "food"}') $$, tests.id('old')),
  'so does its amount, with the same people in it'
);
select lives_ok(
  format($$ select public.update_expense_v2(%L, jsonb_build_object('splits', %L::jsonb)) $$,
    tests.id('old'), tests.people('ava', 'ben', 'cleo', 'dan')),
  'bringing in someone with no block is fine'
);
select throws_ok(
  format($$ select public.update_expense_v2(%L, jsonb_build_object('splits', %L::jsonb)) $$,
    tests.id('pair'), tests.people('ava', 'ben', 'cleo')),
  '23514', 'blocked_person', 'bringing someone into the split across a block is refused'
);
select throws_ok(
  format($$ select public.update_expense_v2(%L, jsonb_build_object('payers', jsonb_build_array(
    jsonb_build_object('user_id', %L, 'paid_cents', 600)))) $$,
    tests.id('pair'), tests.uid('cleo')),
  '23514', 'blocked_person', '...and so is bringing them in as the payer'
);
select throws_ok(
  format($$ select public.update_expense(%L, jsonb_build_object('splits', %L::jsonb)) $$,
    tests.id('pair'), tests.people('ben', 'cleo')),
  '23514', 'blocked_person', 'the first version of the edit call refuses it too'
);

-- Payments and settling up -----------------------------------------------------------------

select tests.login('ben');
select lives_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 300) $$, tests.id('g'), tests.uid('ben'), tests.uid('cleo')),
  'the two can still pay each other in a group'
);

-- A 1:1 tab ---------------------------------------------------------------------------------

select throws_ok(pg_temp.add('tab', 'ben', 'ben', 'cleo'), '42501', 'not_a_friend',
  'the person who blocked can no longer add to the tab, told only what a stranger is told');
select tests.login('cleo');
select throws_ok(pg_temp.add('tab', 'cleo', 'ben', 'cleo'), '42501', 'not_a_friend',
  'nor can the blocked person');
select tests.login('ben');
select lives_ok(
  format($$ select public.update_expense_v2(%L, '{"description": "Long lunch"}') $$, tests.id('tab_lunch')),
  'the blocker can still fix the details of an older one'
);
select lives_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('tab'), tests.uid('cleo'), tests.uid('ben')),
  'and settle up there'
);
select is(public.can_split_with(tests.uid('cleo')), false, 'can_split_with says no to the blocker too');

-- Import -------------------------------------------------------------------------------------

select tests.login('ava');
select throws_ok(
  format($$ select public.import_expenses(%L, jsonb_build_array(%L::jsonb, %L::jsonb)) $$,
    tests.id('g'), pg_temp.import_row('ava', 'ava', 'dan'), pg_temp.import_row('ava', 'ben', 'cleo')),
  '23514', 'blocked_person', 'an imported row naming the pair is refused'
);
select is(
  pg_temp.detail_of(format($$ select public.import_expenses(%L, jsonb_build_array(%L::jsonb)) $$,
    tests.id('g'), pg_temp.import_row('cleo', 'ben'))),
  'Some people in this expense cannot share one; take one of them out',
  'a payer and a share across a block count too, and the row names nobody'
);
select is(
  public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.import_row('ava', 'ava', 'dan'),
    pg_temp.payment('ben', 'cleo'))),
  '{"expenses": 1, "payments": 1}'::jsonb,
  'other rows and payments between the pair import'
);
select tests.login('ben');
select throws_ok(
  format($$ select public.import_expenses(%L, jsonb_build_array(%L::jsonb)) $$,
    tests.id('tab'), pg_temp.import_row('ben', 'ben', 'cleo')),
  '42501', 'not_a_friend', 'the blocker cannot import expenses into the tab'
);
select is(
  public.import_expenses(tests.id('tab'), jsonb_build_array(pg_temp.payment('ben', 'cleo'))),
  '{"expenses": 0, "payments": 1}'::jsonb,
  'but can import payments there'
);

-- Repeating expenses -------------------------------------------------------------------------

select tests.login('ava');
select throws_ok(
  format($$ select public.update_recurring_expense(%L, jsonb_build_object('splits', %L::jsonb)) $$,
    tests.id('ben_monthly'), tests.people('ava', 'ben', 'cleo')),
  '23514', 'blocked_person', 'a repeating expense cannot take in someone across a block'
);
select lives_ok(
  format($$ select public.update_recurring_expense(%L, '{"description": "Fibre", "amount_cents": 3200}') $$,
    tests.id('both_monthly')),
  'one from before the block keeps its details and amount editable'
);

reset role;
select private.materialize_recurring_expenses('2026-03-20');
select is(
  (select count(*)::int from public.expenses e where e.recurring_id = tests.id('both_monthly')),
  1,
  'the nightly run posts nothing naming the pair (only the first one, from before the block)'
);
select is(
  (select next_run_on from public.recurring_expenses r where r.id = tests.id('both_monthly')),
  '2026-04-10'::date,
  'its missed dates are skipped, not kept for later'
);
select is(
  (select active from public.recurring_expenses r where r.id = tests.id('both_monthly')),
  true,
  'and it stays on, to post again once the block is lifted'
);
select is(
  (select count(*)::int from public.expenses e where e.recurring_id = tests.id('other_monthly')),
  3,
  'the rest of the run goes on: January, February and March'
);

delete from public.blocks where blocker_id = tests.uid('ben');
select private.materialize_recurring_expenses('2026-04-10');
select is(
  (select count(*)::int from public.expenses e where e.recurring_id = tests.id('both_monthly')),
  2,
  'after Unblock it posts on its next date'
);

select * from finish();
rollback;
