-- Expense entry (ADR 12): several payers, refunds, the adjustment split, stored line items,
-- the default split, create_expense_v2 / update_expense_v2 and what v1 keeps doing.
-- Money cases match packages/core: payers-refunds.test.ts, split-adjustment.test.ts,
-- split-itemized.test.ts and payers.test.ts.
begin;
select plan(86);

delete from public.fx_rates;
insert into public.fx_rates (base, quote, day, rate) values ('EUR', 'USD', current_date, 1.1);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('ava', array['ben', 'cleo', 'dan'], '{}', 'Trip', 'USD'));
select tests.remember('fx', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Abroad', 'USD'));
select tests.remember('r', tests.group_with('ava', array['ben'], '{}', 'Refunds', 'USD'));
select tests.remember('misc', tests.group_with('ava', array['ben'], '{}', 'Misc', 'USD'));
select tests.remember('arch', tests.group_with('ava', array['ben'], '{}', 'Old', 'USD'));
select tests.remember('other', tests.group_with('outsider', '{}', '{}', 'Elsewhere', 'USD'));

create function pg_temp.bal(gkey text, handle text) returns bigint language sql as $$
  select coalesce((select net_cents from public.group_balances
                   where group_id = tests.id(gkey) and user_id = tests.uid(handle)), 0)
$$;
create function pg_temp.share(ekey text, handle text) returns bigint language sql as $$
  select share_cents from public.expense_splits where expense_id = tests.id(ekey) and user_id = tests.uid(handle)
$$;
create function pg_temp.payers(ekey text) returns text language sql as $$
  select string_agg(p.paid_cents::text, ',' order by p.paid_cents desc) from public.expense_payers p
  where p.expense_id = tests.id(ekey)
$$;
create function pg_temp.payer(handle text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), 'paid_cents', cents)
$$;

-- Several payers -------------------------------------------------------------------------------

select tests.login('ava');
-- 90 paid 60 by Ava and 30 by Ben, split equally between three.
select tests.remember('dinner', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 9000,
  'payers', jsonb_build_array(pg_temp.payer('ben', 3000), pg_temp.payer('ava', 6000)),
  'splits', tests.people('ava', 'ben', 'cleo')))));
reset role;
select is(
  array[pg_temp.bal('g', 'ava'), pg_temp.bal('g', 'ben'), pg_temp.bal('g', 'cleo')],
  array[3000, 0, -3000]::bigint[],
  'two payers: Cleo owes 30, Ava is owed 30, Ben is square'
);
select is(pg_temp.payers('dinner'), '6000,3000', 'both payers are stored');
select is((select paid_by from public.expenses where id = tests.id('dinner')), tests.uid('ava'),
  'paid_by is whoever paid the most');
select is((select sum(net_cents)::bigint from public.group_balances where group_id = tests.id('g')), 0::bigint,
  'the group still nets to zero');

select tests.login('ava');
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Short', 'amount_cents', 9000,
    'payers', jsonb_build_array(pg_temp.payer('ava', 6000), pg_temp.payer('ben', 2000)),
    'splits', tests.people('ava', 'ben'))) $$,
  '22023', 'payers_sum_mismatch', 'payers have to add up to the amount'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Twice', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 50), pg_temp.payer('ava', 50)),
    'splits', tests.people('ava', 'ben'))) $$,
  '22023', 'invalid_payers', 'the same payer twice is refused'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Minus', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 150), pg_temp.payer('ben', -50)),
    'splits', tests.people('ava', 'ben'))) $$,
  '22023', 'invalid_payers', 'a negative payment is refused'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Nobody', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 0)),
    'splits', tests.people('ava', 'ben'))) $$,
  '22023', 'invalid_payers', 'someone has to have paid'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Stranger', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 50), pg_temp.payer('outsider', 50)),
    'splits', tests.people('ava', 'ben'))) $$,
  '23514', 'payer_not_in_group', 'every payer has to be in the group'
);

-- A payer who paid nothing is dropped.
select tests.remember('zero', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('misc'), 'description', 'Coffee', 'amount_cents', 500,
  'payers', jsonb_build_array(pg_temp.payer('ava', 500), pg_temp.payer('ben', 0)),
  'splits', tests.people('ava', 'ben')))));
select is(pg_temp.payers('zero'), '500', 'a zero payment is dropped');

-- v1 never learned about payers: it ignores the key and the caller pays.
select tests.remember('v1', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('misc'), 'description', 'Old app', 'amount_cents', 900,
  'payers', jsonb_build_array(pg_temp.payer('ben', 900)), 'is_refund', true,
  'splits', tests.people('ava', 'ben')))));
reset role;
select is(
  (select (paid_by, is_refund)::text from public.expenses where id = tests.id('v1')),
  (tests.uid('ava'), false)::text,
  'create_expense (v1) ignores payers and is_refund'
);
select is(pg_temp.payers('v1'), '900', 'v1 writes the one payer row');

-- v1 editing an expense two people paid: the same payer and amount keep both payers.
select tests.login('ava');
select lives_ok(
  $$ select update_expense(tests.id('dinner'), jsonb_build_object(
    'description', 'Dinner out', 'paid_by', tests.uid('ava'), 'amount_cents', 9000)) $$,
  'v1 can still edit the details'
);
select is(pg_temp.payers('dinner'), '6000,3000', 'and the payers stay as they were');
select throws_ok(
  $$ select update_expense(tests.id('dinner'), jsonb_build_object('amount_cents', 9900)) $$,
  '22023', 'payers_sum_mismatch', 'a new amount needs a new payers list once several paid'
);

-- Any payer may edit, like the creator. Others may not.
select tests.login('ben');
select lives_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object(
    'payers', jsonb_build_array(pg_temp.payer('ava', 5000), pg_temp.payer('ben', 4000)))) $$,
  'the second payer can edit it'
);
reset role;
select is(
  array[pg_temp.bal('g', 'ava'), pg_temp.bal('g', 'ben'), pg_temp.bal('g', 'cleo')],
  array[2000, 1000, -3000]::bigint[],
  'new payer amounts move the balances'
);
select is(
  (select count(*)::int from public.activity
   where subject_id = tests.id('dinner') and verb = 'expense.updated'),
  2,
  'a payers-only change is logged as an update'
);
select is(
  (select data -> 'changes' -> 'description' from public.activity
   where subject_id = tests.id('dinner') and verb = 'expense.updated' and data -> 'changes' ? 'description'),
  '{"from": "Dinner", "to": "Dinner out"}'::jsonb,
  'the history keeps the old and new description'
);
select is(
  (select data -> 'changes' -> 'payers' from public.activity
   where subject_id = tests.id('dinner') and verb = 'expense.updated' and data -> 'changes' ? 'payers'),
  jsonb_build_object(
    'from', jsonb_build_object(tests.uid('ava'), 6000, tests.uid('ben'), 3000),
    'to', jsonb_build_object(tests.uid('ava'), 5000, tests.uid('ben'), 4000)),
  'and the old and new payers'
);
select tests.login('ava');
select update_expense_v2(tests.id('dinner'), jsonb_build_object(
  'spent_at', '2026-01-02', 'category', 'food', 'notes', 'window seat',
  'split_type', 'exact', 'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'share_cents', 5000),
    jsonb_build_object('user_id', tests.uid('ben'), 'share_cents', 2000),
    jsonb_build_object('user_id', tests.uid('cleo'), 'share_cents', 2000))));
reset role;
select is(
  (select array_agg(k order by k) from public.activity a, jsonb_object_keys(a.data -> 'changes') k
   where a.subject_id = tests.id('dinner') and a.verb = 'expense.updated'
     and a.created_at = (select max(created_at) from public.activity where subject_id = tests.id('dinner'))
     and a.data -> 'changes' ? 'split'),
  array['category', 'notes', 'spent_at', 'split'],
  'one entry lists every field an edit changed, the split included'
);
select tests.login('ava');
select update_expense_v2(tests.id('dinner'), jsonb_build_object('split_type', 'equal',
  'splits', tests.people('ava', 'ben', 'cleo'), 'notes', null));
-- New percentages sent with a new amount are logged; the same percentages with a new amount are not.
select tests.remember('pct', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('misc'), 'description', 'Taxi', 'amount_cents', 10000, 'split_type', 'percent',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'weight', 50),
    jsonb_build_object('user_id', tests.uid('ben'), 'weight', 50))))));
select update_expense_v2(tests.id('pct'), jsonb_build_object(
  'amount_cents', 20000, 'split_type', 'percent',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'weight', 80),
    jsonb_build_object('user_id', tests.uid('ben'), 'weight', 20))));
select update_expense_v2(tests.id('pct'), jsonb_build_object(
  'amount_cents', 30000, 'split_type', 'percent',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'weight', 80),
    jsonb_build_object('user_id', tests.uid('ben'), 'weight', 20))));
reset role;
select is(
  (select array_agg(k order by k) from public.activity a, jsonb_object_keys(a.data -> 'changes') k
   where a.subject_id = tests.id('pct') and a.verb = 'expense.updated'),
  array['amount_cents', 'amount_cents', 'split'],
  'a split changed with the amount is logged, a rescale alone is not'
);
select is(
  (select a.data -> 'changes' -> 'split' from public.activity a
   where a.subject_id = tests.id('pct') and a.verb = 'expense.updated' and a.data -> 'changes' ? 'split'),
  jsonb_build_object(
    'from', jsonb_build_object('type', 'percent',
      'shares', jsonb_build_object(tests.uid('ava'), 5000, tests.uid('ben'), 5000)),
    'to', jsonb_build_object('type', 'percent',
      'shares', jsonb_build_object(tests.uid('ava'), 16000, tests.uid('ben'), 4000))),
  'with the old and new shares'
);
select tests.login('cleo');
select throws_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object('description', 'Mine now')) $$,
  '42501', 'not_allowed', 'someone who only owes cannot edit'
);

-- Foreign currency: the converted total is spread over payers and split by amount.
select tests.login('ava');
select tests.remember('euro', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('fx'), 'description', 'Museum', 'amount_cents', 1000, 'currency', 'EUR',
  'payers', jsonb_build_array(pg_temp.payer('ava', 333), pg_temp.payer('ben', 667)),
  'split_type', 'exact',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'share_cents', 334),
    jsonb_build_object('user_id', tests.uid('ben'), 'share_cents', 333),
    jsonb_build_object('user_id', tests.uid('cleo'), 'share_cents', 333))))));
reset role;
select is(
  array[pg_temp.bal('fx', 'ava'), pg_temp.bal('fx', 'ben'), pg_temp.bal('fx', 'cleo')],
  array[-2, 368, -366]::bigint[],
  'EUR at 1.1 with two payers lands on the same cents as core'
);

-- Adjustment ------------------------------------------------------------------------------------

select tests.login('ava');
select tests.remember('adj', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Cabin', 'amount_cents', 10000, 'split_type', 'adjustment',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'adjustment_cents', 1000),
    jsonb_build_object('user_id', tests.uid('ben')),
    jsonb_build_object('user_id', tests.uid('cleo'), 'adjustment_cents', 0))))));
select is(
  array[pg_temp.share('adj', 'ava'), pg_temp.share('adj', 'ben'), pg_temp.share('adj', 'cleo')],
  array[4000, 3000, 3000]::bigint[],
  'adjustment: 100 between three with +10 on Ava is 40, 30, 30'
);
select is(
  (select adjustment_cents from public.expense_splits where expense_id = tests.id('adj') and user_id = tests.uid('ava')),
  1000::bigint,
  'the adjustment is stored with the share'
);

-- 10.00 with -1.00 on the middle id: 11.00 split three ways rounds by id (367, 267, 366).
create function pg_temp.ranked(n int) returns uuid language sql as $$
  select u from unnest(array[tests.uid('ava'), tests.uid('ben'), tests.uid('cleo')]) u order by u offset n - 1 limit 1
$$;
select tests.remember('adj2', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Snacks', 'amount_cents', 1000, 'split_type', 'adjustment',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', pg_temp.ranked(1)),
    jsonb_build_object('user_id', pg_temp.ranked(2), 'adjustment_cents', -100),
    jsonb_build_object('user_id', pg_temp.ranked(3)))))));
select is(
  (select array_agg(s.share_cents order by s.user_id) from public.expense_splits s where s.expense_id = tests.id('adj2')),
  array[367, 267, 366]::bigint[],
  'adjustment rounding matches core'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Too much', 'amount_cents', 1000, 'split_type', 'adjustment',
    'splits', jsonb_build_array(
      jsonb_build_object('user_id', tests.uid('ava'), 'adjustment_cents', 800),
      jsonb_build_object('user_id', tests.uid('ben'), 'adjustment_cents', 300)))) $$,
  '22023', 'adjustments_exceed_total', 'adjustments cannot add up to more than the total'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Below zero', 'amount_cents', 1000, 'split_type', 'adjustment',
    'splits', jsonb_build_array(
      jsonb_build_object('user_id', tests.uid('ava')),
      jsonb_build_object('user_id', tests.uid('ben'), 'adjustment_cents', -1100)))) $$,
  '22023', 'negative_share', 'a minus adjustment cannot take someone below zero'
);
select lives_ok(
  $$ select update_expense_v2(tests.id('adj'), jsonb_build_object('amount_cents', 13000)) $$,
  'a new amount re-derives the adjustment split from what is stored'
);
select is(
  array[pg_temp.share('adj', 'ava'), pg_temp.share('adj', 'ben'), pg_temp.share('adj', 'cleo')],
  array[5000, 4000, 4000]::bigint[],
  'the adjustments carry over'
);

-- Refunds ---------------------------------------------------------------------------------------

select tests.remember('meal', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('r'), 'description', 'Meal', 'amount_cents', 10000,
  'splits', tests.people('ava', 'ben')))));
-- A 40 refund received by Ava, split between Ava and Ben.
select tests.remember('refund', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('r'), 'description', 'Refund', 'amount_cents', 4000, 'is_refund', true,
  'splits', tests.people('ava', 'ben')))));
reset role;
select is(
  array[pg_temp.bal('r', 'ava'), pg_temp.bal('r', 'ben')],
  array[3000, -3000]::bigint[],
  'a 40 refund received by Ava cuts what Ben owes her by 20'
);
select tests.login('ava');
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('r'), 'description', 'Monthly refund', 'amount_cents', 100, 'is_refund', true,
    'recurrence', 'monthly', 'splits', tests.people('ava', 'ben'))) $$,
  '22023', 'invalid_payload', 'a refund cannot repeat'
);
select lives_ok(
  $$ select update_expense_v2(tests.id('refund'), jsonb_build_object('is_refund', false)) $$,
  'a refund can be turned back into an expense'
);
reset role;
select is(
  array[pg_temp.bal('r', 'ava'), pg_temp.bal('r', 'ben')],
  array[7000, -7000]::bigint[],
  'and the balances follow'
);

-- Stored items ----------------------------------------------------------------------------------

select tests.login('ava');
select tests.remember('bill', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Bar', 'amount_cents', 1500, 'split_type', 'itemized',
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Tacos', 'amount_cents', 1000, 'user_ids', jsonb_build_array(tests.uid('ava'))),
    jsonb_build_object('description', 'Beer', 'amount_cents', 500, 'user_ids', jsonb_build_array(tests.uid('ben')))),
  'tax_cents', 120, 'tip_cents', 30, 'discount_cents', 150,
  'splits', tests.people('cleo')))));
select is(
  array[pg_temp.share('bill', 'ava'), pg_temp.share('bill', 'ben')],
  array[1000, 500]::bigint[],
  'items: the server works out the shares (and ignores client splits)'
);
select is(
  (select string_agg(description || ':' || amount_cents, ',' order by position) from public.expense_items where expense_id = tests.id('bill')),
  'Tacos:1000,Beer:500',
  'the items are stored in order'
);
select is(
  (select (tax_cents, tip_cents, discount_cents)::text from public.expenses where id = tests.id('bill')),
  '(120,30,150)',
  'tax, tip and discount are stored'
);
select tests.remember('bill2', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Diner', 'amount_cents', 1427, 'split_type', 'itemized',
  'items', jsonb_build_array(
    jsonb_build_object('amount_cents', 1000, 'user_ids', jsonb_build_array(tests.uid('ava'), tests.uid('ben'))),
    jsonb_build_object('amount_cents', 333, 'user_ids', jsonb_build_array(tests.uid('cleo')))),
  'tax_cents', 101, 'discount_cents', 7))));
select is(
  array[pg_temp.share('bill2', 'ava'), pg_temp.share('bill2', 'ben'), pg_temp.share('bill2', 'cleo')],
  array[535, 535, 357]::bigint[],
  'item rounding with tax and discount matches core'
);
-- Tax and tip move, the total does not: the history still says so.
select update_expense_v2(tests.id('bill2'), jsonb_build_object(
  'amount_cents', 1427, 'split_type', 'itemized',
  'items', jsonb_build_array(
    jsonb_build_object('amount_cents', 1000, 'user_ids', jsonb_build_array(tests.uid('ben'), tests.uid('ava'))),
    jsonb_build_object('amount_cents', 333, 'user_ids', jsonb_build_array(tests.uid('cleo')))),
  'tax_cents', 51, 'tip_cents', 50, 'discount_cents', 7));
select is(
  (select array_agg(k order by k) from public.activity a, jsonb_object_keys(a.data -> 'changes') k
   where a.subject_id = tests.id('bill2') and a.verb = 'expense.updated'),
  array['tax_cents', 'tip_cents'],
  'a tax and tip change with the same total is logged, and nothing else'
);
select update_expense_v2(tests.id('bill2'), jsonb_build_object(
  'split_type', 'itemized',
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Bacalhau', 'amount_cents', 1000, 'user_ids', jsonb_build_array(tests.uid('ava'), tests.uid('ben'))),
    jsonb_build_object('amount_cents', 333, 'user_ids', jsonb_build_array(tests.uid('cleo')))),
  'tax_cents', 51, 'tip_cents', 50, 'discount_cents', 7));
select is(
  (select a.data -> 'changes' -> 'items' -> 'to' -> 0 ->> 'description' from public.activity a
   where a.subject_id = tests.id('bill2') and a.verb = 'expense.updated' and a.data -> 'changes' ? 'items'),
  'Bacalhau',
  'renaming an item is logged with the old and new items'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Off', 'amount_cents', 1600, 'split_type', 'itemized',
    'items', jsonb_build_array(jsonb_build_object('amount_cents', 1500, 'user_ids', jsonb_build_array(tests.uid('ava')))))) $$,
  '22023', 'splits_sum_mismatch', 'items have to add up to the amount'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Off', 'amount_cents', 100, 'split_type', 'exact',
    'items', jsonb_build_array(jsonb_build_object('amount_cents', 100, 'user_ids', jsonb_build_array(tests.uid('ava')))),
    'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('ava'), 'share_cents', 100)))) $$,
  '22023', 'invalid_payload', 'items need a by-item split'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Free', 'amount_cents', 100, 'split_type', 'itemized',
    'items', jsonb_build_array(jsonb_build_object('amount_cents', 100, 'user_ids', jsonb_build_array(tests.uid('ava')))),
    'discount_cents', 101)) $$,
  '22023', 'invalid_items', 'a discount bigger than the bill is refused'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Nobody', 'amount_cents', 100, 'split_type', 'itemized',
    'items', jsonb_build_array(jsonb_build_object('amount_cents', 100, 'user_ids', jsonb_build_array())))) $$,
  '22023', 'invalid_items', 'every item needs someone'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Empty', 'amount_cents', 100, 'split_type', 'itemized',
    'items', jsonb_build_array())) $$,
  '22023', 'items_required', 'a by-item bill needs items'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Stranger', 'amount_cents', 100, 'split_type', 'itemized',
    'items', jsonb_build_array(jsonb_build_object('amount_cents', 100, 'user_ids', jsonb_build_array(tests.uid('outsider')))))) $$,
  '23514', 'split_member_not_in_group', 'item people must be in the group'
);
select lives_ok(
  $$ select update_expense_v2(tests.id('bill'), jsonb_build_object('description', 'Bar crawl')) $$,
  'editing the details keeps the items'
);
select is((select count(*)::int from public.expense_items where expense_id = tests.id('bill')), 2, 'items kept');
select lives_ok(
  $$ select update_expense(tests.id('bill'), jsonb_build_object('split_type', 'exact',
    'splits', jsonb_build_array(
      jsonb_build_object('user_id', tests.uid('ava'), 'share_cents', 750),
      jsonb_build_object('user_id', tests.uid('ben'), 'share_cents', 750)))) $$,
  'a rewritten split'
);
select is(
  (select (select count(*) from public.expense_items where expense_id = tests.id('bill'))::text
          || ',' || coalesce(tax_cents::text, 'null')
   from public.expenses where id = tests.id('bill')),
  '0,null',
  'drops the stored items and extras'
);

-- RLS on the new tables ---------------------------------------------------------------------------

select tests.login('cleo');
select is((select count(*)::int from public.expense_payers where expense_id = tests.id('dinner')), 2,
  'members read payers');
select is((select count(*)::int from public.expense_items where expense_id = tests.id('bill2')), 2,
  'members read items');
select tests.login('outsider');
select is((select count(*)::int from public.expense_payers where expense_id = tests.id('dinner')), 0,
  'outsiders read no payers');
select is((select count(*)::int from public.expense_items where expense_id = tests.id('bill2')), 0,
  'outsiders read no items');
select tests.login('ava');
select throws_ok(
  $$ insert into public.expense_payers (expense_id, user_id, paid_cents) values (tests.id('dinner'), tests.uid('cleo'), 1) $$,
  '42501', null, 'clients cannot write payers directly'
);
select throws_ok(
  $$ update public.expense_items set amount_cents = 1 where expense_id = tests.id('bill2') $$,
  '42501', null, 'clients cannot write items directly'
);
select tests.login_anon();
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object('group_id', tests.id('g'))) $$,
  '42501', null, 'anon cannot call create_expense_v2'
);
select throws_ok(
  $$ select update_expense_v2(tests.id('dinner'), '{}'::jsonb) $$,
  '42501', null, 'anon cannot call update_expense_v2'
);
select throws_ok(
  $$ select set_default_split(tests.id('g'), null) $$,
  '42501', null, 'anon cannot call set_default_split'
);
select tests.login('outsider');
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object('group_id', tests.id('g'), 'description', 'x',
    'amount_cents', 100, 'splits', tests.people('ava'))) $$,
  '42501', 'not_a_member', 'outsiders cannot add expenses'
);

-- The payer sum is checked at commit ---------------------------------------------------------------

reset role;
select throws_ok(
  $$ update public.expense_payers set paid_cents = 1 where expense_id = tests.id('dinner') and user_id = tests.uid('ben');
     set constraints all immediate $$,
  '23514', 'payers_sum_mismatch', 'payers that stop adding up are refused at commit'
);
set constraints all deferred;

-- Default split ---------------------------------------------------------------------------------

select tests.login('ben');
select is(
  set_default_split(tests.id('g'), jsonb_build_object('split_type', 'percent', 'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'weight', 60),
    jsonb_build_object('user_id', tests.uid('ben'), 'weight', 40)))) ->> 'split_type',
  'percent',
  'any member can save a default split'
);
reset role;
select is(
  (select jsonb_array_length(default_split -> 'splits') from public.groups where id = tests.id('g')),
  2,
  'it is stored on the group'
);
select is((select default_split from public.groups where id = tests.id('fx')), null::jsonb,
  'other groups are unaffected');
select is(
  (select count(*)::int from public.activity where group_id = tests.id('g') and verb = 'group.default_split'),
  1,
  'saving it is logged'
);
select tests.login('ben');
select throws_ok(
  $$ select set_default_split(tests.id('g'), jsonb_build_object('split_type', 'percent', 'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'weight', 60),
    jsonb_build_object('user_id', tests.uid('ben'), 'weight', 30)))) $$,
  '22023', 'percent_sum', 'percentages still add up to 100'
);
select throws_ok(
  $$ select set_default_split(tests.id('g'), jsonb_build_object('split_type', 'exact', 'splits', tests.people('ava'))) $$,
  '22023', 'invalid_splits', 'only equal, percent and shares can be a default'
);
select throws_ok(
  $$ select set_default_split(tests.id('g'), jsonb_build_object('split_type', 'equal', 'splits', tests.people('ava', 'outsider'))) $$,
  '23514', 'split_member_not_in_group', 'a default split names members only'
);
select tests.login('outsider');
select throws_ok(
  $$ select set_default_split(tests.id('g'), null) $$,
  '42501', 'not_a_member', 'outsiders cannot set it'
);
select tests.login('ava');
select is(set_default_split(tests.id('g'), null), null::jsonb, 'null goes back to equal');

-- Departed members ------------------------------------------------------------------------------

reset role;
delete from public.group_members where group_id = tests.id('g') and user_id = tests.uid('ben');
select tests.login('ava');
select throws_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object('amount_cents', 9900,
    'payers', jsonb_build_array(pg_temp.payer('ava', 5900), pg_temp.payer('ben', 4000)))) $$,
  '23514', 'split_member_not_in_group', 'a departed payer freezes the amount'
);
select throws_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object(
    'payers', jsonb_build_array(pg_temp.payer('ava', 9000)))) $$,
  '23514', 'split_member_not_in_group', 'and who paid'
);
select throws_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object('is_refund', true)) $$,
  '23514', 'split_member_not_in_group', 'and whether it is a refund'
);
select lives_ok(
  $$ select update_expense_v2(tests.id('dinner'), jsonb_build_object('description', 'Dinner (Ben left)')) $$,
  'details stay editable'
);
select throws_ok(
  $$ select delete_expense(tests.id('dinner')) $$,
  '23514', 'split_member_not_in_group', 'and it cannot be deleted'
);
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('g'), 'description', 'Later', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 50), pg_temp.payer('ben', 50)),
    'splits', tests.people('ava'))) $$,
  '23514', 'payer_not_in_group', 'someone who left cannot be a new payer'
);

-- Archived groups -------------------------------------------------------------------------------

reset role;
update public.groups set archived_at = now() where id = tests.id('arch');
select tests.login('ava');
select throws_ok(
  $$ select create_expense_v2(jsonb_build_object(
    'group_id', tests.id('arch'), 'description', 'Late', 'amount_cents', 100,
    'payers', jsonb_build_array(pg_temp.payer('ava', 50), pg_temp.payer('ben', 50)),
    'splits', tests.people('ava', 'ben'))) $$,
  '23514', 'group_archived', 'archived groups take no expenses'
);
select throws_ok(
  $$ select set_default_split(tests.id('arch'), null) $$,
  '23514', 'group_archived', 'or default splits'
);

-- Recurring with several payers -------------------------------------------------------------------

select tests.remember('rent', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('fx'), 'description', 'Rent', 'amount_cents', 3000, 'recurrence', 'monthly',
  'payers', jsonb_build_array(pg_temp.payer('ava', 2000), pg_temp.payer('cleo', 1000)),
  'splits', tests.people('ava', 'ben', 'cleo')))));
reset role;
update public.recurring_expenses set active = false where group_id <> tests.id('fx');
select is(
  (select jsonb_array_length(r.payers) from public.recurring_expenses r
   join public.expenses e on e.recurring_id = r.id where e.id = tests.id('rent')),
  2,
  'the template keeps both payers'
);
select is(private.materialize_recurring_expenses((current_date + interval '1 month')::date), 1,
  'the next one posts');
select is(
  (select string_agg(p.paid_cents::text, ',' order by p.paid_cents desc)
   from public.expense_payers p join public.expenses e on e.id = p.expense_id
   where e.recurring_id = (select recurring_id from public.expenses where id = tests.id('rent'))
     and e.id <> tests.id('rent')),
  '2000,1000',
  'with both payers'
);

-- Notifications reach every payer -----------------------------------------------------------------

select tests.login('ava');
select tests.remember('gift', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('fx'), 'description', 'Gift', 'amount_cents', 1000,
  'payers', jsonb_build_array(pg_temp.payer('ava', 500), pg_temp.payer('ben', 500)),
  'splits', tests.people('cleo')))));
set constraints all immediate;
set constraints all deferred;
reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.uid('ben') and type = 'expense.created' and data ->> 'expense_id' = tests.id('gift')::text),
  1,
  'a payer outside the split hears about it'
);
select is(
  (select (g ->> 'expenses')::int
   from jsonb_array_elements(private.monthly_summary(tests.uid('ben'), current_date) -> 'groups') g
   where g ->> 'group_id' = tests.id('fx')::text),
  (select count(*)::int from public.expenses e
   where e.group_id = tests.id('fx') and e.deleted_at is null
     and (exists (select 1 from public.expense_payers x where x.expense_id = e.id and x.user_id = tests.uid('ben'))
          or exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.user_id = tests.uid('ben')))),
  'the monthly summary counts expenses someone paid part of'
);
select tests.login('ava');
select delete_expense(tests.id('gift'));
reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.uid('ben') and type = 'expense.deleted' and data ->> 'expense_id' = tests.id('gift')::text),
  1,
  'and hears when it is deleted'
);

select * from finish();
rollback;
