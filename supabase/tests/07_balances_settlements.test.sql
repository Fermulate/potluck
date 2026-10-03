-- group_balances, settle_up, delete_settlement, simplified_debts.
begin;
select plan(28);

select tests.create_user('a');
select tests.create_user('b');
select tests.create_user('c');
select tests.create_user('d');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('a', array['b', 'c', 'd'], '{}', 'Trip', 'USD'));

create function pg_temp.net(handle text) returns bigint language sql as $$
  select net_cents from public.group_balances where group_id = tests.id('g') and user_id = tests.uid(handle)
$$;

select tests.login('a');
select is(
  (select count(*)::int from public.group_balances where group_id = tests.id('g') and net_cents = 0),
  4,
  'every member starts at zero'
);

-- a pays 12.00 for a, b, c
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 1200,
  'splits', tests.people('a', 'b', 'c')));
-- b pays EUR 10.00 at 1.1 for c and d (5.50 USD each)
select tests.login('b');
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Museum', 'amount_cents', 1000,
  'currency', 'EUR', 'fx_rate', 1.1, 'splits', tests.people('c', 'd')));
-- d pays a big thing that is then deleted
select tests.login('d');
select tests.remember('deleted', (select id from create_expense(jsonb_build_object('group_id', tests.id('g'),
  'description', 'Oops', 'amount_cents', 9999, 'splits', tests.people('a')))));
select delete_expense(tests.id('deleted'));
-- c pays a back 3.00
select tests.login('c');
select is((select (from_user, to_user, amount_cents, currency, fx_rate)::text from settle_up(tests.id('g'), tests.uid('a'), 300)),
  (tests.uid('c'), tests.uid('a'), 300::bigint, 'USD'::char(3), 1::numeric(18,8))::text,
  'settle_up records a payment from the caller');
-- d records a payment to b, then removes it
select tests.login('d');
select tests.remember('s_del', (select id from settle_up(tests.id('g'), tests.uid('b'), 100, null, 'cash')));
select tests.login('b');
select ok((select deleted_at is not null from delete_settlement(tests.id('s_del'))), 'the recipient can remove a payment');

select tests.login('a');
select results_eq(
  $$ select pg_temp.net('a'), pg_temp.net('b'), pg_temp.net('c'), pg_temp.net('d') $$,
  $$ values (500::bigint, 700::bigint, -650::bigint, -550::bigint) $$,
  'balances count live expenses (converted) and settlements only'
);
select is(
  (select sum(net_cents)::bigint from public.group_balances where group_id = tests.id('g')),
  0::bigint,
  'balances add up to zero'
);

select results_eq(
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('g')) $$,
  $$ values (tests.uid('c'), tests.uid('b'), 650::bigint),
            (tests.uid('d'), tests.uid('a'), 500::bigint),
            (tests.uid('d'), tests.uid('b'), 50::bigint) $$,
  'greedy: largest debtor pays largest creditor'
);

-- Rounding of converted splits never breaks the zero sum.
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Gum', 'amount_cents', 3,
  'currency', 'EUR', 'fx_rate', 1.5, 'splits', tests.people('b', 'c', 'd')));
select is(
  (select sum(net_cents)::bigint from public.group_balances where group_id = tests.id('g')),
  0::bigint,
  'balances still add up to zero with fx rounding'
);
select is(pg_temp.net('a'), 506::bigint, 'payer is credited the sum of the converted splits');

-- Settling exactly the suggested debts clears the group.
select tests.login('c');
select settle_up(tests.id('g'), tests.uid('b'), 650);
select tests.login('d');
select settle_up(tests.id('g'), tests.uid('a'), 500);
select settle_up(tests.id('g'), tests.uid('b'), 50);
select tests.login('a');
select set_eq(
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('g')) $$,
  $$ values (tests.uid('b'), tests.uid('a'), 2::bigint), (tests.uid('c'), tests.uid('a'), 2::bigint), (tests.uid('d'), tests.uid('a'), 2::bigint) $$,
  'only the gum is left'
);

-- Ties are broken by user id.
select tests.remember('t', tests.group_with('a', array['b', 'c'], '{}', 'Ties'));
select create_expense(jsonb_build_object('group_id', tests.id('t'), 'description', 'Split', 'amount_cents', 200,
  'splits', tests.people('b', 'c')));
select results_eq(
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('t')) $$,
  $$ values (least(tests.uid('b'), tests.uid('c')), tests.uid('a'), 100::bigint),
            (greatest(tests.uid('b'), tests.uid('c')), tests.uid('a'), 100::bigint) $$,
  'equal debtors are ordered by user id'
);
select results_eq(
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('t')) $$,
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('t')) $$,
  'simplified_debts is deterministic'
);

-- settle_up validation and permissions
select tests.login('b');
select throws_ok($$ select settle_up(tests.id('g'), tests.uid('outsider'), 100) $$, 'P0002', 'Both people must be in the group', 'recipient must be a member');
select throws_ok($$ select settle_up(tests.id('g'), tests.uid('a'), 0) $$, '22023', 'Enter an amount greater than zero', 'amount must be positive');
select throws_ok($$ select settle_up(tests.id('g'), tests.uid('b'), 100) $$, '22023', 'Pick who you paid', 'cannot pay yourself');
select throws_ok(
  $$ select settle_up(tests.id('g'), tests.uid('a'), 100, null, null, tests.uid('c')) $$,
  '42501', 'You can only record payments you made or received', 'members cannot record payments between others'
);
select lives_ok(
  $$ select settle_up(tests.id('g'), tests.uid('b'), 100, null, null, tests.uid('c')) $$,
  'the recipient can record a payment they received'
);
select throws_ok(
  $$ select settle_up(tests.id('g'), tests.uid('a'), 100, 'CHF') $$,
  '23514', 'No exchange rate from CHF to USD yet', 'foreign settlements need a rate'
);
reset role;
insert into public.fx_rates (base, quote, day, rate) values ('CHF', 'USD', current_date, 1.2);
select tests.login('b');
select is(
  (select fx_rate from settle_up(tests.id('g'), tests.uid('a'), 100, 'chf')),
  1.2::numeric(18,8),
  'settlement fx rate is snapshotted'
);

reset role;
update public.group_members set role = 'admin' where group_id = tests.id('g') and user_id = tests.uid('d');
select tests.login('d');
select lives_ok(
  $$ select settle_up(tests.id('g'), tests.uid('a'), 100, null, null, tests.uid('c')) $$,
  'admins can record any payment'
);

select tests.login('outsider');
select throws_ok($$ select settle_up(tests.id('g'), tests.uid('a'), 100) $$, '42501', 'You are not a member of this group', 'outsiders cannot settle');
select throws_ok($$ select * from simplified_debts(tests.id('g')) $$, '42501', 'You are not a member of this group', 'outsiders cannot see debts');
select is((select count(*)::int from public.group_balances where group_id = tests.id('g')), 0, 'outsiders see no balances');
select is((select count(*)::int from public.settlements where group_id = tests.id('g')), 0, 'outsiders see no settlements');

-- delete_settlement permissions
select tests.login('c');
select tests.remember('s2', (select id from settle_up(tests.id('g'), tests.uid('a'), 10)));
reset role;
update public.group_members set role = 'member' where group_id = tests.id('g') and user_id = tests.uid('d');
select tests.login('d');
select throws_ok($$ select delete_settlement(tests.id('s2')) $$, '42501', 'You can only remove payments you were part of', 'uninvolved members cannot remove payments');
select tests.login('a');
select lives_ok($$ select delete_settlement(tests.id('s2')) $$, 'the other party can remove it');
select throws_ok($$ select delete_settlement(gen_random_uuid()) $$, 'P0002', 'Payment not found', 'unknown settlement');

select tests.login_anon();
select throws_ok($$ select * from public.group_balances $$, '42501', null, 'anon cannot read balances');
select throws_ok($$ select settle_up(gen_random_uuid(), gen_random_uuid(), 1) $$, '42501', null, 'anon cannot settle');

select * from finish();
rollback;
