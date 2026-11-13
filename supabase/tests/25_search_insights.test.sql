-- Search, the expense ledger and spending totals (20261113172837_search_insights.sql).
-- The totals case is the same as spendingSummary in packages/core/src/insights.
begin;
select plan(72);

delete from public.fx_rates;
insert into public.fx_rates (base, quote, day, rate) values
  ('EUR', 'USD', '2026-03-01', 1.1),
  ('USD', 'EUR', '2026-03-01', 0.9),
  ('USD', 'EUR', '2026-04-01', 0.95),
  ('GBP', 'USD', '2026-03-01', 1.25);

select tests.create_user('ava', 'Ava Stone');
select tests.create_user('ben', 'Benny Ortiz');
select tests.create_user('cleo', 'Cleo Park');
select tests.create_user('dan', 'Dan Wu');
select tests.create_user('eve', 'Eve Hart');
select tests.create_user('zed', 'Zed Nobody');
select tests.remember('g', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Flat', 'USD'));
select tests.remember('h', tests.group_with('ava', array['dan'], '{}', 'Road trip', 'USD'));
select tests.remember('x', tests.group_with('eve', '{}', '{}', 'Secret', 'USD'));
select tests.remember('f', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Book club', 'USD'));

select tests.login('ava');
select tests.remember('e1', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Taco night', 'amount_cents', 9000, 'category', 'food',
  'spent_at', '2026-03-05', 'splits', tests.people('ava', 'ben', 'cleo')))));
select tests.remember('t2', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('h'), 'description', 'Taco truck', 'amount_cents', 2400, 'category', 'food',
  'spent_at', '2026-03-07', 'splits', tests.people('ava', 'dan')))));

select tests.login('ben');
select tests.remember('e2', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Groceries', 'amount_cents', 1200, 'category', 'groceries',
  'spent_at', '2026-03-20', 'splits', tests.people('ava', 'ben', 'cleo')))));
insert into public.comments (expense_id, body) values (tests.id('e2'), 'Remember the salsa');
select tests.remember('s1', (select id from settle_up(tests.id('g'), tests.uid('ava'), 3000, null, 'Venmo for tacos')));

select tests.login('cleo');
select tests.remember('e3', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Hotel', 'amount_cents', 10000, 'currency', 'EUR',
  'category', 'lodging', 'notes', 'Two nights near the beach', 'spent_at', '2026-04-02',
  'split_type', 'exact', 'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'share_cents', 5000),
    jsonb_build_object('user_id', tests.uid('cleo'), 'share_cents', 5000))))));

select tests.login('ben');
select create_expense(jsonb_build_object('group_id', tests.id('f'), 'description', 'Lunch for two',
  'amount_cents', 2000, 'category', 'food', 'spent_at', '2026-03-25', 'splits', tests.people('ben', 'cleo')));

select tests.login('eve');
select create_expense(jsonb_build_object('group_id', tests.id('x'), 'description', 'Taco secret',
  'amount_cents', 500, 'spent_at', '2026-03-06', 'splits', tests.people('eve')));

reset role;
update public.settlements set settled_at = '2026-04-10 12:00+00' where id = tests.id('s1');

-- Search: who sees what ---------------------------------------------------------------------

select tests.login('ava');
select results_eq(
  $$ select description from search_money('taco') $$,
  array['Venmo for tacos', 'Taco truck', 'Taco night'],
  'ava finds taco in both of her groups, newest first, and nothing from groups she is not in'
);
select is((select matched from search_money('TACO') where description = 'Taco night'), 'description',
  'matching ignores case');

select tests.login('ben');
select results_eq($$ select description from search_money('taco') $$, array['Venmo for tacos', 'Taco night'],
  'ben only finds the taco in the group he shares');

select tests.login('eve');
select results_eq($$ select description from search_money('taco') $$, array['Taco secret'],
  'eve only finds her own taco');

select tests.login('zed');
select is((select count(*)::int from search_money('taco')), 0, 'someone in no group finds nothing');
select is((select count(*)::int from search_money(null)), 0, 'and lists nothing without a query');

select tests.login('ava');
select throws_ok(format($$ select * from search_money('taco', %L) $$, tests.id('x')),
  '42501', 'not_a_member', 'searching a group you are not in is refused');

select tests.login_anon();
select throws_ok($$ select * from search_money('taco') $$, '42501', null, 'anon cannot search');

-- Search: what matches ----------------------------------------------------------------------

select tests.login('ava');
select is((select (description, matched, snippet)::text from search_money('salsa')),
  '(Groceries,comment,"Remember the salsa")', 'comments match, with the comment as the snippet');
select is((select (description, matched)::text from search_money('beach')),
  '(Hotel,notes)', 'notes match');
select results_eq($$ select kind || ':' || coalesce(description, '') from search_money('benny') $$,
  array['payment:Venmo for tacos', 'expense:Lunch for two', 'expense:Groceries', 'expense:Taco night'],
  'people match on who paid or who is in the split, payments included');
select is((select matched from search_money('benny') where kind = 'expense' limit 1), 'person',
  'a name match says so');
select results_eq($$ select description from search_money('12') $$, array['Groceries'],
  'a plain number matches the amount in the expense currency');
select results_eq($$ select description from search_money('$90.00') $$, array['Taco night'],
  'an amount with a symbol and cents matches too');
select results_eq($$ select description from search_money('100 EUR') $$, array['Hotel'],
  'an amount with a currency code matches in that expense''s currency');
select is((select count(*)::int from search_money('%')), 0, 'LIKE wildcards are literal');
select is((select count(*)::int from search_money('_')), 0, 'underscore is literal too');
select results_eq($$ select description from search_money('tacos') $$, array['Venmo for tacos'],
  'payment notes match');

-- Search: filters -------------------------------------------------------------------------

select results_eq(
  format($$ select description from search_money(null, %L) $$, tests.id('g')),
  array['Venmo for tacos', 'Hotel', 'Groceries', 'Taco night'],
  'no query lists the group, payments included, newest first'
);
select results_eq(
  format($$ select description from search_money(null, %L, person => %L, categories => array['food']) $$,
    tests.id('g'), tests.uid('ben')),
  array['Taco night'],
  'person plus category narrows to the expenses ben is in'
);
select results_eq(
  format($$ select description from search_money(null, %L, from_day => '2026-03-01', to_day => '2026-03-31') $$,
    tests.id('g')),
  array['Groceries', 'Taco night'],
  'a date range keeps only that month'
);
select results_eq(
  format($$ select kind from search_money(null, %L, kinds => array['payment']) $$, tests.id('g')),
  array['payment'], 'the type filter keeps only payments'
);
select results_eq(
  format($$ select description from search_money(null, %L, person => %L) $$, tests.id('g'), tests.uid('dan')),
  array[]::text[], 'a person filter for someone outside the group finds nothing'
);
select is(
  (select (my_paid_cents, my_share_cents, group_amount_cents)::text from search_money('taco night')),
  '(9000,3000,9000)', 'results carry what the viewer paid and their share'
);
select is(
  (select (amount_cents, currency, group_amount_cents, my_share_cents)::text from search_money('hotel')),
  '(10000,EUR,11000,5500)', 'foreign expenses carry the converted amount and share'
);
select is(
  (select (paid_by, to_user, day)::text from search_money(null, kinds => array['payment'])),
  (select (tests.uid('ben'), tests.uid('ava'), '2026-04-10'::date)::text),
  'payments say who paid whom and on which day'
);

-- Search: paging and input checks ---------------------------------------------------------

select tests.remember('first', (select id from search_money(null, tests.id('g'), max_rows => 1)));
select is(tests.id('first'), tests.id('s1'), 'the first page of one is the newest item');
select results_eq(
  format($$ select description from search_money(null, %L, before_day => '2026-04-10',
    before_at => (select settled_at from public.settlements where id = %L), before_id => %L, max_rows => 2) $$,
    tests.id('g'), tests.id('s1'), tests.id('s1')),
  array['Hotel', 'Groceries'],
  'the next page starts right after the cursor'
);
select throws_ok($$ select * from search_money(null, from_day => '2026-04-01', to_day => '2026-03-01') $$,
  '22023', 'invalid_date_range', 'a backwards date range is refused');
select throws_ok($$ select * from search_money(null, before_day => '2026-04-01') $$,
  '22023', 'invalid_cursor', 'a partial cursor is refused');
select throws_ok(format($$ select * from search_money(%L) $$, repeat('a', 201)),
  '22023', 'invalid_query', 'a very long query is refused');

-- Recently deleted ------------------------------------------------------------------------

select tests.login('ben');
select delete_expense(tests.id('e2'));
select tests.login('ava');
select delete_settlement(tests.id('s1'));
reset role;
update public.expenses set deleted_at = now() - interval '1 hour' where id = tests.id('e2');
select tests.login('ava');
select is((select count(*)::int from search_money('groceries')), 0, 'deleted expenses drop out of search');
select results_eq(
  format($$ select d.kind || ' ' || coalesce(d.description, '') || ' by ' || p.display_name
    from deleted_items(%L) d join public.profiles p on p.id = d.deleted_by $$, tests.id('g')),
  array['payment Venmo for tacos by Ava Stone', 'expense Groceries by Benny Ortiz'],
  'Recently deleted lists both kinds, last deleted first, with who deleted them'
);
select throws_ok(format($$ select * from deleted_items(%L, before_at => now()) $$, tests.id('g')),
  '22023', 'invalid_cursor', 'a partial cursor is refused');
select tests.login('eve');
select throws_ok(format($$ select * from deleted_items(%L) $$, tests.id('g')),
  '42501', 'not_a_member', 'other groups'' deleted items stay hidden');
select tests.login_anon();
select throws_ok(format($$ select * from deleted_items(%L) $$, tests.id('g')),
  '42501', null, 'anon cannot list deleted items');
select tests.login('ben');
select restore_expense(tests.id('e2'));
reset role;
select tests.login('ava');
select restore_settlement(tests.id('s1'));

-- Activity with a friend -------------------------------------------------------------------

select tests.login('ava');
select results_eq(
  format($$ select verb from friend_activity(%L) order by verb $$, tests.uid('ben')),
  array['comment.created', 'expense.created', 'expense.created', 'expense.deleted',
        'expense.restored', 'settlement.created', 'settlement.deleted', 'settlement.restored',
        'settlement.updated'],
  'with Ben: what both paid for or share, and payments between them, not Ben''s lunch with Cleo'
);
select is(
  (select group_info ->> 'name' from friend_activity(tests.uid('ben')) where verb = 'settlement.created'),
  'Flat', 'entries say which group they are in'
);
select results_eq(
  format($$ select verb from friend_activity(%L) $$, tests.uid('dan')),
  array['expense.created'], 'with Dan: only the road trip taco'
);
select tests.login('ben');
select is((select count(*)::int from friend_activity(tests.uid('ava'))), 9, 'Ben sees the same entries with Ava');
select tests.login('eve');
select is((select count(*)::int from friend_activity(tests.uid('ben'))), 0, 'someone outside the groups sees nothing');
select throws_ok(format($$ select * from friend_activity(%L) $$, tests.uid('eve')),
  '22023', 'invalid_friend', 'not with yourself');
select tests.login_anon();
select throws_ok(format($$ select * from friend_activity(%L) $$, tests.uid('ben')),
  '42501', null, 'anon cannot read the feed');

-- Ledger ----------------------------------------------------------------------------------

select tests.login('ava');
select is(
  (select count(*)::int from public.expense_ledger l
   join lateral (select sum(share_cents) as s, max(total_cents) as t from public.expense_ledger x
                 where x.expense_id = l.expense_id) agg on true
   where agg.s <> agg.t),
  0, 'every expense''s shares add up to its converted total'
);
select is(
  (select (sum(paid_cents) - sum(share_cents))::int from public.expense_ledger
   where group_id = tests.id('g') and user_id = tests.uid('ava')),
  (select net_cents::int + 3000 from public.group_balances where group_id = tests.id('g') and user_id = tests.uid('ava')),
  'paid minus share is the expense part of the balance'
);
select is((select count(*)::int from public.expense_ledger where group_id = tests.id('x')), 0,
  'ava sees no ledger rows from a group she is not in');
select tests.login('eve');
select is((select count(*)::int from public.expense_ledger where group_id = tests.id('g')), 0,
  'eve sees none of the flat''s ledger');
select tests.login_anon();
select throws_ok($$ select * from public.expense_ledger $$, '42501', null, 'anon cannot read the ledger');

-- Totals ----------------------------------------------------------------------------------

select tests.login('ava');
select results_eq(
  format($$ select (month, category, expense_count, spend_cents, paid_cents, share_cents,
      payments_made_cents, payments_received_cents)::text
    from spending_summary(%L) $$, tests.id('g')),
  array[
    '(2026-03-01,food,1,9000,9000,3000,0,0)',
    '(2026-03-01,groceries,1,1200,0,400,0,0)',
    '(2026-04-01,lodging,1,11000,0,5500,0,0)',
    '(2026-04-01,,0,0,0,0,0,3000)'
  ],
  'totals per month and category in group currency, payments on their own row'
);
select is(
  (select (sum(paid_cents) - sum(share_cents) + sum(payments_made_cents) - sum(payments_received_cents))::int
   from spending_summary(tests.id('g'))),
  (select net_cents::int from public.group_balances where group_id = tests.id('g') and user_id = tests.uid('ava')),
  'all time, the net change equals the balance'
);
select is(
  (select sum(share_cents)::int from spending_summary(tests.id('g'), '2026-03-01', '2026-03-31')),
  3400, 'March is the sum of ava''s March shares'
);
select is(
  (select sum(my_share_cents)::int from search_money(null, tests.id('g'), from_day => '2026-03-01', to_day => '2026-03-31')),
  3400, 'search over the same month agrees with the totals'
);
select results_eq(
  $$ select (group_id, sum(spend_cents))::text from spending_summary() group by group_id order by 1 $$,
  $$ select (gid, total)::text from (values (tests.id('g'), 21200::numeric), (tests.id('h'), 2400::numeric), (tests.id('f'), 2000::numeric)) v (gid, total) order by 1 $$,
  'with no group, every group the viewer is in, and only those'
);
select tests.login('ben');
select is(
  (select (sum(paid_cents), sum(share_cents), sum(payments_made_cents))::text from spending_summary(tests.id('g'))),
  '(1200,3400,3000)', 'each viewer gets their own numbers'
);
select tests.login('ava');
select throws_ok(format($$ select * from spending_summary(%L) $$, tests.id('x')),
  '42501', 'not_a_member', 'totals for a group you are not in are refused');
select throws_ok($$ select * from spending_summary(null, '2026-04-01', '2026-03-01') $$,
  '22023', 'invalid_date_range', 'a backwards range is refused');
select tests.login_anon();
select throws_ok($$ select * from spending_summary() $$, '42501', null, 'anon cannot read totals');

-- Totals in one currency (same case as the core test): each amount converted at its date.
select tests.login('ava');
select results_eq(
  format($$ select (month, category, currency, expense_count, spend_cents, paid_cents, share_cents,
      payments_made_cents, payments_received_cents, unconverted_count)::text
    from spending_summary(%L, in_currency => 'EUR') $$, tests.id('g')),
  array[
    '(2026-03-01,food,EUR,1,8100,8100,2700,0,0,0)',
    '(2026-03-01,groceries,EUR,1,1080,0,360,0,0,0)',
    '(2026-04-01,lodging,EUR,1,10450,0,5225,0,0,0)',
    '(2026-04-01,,EUR,0,0,0,0,0,2850,0)'
  ],
  'converted into EUR at the rate of each expense''s date'
);
select is(
  (select (sum(spend_cents), sum(share_cents))::text from spending_summary(tests.id('g'), in_currency => 'usd')),
  '(21200,8900)', 'converting into the group''s own currency changes nothing'
);
select is(
  (select (sum(unconverted_count), sum(spend_cents))::text from spending_summary(tests.id('g'), in_currency => 'JPY')),
  '(4,0)', 'amounts with no rate are left out and counted'
);
select throws_ok($$ select * from spending_summary(in_currency => 'US') $$,
  '22023', 'invalid_currency', 'a malformed currency is refused');

-- EUR into GBP with no rate between them: through USD (1.1 and the inverse of 1.25), the same
-- case as spendingRate in core. Only the Spending view does this; expenses never triangulate.
reset role;
select is(private.insights_fx_rate('EUR', 'GBP', '2026-03-10'), 0.880000000000::numeric,
  'the Spending rate goes through a common base');
select is(private.fx_rate('EUR', 'GBP', '2026-03-10'), null::numeric,
  'the rate expenses are saved with does not');
select tests.remember('p', tests.group_with('ava', array['ben'], '{}', 'Paris', 'EUR'));
select tests.login('ava');
select create_expense(jsonb_build_object('group_id', tests.id('p'), 'description', 'Croissants',
  'amount_cents', 1000, 'currency', 'EUR', 'spent_at', '2026-03-10', 'splits', tests.people('ava', 'ben')));
select is(
  (select (expense_count, spend_cents, share_cents, unconverted_count)::text
   from spending_summary(tests.id('p'), in_currency => 'GBP')),
  '(1,880,440,0)', 'a EUR group shows in GBP through USD'
);
select throws_ok($$ select private.insights_fx_rate('EUR', 'GBP', current_date) $$,
  '42501', null, 'clients cannot call the helper');

-- Several payers and a refund (the same case as the core test): 90 paid 60 by Ava and 30 by
-- Ben, split three ways; then a 40 refund Ava got, split between Ava and Ben.
reset role;
select tests.remember('m', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Market', 'USD'));
select tests.login('ava');
select tests.remember('m1', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('m'), 'description', 'Dinner', 'amount_cents', 9000, 'spent_at', '2026-05-02',
  'category', 'food',
  'payers', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'paid_cents', 6000),
    jsonb_build_object('user_id', tests.uid('ben'), 'paid_cents', 3000)),
  'splits', tests.people('ava', 'ben', 'cleo')))));
select create_expense_v2(jsonb_build_object(
  'group_id', tests.id('m'), 'description', 'Returned tickets', 'amount_cents', 4000,
  'spent_at', '2026-05-09', 'category', 'tickets', 'is_refund', true,
  'payers', jsonb_build_array(jsonb_build_object('user_id', tests.uid('ava'), 'paid_cents', 4000)),
  'splits', tests.people('ava', 'ben')));
select results_eq(
  format($$ select (p.display_name, l.paid_cents, l.share_cents)::text from public.expense_ledger l
    join public.profiles p on p.id = l.user_id where l.expense_id = %L order by p.display_name $$, tests.id('m1')),
  array['("Ava Stone",6000,3000)', '("Benny Ortiz",3000,3000)', '("Cleo Park",0,3000)'],
  'each payer is credited what they paid'
);
select is(
  (select (sum(spend_cents), sum(paid_cents), sum(share_cents))::text from spending_summary(tests.id('m'))),
  '(5000,2000,1000)', 'a refund comes off the spend, what Ava paid and her share'
);
select is(
  (select (sum(paid_cents) - sum(share_cents))::int from spending_summary(tests.id('m'))),
  (select net_cents::int from public.group_balances where group_id = tests.id('m') and user_id = tests.uid('ava')),
  'paid minus share is still the balance with several payers and a refund'
);
select tests.login('ben');
select is(
  (select (sum(paid_cents), sum(share_cents))::text from spending_summary(tests.id('m'))),
  '(3000,1000)', 'Ben paid 30 and his share is 30 less the 20 he gets back'
);
select is(
  (select (matched, payers = array[tests.uid('ava'), tests.uid('ben')])::text
   from search_money('benny', tests.id('m')) where description = 'Dinner'),
  '(person,t)', 'search finds a second payer by name and lists every payer'
);

-- Plans -----------------------------------------------------------------------------------

reset role;
create function pg_temp.plan_text(q text) returns text language plpgsql as $$
declare
  line text;
  result text := '';
begin
  set local enable_seqscan = off;
  for line in execute 'explain (costs off) ' || q loop
    result := result || line || E'\n';
  end loop;
  reset enable_seqscan;
  return result;
end;
$$;
select ok(
  pg_temp.plan_text($$ select id from public.expenses where description ilike '%taco%' $$)
    like '%expenses_description_trgm_idx%',
  'description search can use the trigram index'
);
select ok(
  pg_temp.plan_text($$ select id from public.comments where expense_id is not null and deleted_at is null and body ilike '%salsa%' $$)
    like '%comments_body_trgm_idx%',
  'comment search can use the trigram index'
);

select * from finish();
rollback;
