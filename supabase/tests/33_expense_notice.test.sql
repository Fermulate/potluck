-- A new expense's notification carries each recipient's share and what they paid
-- (20261114072315_expense_notice_paid_share).
begin;
select plan(3);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.remember('g', tests.group_with('ava', array['ben', 'cleo', 'dan'], '{}', 'Trip', 'USD'));

create function pg_temp.payer(handle text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), 'paid_cents', cents)
$$;
grant execute on function pg_temp.payer(text, bigint) to authenticated;

create function pg_temp.notices(ekey text) returns table (user_id uuid, share bigint, paid bigint, refund boolean)
language sql as $$
  select n.user_id, (n.data ->> 'share_cents')::bigint, (n.data ->> 'paid_cents')::bigint,
         (n.data ->> 'is_refund')::boolean
  from public.notifications n
  where n.type = 'expense.created' and n.data ->> 'expense_id' = tests.id(ekey)::text
$$;

-- 90 paid 60 by Ava and 30 by Dan (who is not in the split), split between Ava, Ben and Cleo.
select tests.login('ava');
select tests.remember('dinner', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 9000,
  'payers', jsonb_build_array(pg_temp.payer('ava', 6000), pg_temp.payer('dan', 3000)),
  'splits', tests.people('ava', 'ben', 'cleo')))));
-- A refund of 30 to Ben, split between Ben and Cleo.
select tests.remember('refund', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Returned tickets', 'amount_cents', 3000,
  'is_refund', true,
  'payers', jsonb_build_array(pg_temp.payer('ben', 3000)),
  'splits', tests.people('ben', 'cleo')))));

-- Notifications go out at commit; fire them now.
reset role;
set constraints all immediate;

select set_eq(
  $$ select user_id, share, paid from pg_temp.notices('dinner') $$,
  $$ values (tests.uid('ben'), 3000::bigint, 0::bigint),
            (tests.uid('cleo'), 3000::bigint, 0::bigint),
            (tests.uid('dan'), 0::bigint, 3000::bigint) $$,
  'everyone but the actor hears their share and what they paid, a payer outside the split too'
);
select set_eq(
  $$ select user_id, share, paid from pg_temp.notices('refund') $$,
  $$ values (tests.uid('ben'), 1500::bigint, 3000::bigint),
            (tests.uid('cleo'), 1500::bigint, 0::bigint) $$,
  'a refund carries the same, for the app to turn around'
);
select ok(
  (select bool_and(refund) from pg_temp.notices('refund')),
  'and says it is a refund'
);

select * from finish();
rollback;
