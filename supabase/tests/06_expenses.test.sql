-- create_expense / update_expense / delete_expense / restore_expense, split
-- math, the split sum constraint and expense RLS.
begin;
select plan(53);

-- Ignore any seeded rates; each test adds the ones it needs.
delete from public.fx_rates;

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('owner', array['m1', 'm2'], array['admin'], 'Flat', 'USD'));
select tests.remember('other', tests.group_with('outsider', '{}', '{}', 'Other'));

create function pg_temp.shares(eid uuid) returns bigint[] language sql as $$
  select array_agg(s.share_cents order by s.share_cents desc, s.user_id) from public.expense_splits s where s.expense_id = eid
$$;

select tests.login('m1');

-- equal
select tests.remember('e_equal', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Groceries', 'amount_cents', 100,
  'splits', tests.people('m1', 'm2', 'admin')))));
select results_eq(
  $$ select user_id, share_cents from public.expense_splits where expense_id = tests.id('e_equal') order by share_cents desc, user_id $$,
  $$ select * from (values (tests.uid('m1'), 34::bigint)) a
     union all
     select * from (select u, 33::bigint from unnest(array[tests.uid('m2'), tests.uid('admin')]) u order by u) b $$,
  'equal split: leftover cent goes to the first person listed'
);
reset role;
select is(
  (select (paid_by, created_by, split_type, currency, fx_rate, spent_at)::text from public.expenses where id = tests.id('e_equal')),
  (tests.uid('m1'), tests.uid('m1'), 'equal'::public.split_type, 'USD'::char(3), 1::numeric(18,8), current_date)::text,
  'defaults: caller pays, group currency, rate 1, today'
);
select tests.login('m1');

-- exact
select tests.remember('e_exact', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Tickets', 'amount_cents', 1000, 'split_type', 'exact',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('m1'), 'share_cents', 600),
    jsonb_build_object('user_id', tests.uid('m2'), 'share_cents', 400))))));
select is(pg_temp.shares(tests.id('e_exact')), array[600, 400]::bigint[], 'exact split keeps the given amounts');

select throws_ok(
  $$ select create_expense(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Bad', 'amount_cents', 1000, 'split_type', 'exact',
    'splits', jsonb_build_array(
      jsonb_build_object('user_id', tests.uid('m1'), 'share_cents', 600),
      jsonb_build_object('user_id', tests.uid('m2'), 'share_cents', 300)))) $$,
  '22023', 'splits_sum_mismatch', 'explicit shares must add up'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Bad', 'amount_cents', 1000, 'split_type', 'itemized',
    'splits', tests.people('m1', 'm2'))) $$,
  '22023', 'split_amount_required', 'itemized needs amounts'
);

-- percent
select tests.remember('e_pct', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Utilities', 'amount_cents', 999, 'split_type', 'percent',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('m1'), 'weight', 50),
    jsonb_build_object('user_id', tests.uid('m2'), 'weight', 30),
    jsonb_build_object('user_id', tests.uid('admin'), 'weight', 20))))));
select results_eq(
  $$ select user_id, share_cents, weight from public.expense_splits where expense_id = tests.id('e_pct') order by weight desc $$,
  $$ values (tests.uid('m1'), 499::bigint, 50::numeric), (tests.uid('m2'), 300::bigint, 30::numeric), (tests.uid('admin'), 200::bigint, 20::numeric) $$,
  'percent split uses largest remainders and keeps weights'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Bad', 'amount_cents', 1000, 'split_type', 'percent',
    'splits', jsonb_build_array(
      jsonb_build_object('user_id', tests.uid('m1'), 'weight', 50),
      jsonb_build_object('user_id', tests.uid('m2'), 'weight', 40)))) $$,
  '22023', 'percent_sum', 'percent must total 100'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Bad', 'amount_cents', 1000, 'split_type', 'percent',
    'splits', tests.people('m1', 'm2'))) $$,
  '22023', 'invalid_weight', 'percent needs weights'
);

-- shares
select tests.remember('e_shares', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Cabin', 'amount_cents', 1000, 'split_type', 'shares',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('m1'), 'weight', 1),
    jsonb_build_object('user_id', tests.uid('m2'), 'weight', 2))))));
select results_eq(
  $$ select user_id, share_cents from public.expense_splits where expense_id = tests.id('e_shares') order by share_cents $$,
  $$ values (tests.uid('m1'), 333::bigint), (tests.uid('m2'), 667::bigint) $$,
  'shares split proportionally'
);

-- validation
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 0, 'splits', tests.people('m1'))) $$,
  '22023', 'invalid_amount', 'zero amount'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 12.5, 'splits', tests.people('m1'))) $$,
  '22023', 'invalid_amount', 'fractional cents'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', '100', 'splits', tests.people('m1'))) $$,
  '22023', 'invalid_amount', 'amount must be a json number'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', '  ', 'amount_cents', 100, 'splits', tests.people('m1'))) $$,
  '22023', 'description_required', 'description required'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100)) $$,
  '22023', 'splits_required', 'splits required'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'splits', tests.people('m1', 'm1'))) $$,
  '22023', 'duplicate_user', 'no duplicate people'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'splits', tests.people('m1', 'outsider'))) $$,
  '23514', 'split_member_not_in_group', 'split members must be in the group'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'paid_by', tests.uid('outsider'), 'splits', tests.people('m1'))) $$,
  '23514', 'payer_not_in_group', 'payer must be in the group'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'split_type', 'bogus', 'splits', tests.people('m1'))) $$,
  '22023', 'invalid_payload', 'unknown split type'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('description', 'x', 'amount_cents', 100, 'splits', tests.people('m1'))) $$,
  '22023', 'group_required', 'group required'
);
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'receipt_path', 'someone-else/r.jpg', 'splits', tests.people('m1'))) $$,
  '22023', 'invalid_receipt_path', 'receipt path must be in the group folder'
);
select lives_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'receipt_path', tests.id('g') || '/r.jpg', 'splits', tests.people('m1'))) $$,
  'receipt path inside the group folder is fine'
);

select tests.login('outsider');
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'splits', tests.people('outsider'))) $$,
  '42501', 'not_a_member', 'outsiders cannot add expenses'
);
select tests.remember('other_event', (select id from (
  select gen_random_uuid() as id) x));
reset role;
insert into public.events (id, group_id, title, created_by) values (tests.id('other_event'), tests.id('other'), 'Elsewhere', tests.uid('outsider'));
select tests.login('m1');
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'x', 'amount_cents', 100, 'event_id', tests.id('other_event'), 'splits', tests.people('m1'))) $$,
  '22023', 'event_not_in_group', 'event must belong to the group'
);

-- FX
select throws_ok(
  $$ select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Croissants', 'amount_cents', 500, 'currency', 'EUR', 'splits', tests.people('m1'))) $$,
  '23514', 'fx_rate_unavailable', 'foreign currency needs a rate'
);
reset role;
insert into public.fx_rates (base, quote, day, rate) values
  ('EUR', 'USD', current_date - 3, 1.05),
  ('EUR', 'USD', current_date - 1, 1.10),
  ('USD', 'GBP', current_date - 1, 0.80);
select tests.login('m1');
select is(
  (select fx_rate from create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Croissants', 'amount_cents', 500, 'currency', 'eur', 'splits', tests.people('m1', 'm2')))),
  1.10::numeric(18,8),
  'latest rate on or before the expense date is snapshotted'
);
select is(
  (select fx_rate from create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Old croissants', 'amount_cents', 500, 'currency', 'EUR', 'spent_at', current_date - 2, 'splits', tests.people('m1')))),
  1.05::numeric(18,8),
  'rate follows spent_at'
);
select is(
  (select fx_rate from create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Tea', 'amount_cents', 500, 'currency', 'GBP', 'splits', tests.people('m1')))),
  1.25::numeric(18,8),
  'inverse pair is used when the direct one is missing'
);
select is(
  (select fx_rate from create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Yen', 'amount_cents', 500, 'currency', 'JPY', 'fx_rate', 0.0067, 'splits', tests.people('m1')))),
  0.0067::numeric(18,8),
  'an explicit rate wins'
);

-- recurring
select tests.remember('e_rec', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Internet', 'amount_cents', 6000, 'recurrence', 'monthly',
  'spent_at', '2026-01-31', 'splits', tests.people('m1', 'm2')))));
reset role;
select is(
  (select (r.recurrence, r.next_run_on, r.amount_cents, r.active)::text
   from public.recurring_expenses r join public.expenses e on e.recurring_id = r.id
   where e.id = tests.id('e_rec')),
  ('monthly'::public.recurrence, '2026-02-28'::date, 6000::bigint, true)::text,
  'recurrence creates a template for the next period'
);

-- update permissions
select tests.login('m2');
select throws_ok(
  $$ select update_expense(tests.id('e_exact'), '{"description": "mine now"}') $$,
  '42501', 'not_allowed', 'members cannot edit others'' expenses'
);
select tests.login('outsider');
select throws_ok(
  $$ select update_expense(tests.id('e_exact'), '{"description": "x"}') $$,
  '42501', 'not_a_member', 'outsiders cannot edit'
);
select tests.login('m1');
select is(
  (select description from update_expense(tests.id('e_exact'), '{"description": "Concert tickets"}')),
  'Concert tickets',
  'creators edit their expenses'
);
select is(pg_temp.shares(tests.id('e_exact')), array[600, 400]::bigint[], 'splits untouched when amount does not change');
select throws_ok(
  $$ select update_expense(tests.id('e_exact'), '{"amount_cents": 1200}') $$,
  '22023', 'split_amount_required', 'changing an exact amount needs new splits'
);
select throws_ok(
  $$ select update_expense(tests.id('e_exact'), jsonb_build_object('group_id', tests.id('other'))) $$,
  '22023', 'invalid_payload', 'group cannot change'
);

select tests.login('admin');
select lives_ok(
  $$ select update_expense(tests.id('e_equal'), '{"amount_cents": 301}') $$,
  'admins edit anyone''s expense'
);
select is(pg_temp.shares(tests.id('e_equal')), array[101, 100, 100]::bigint[], 'equal split re-derived for the new amount');
select is(
  pg_temp.shares((select id from update_expense(tests.id('e_exact'), jsonb_build_object(
    'amount_cents', 900, 'split_type', 'equal', 'splits', tests.people('m1', 'm2', 'admin'))))),
  array[300, 300, 300]::bigint[],
  'new splits replace the old ones'
);

-- the payer may edit too
reset role;
select tests.remember('e_paid', (select id from (select gen_random_uuid() id) x));
select tests.login('m2');
select tests.remember('e_paid', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Pizza', 'amount_cents', 2000, 'paid_by', tests.uid('m1'),
  'splits', tests.people('m1', 'm2')))));
select tests.login('m1');
select lives_ok($$ select update_expense(tests.id('e_paid'), '{"notes": "extra cheese"}') $$, 'the payer can edit');

-- delete / restore
select tests.login('m2');
select throws_ok($$ select delete_expense(tests.id('e_shares')) $$, '42501', 'not_allowed', 'members cannot delete others'' expenses');
select tests.login('m1');
select ok((select deleted_at is not null from delete_expense(tests.id('e_shares'))), 'soft deleted');
select is((select count(*)::int from public.expenses where id = tests.id('e_shares')), 1, 'deleted expenses stay readable for restore');
select throws_ok($$ select update_expense(tests.id('e_shares'), '{"description": "x"}') $$, '23514', 'expense_deleted', 'deleted expenses are read only');
select ok((select deleted_at is null from restore_expense(tests.id('e_shares'))), 'restored');

-- restore is blocked when someone in it has left
select delete_expense(tests.id('e_shares'));
reset role;
delete from public.group_members where group_id = tests.id('g') and user_id = tests.uid('m2');
select tests.login('m1');
select throws_ok($$ select restore_expense(tests.id('e_shares')) $$, '23514', 'split_member_not_in_group', 'restore needs everyone still in the group');

-- RLS
select tests.login('outsider');
select is((select count(*)::int from public.expenses where group_id = tests.id('g')), 0, 'outsiders see no expenses');
select is((select count(*)::int from public.expense_splits where expense_id = tests.id('e_equal')), 0, 'outsiders see no splits');
select throws_ok($$ insert into public.expense_splits (expense_id, user_id, share_cents) values (tests.id('e_equal'), tests.uid('outsider'), 1) $$, '42501', null, 'no direct split writes');

select tests.login('admin');
select is((select count(*)::int from public.expense_splits where expense_id = tests.id('e_equal')), 3, 'members see every split');
select throws_ok($$ update public.expenses set amount_cents = 1 where id = tests.id('e_equal') $$, '42501', null, 'no direct expense updates');

-- the deferred split sum constraint
reset role;
select throws_ok(
  $$ insert into public.expense_splits (expense_id, user_id, share_cents) values (tests.id('e_equal'), tests.uid('owner'), 5); set constraints all immediate $$,
  '23514', 'splits_sum_mismatch', 'adding a split that breaks the sum fails'
);
select throws_ok(
  $$ insert into public.expenses (group_id, description, amount_cents, currency, paid_by) values (tests.id('g'), 'no splits', 100, 'USD', tests.uid('owner')); set constraints all immediate $$,
  '23514', 'splits_sum_mismatch', 'an expense without splits fails at commit'
);
select lives_ok(
  $$ update public.expense_splits set share_cents = share_cents + 1 where expense_id = tests.id('e_equal') and share_cents = 101;
     update public.expenses set amount_cents = 302 where id = tests.id('e_equal');
     set constraints all immediate $$,
  'changing amount and splits together in one transaction is fine'
);

select * from finish();
rollback;
