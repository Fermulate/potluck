-- Query performance migration: same answers, cheaper plans.
begin;
select plan(17);

-- Money helpers ---------------------------------------------------------------

select is(private.minor_units('usd'), 2, 'minor units ignore case');
select is(private.minor_units('JPY'), 0, 'yen has no minor unit');
select is(private.minor_units('KWD'), 3, 'dinar has three');
select is(private.convert_minor(1234, 1, 'USD', 'USD'), 1234::bigint, 'same currency at 1 is unchanged');
select is(private.convert_minor(5, 1.5, 'USD', 'USD'), 8::bigint, 'same currency rounds half away from zero');
select is(private.convert_minor(1000, 1.1, 'EUR', 'USD'), 1100::bigint, 'two-decimal pair converts cents');
select is(private.convert_minor(1000, 150, 'USD', 'JPY'), 1500::bigint, 'USD cents to whole yen');
select is(private.convert_minor(1500, 0.0067, 'JPY', 'USD'), 1005::bigint, 'yen to cents');
select is(private.convert_minor(1000, 0.3, 'USD', 'KWD'), 3000::bigint, 'cents to fils');

-- The planner inlines the helpers into plain arithmetic (a function call per
-- row made group_balances 50x slower).
create function pg_temp.plan_text(q text) returns text language plpgsql as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain (verbose, costs off) ' || q loop
    result := result || line || E'\n';
  end loop;
  return result;
end;
$$;

select ok(
  pg_temp.plan_text($$ select private.convert_minor(g::bigint, 1.08, 'EUR', case when g > 1 then 'USD' else 'JPY' end) from generate_series(1, 3) g $$)
    not like '%convert_minor%',
  'convert_minor is inlined'
);

-- Visibility is unchanged ---------------------------------------------------

select tests.create_user('pa');
select tests.create_user('pb');
select tests.create_user('pc');
select tests.create_user('pout');
select tests.remember('g', tests.group_with('pa', array['pb', 'pc'], '{}', 'Perf trip', 'USD'));
select tests.remember('other', tests.group_with('pout', '{}', '{}', 'Elsewhere', 'USD'));

select tests.login('pa');
select tests.remember('e', (select id from create_expense(jsonb_build_object('group_id', tests.id('g'),
  'description', 'Dinner', 'amount_cents', 900, 'splits', tests.people('pa', 'pb', 'pc')))));
select tests.login('pb');
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Tickets', 'amount_cents', 1200,
  'splits', tests.people('pb', 'pc')));

select tests.login('pout');
select create_expense(jsonb_build_object('group_id', tests.id('other'), 'description', 'Solo', 'amount_cents', 500,
  'splits', tests.people('pout')));
select is((select count(*)::int from public.expense_splits where expense_id = tests.id('e')), 0, 'outsiders see none of the splits');
select is((select count(*)::int from public.expenses), 1, 'outsiders see only their own group expenses');
select is((select count(*)::int from public.activity where group_id = tests.id('g')), 0, 'outsiders see none of the feed');

select tests.login('pb');
select is((select count(*)::int from public.expense_splits where expense_id = tests.id('e')), 3, 'members see every split');
select is((select count(*)::int from public.groups where id = tests.id('other')), 0, 'members do not see other groups');
select results_eq(
  $$ select user_id, net_cents from public.group_balances where group_id = tests.id('g') order by net_cents desc $$,
  $$ values (tests.uid('pa'), 600::bigint), (tests.uid('pb'), 300::bigint), (tests.uid('pc'), -900::bigint) $$,
  'balances are unchanged'
);
select results_eq(
  $$ select from_user, to_user, amount_cents from simplified_debts(tests.id('g')) $$,
  $$ values (tests.uid('pc'), tests.uid('pa'), 600::bigint), (tests.uid('pc'), tests.uid('pb'), 300::bigint) $$,
  'simplified debts read balances once and answer the same'
);

select * from finish();
rollback;
