-- Request keys (20261114193218_request_keys): a save tried again with the same request id, after
-- its reply was lost, returns the expense or payment the first try made instead of adding a second
-- one. Keys belong to whoever sent them; calls without a key work as before; a refused call keeps
-- nothing, so the next try with the key goes through; clients cannot read the keys.
begin;
select plan(19);

delete from public.fx_rates;

select tests.create_user('ava');
select tests.create_user('ben');
select tests.remember('g', tests.group_with('ava', array['ben'], '{}', 'Flat', 'USD'));
select tests.remember('k1', gen_random_uuid());
select tests.remember('k2', gen_random_uuid());
select tests.remember('k3', gen_random_uuid());
select tests.remember('k4', gen_random_uuid());

create function pg_temp.dinner(what text, key uuid) returns jsonb language sql as $$
  select jsonb_build_object('group_id', tests.id('g'), 'description', what,
    'amount_cents', 1200, 'paid_by', tests.uid('ava'), 'splits', tests.people('ava', 'ben'))
    || case when key is null then '{}'::jsonb else jsonb_build_object('request_id', key) end
$$;
create function pg_temp.count_of(what text) returns int language sql security definer as $$
  select count(*)::int from public.expenses e where e.group_id = tests.id('g') and e.description = what
$$;
create function pg_temp.payments() returns int language sql security definer as $$
  select count(*)::int from public.settlements s where s.group_id = tests.id('g')
$$;

-- Expenses ----------------------------------------------------------------------------------

select tests.login('ava');
select tests.remember('first', (select id from public.create_expense_v2(pg_temp.dinner('Dinner', tests.id('k1')))));
select is(
  (select id from public.create_expense_v2(pg_temp.dinner('Dinner', tests.id('k1')))),
  tests.id('first'),
  'the same key again returns the expense the first try made'
);
select is(pg_temp.count_of('Dinner'), 1, 'and nothing new is saved');
select is(
  (select id from public.create_expense_v2(pg_temp.dinner('Dinner, edited', tests.id('k1')))),
  tests.id('first'),
  'a retry with the key returns the saved expense even if the form changed meanwhile'
);
select is(pg_temp.count_of('Dinner, edited'), 0, 'so the second payload is not saved');

select tests.login('ben');
select isnt(
  (select id from public.create_expense_v2(pg_temp.dinner('Dinner', tests.id('k1')))),
  tests.id('first'),
  'keys belong to whoever sent them: the same id from someone else saves their own expense'
);
select is(pg_temp.count_of('Dinner'), 2, 'which is a second Dinner');

select tests.login('ava');
select public.create_expense_v2(pg_temp.dinner('Lunch', null));
select public.create_expense_v2(pg_temp.dinner('Lunch', null));
select is(pg_temp.count_of('Lunch'), 2, 'without a key every call saves, as before');

select public.create_expense_v2(pg_temp.dinner('Brunch', null) || '{"request_id": "not-a-uuid"}');
select public.create_expense_v2(pg_temp.dinner('Brunch', null) || '{"request_id": "not-a-uuid"}');
select is(pg_temp.count_of('Brunch'), 2, 'a key that is not a uuid is ignored');

select tests.remember('with_files', (select id from public.create_expense_with_attachments(
  pg_temp.dinner('Tapas', tests.id('k2')), '[]')));
select is(
  (select id from public.create_expense_with_attachments(pg_temp.dinner('Tapas', tests.id('k2')), '[]')),
  tests.id('with_files'),
  'create_expense_with_attachments returns the first expense for the same key'
);
select is(pg_temp.count_of('Tapas'), 1, 'and saves it once');
select is(
  (select id from public.create_expense_v2(pg_temp.dinner('Tapas', tests.id('k2')))),
  tests.id('with_files'),
  'an expense key is the same whichever create call carries it'
);

-- A refused try keeps nothing.
select throws_ok(
  format($$ select public.create_expense_v2(%L::jsonb - 'description') $$,
    pg_temp.dinner('Supper', tests.id('k3'))),
  '22023'
);
select lives_ok(
  format($$ select public.create_expense_v2(%L) $$, pg_temp.dinner('Supper', tests.id('k3'))),
  'so the next try with that key saves'
);
select is(pg_temp.count_of('Supper'), 1, 'once');

-- Payments ----------------------------------------------------------------------------------

select tests.remember('paid', (select id from public.settle_up_v3(
  tests.id('g'), tests.uid('ben'), tests.uid('ava'), 500, request_id => tests.id('k4'))));
select is(
  (select id from public.settle_up_v3(
    tests.id('g'), tests.uid('ben'), tests.uid('ava'), 500, request_id => tests.id('k4'))),
  tests.id('paid'),
  'settle_up_v3 with the same key returns the first payment'
);
select is(pg_temp.payments(), 1, 'and records it once');
select public.settle_up_v3(tests.id('g'), tests.uid('ben'), tests.uid('ava'), 500);
select is(pg_temp.payments(), 2, 'without a key it records each call, like settle_up_v2');

-- An expense key and a payment key never meet.
select isnt(
  (select id from public.settle_up_v3(
    tests.id('g'), tests.uid('ben'), tests.uid('ava'), 500, request_id => tests.id('k1'))),
  tests.id('first'),
  'a payment with an expense key is its own payment'
);

select throws_ok(
  $$ select count(*) from private.request_keys $$,
  '42501',
  null,
  'clients cannot read the keys'
);

select * from finish();
rollback;
