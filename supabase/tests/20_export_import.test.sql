-- Export, backup and import (ADR 13): import_expenses writes a whole file or nothing, through the
-- same checks as create_expense_v2, with one activity entry and no per row notifications;
-- export_my_data returns the caller's account and nothing else.
-- Money cases match packages/core portability/import-plan.test.ts.
begin;
select plan(48);

delete from public.fx_rates;
insert into public.fx_rates (base, quote, day, rate) values ('EUR', 'USD', '2026-01-01', 1.1);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Trip', 'USD'));
select tests.remember('left', tests.group_with('ava', array['ben', 'dan'], '{}', 'Flat', 'USD'));
select tests.remember('arch', tests.group_with('ava', array['ben'], '{}', 'Old', 'USD'));
select tests.remember('other', tests.group_with('outsider', array['ben'], '{}', 'Elsewhere', 'USD'));

create function pg_temp.bal(gkey text, handle text) returns bigint language sql as $$
  select coalesce((select net_cents from public.group_balances
                   where group_id = tests.id(gkey) and user_id = tests.uid(handle)), 0)
$$;
create function pg_temp.cents(handle text, cents bigint, key text) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), key, cents)
$$;
create function pg_temp.expense(description text, amount bigint, payers jsonb, splits jsonb,
                                extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('kind', 'expense', 'description', description, 'amount_cents', amount,
    'currency', 'USD', 'spent_at', '2026-03-01', 'payers', payers, 'splits', splits) || extra
$$;
create function pg_temp.payment(from_handle text, to_handle text, amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'payment', 'from_user', tests.uid(from_handle),
    'to_user', tests.uid(to_handle), 'amount_cents', amount, 'currency', 'USD', 'paid_on', '2026-03-02')
$$;
-- The hint of the error a call raises (where the row number is), or null if it succeeds.
create function pg_temp.hint_of(call text) returns text language plpgsql as $$
declare h text;
begin
  execute call;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end;
$$;

-- A file: 90 paid 60 by Ava and 30 by Ben split by three, a 30 refund Cleo got back split
-- between Ava and Cleo, and Cleo paying Ava 10.
create function pg_temp.file() returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.expense('Dinner', 9000,
      jsonb_build_array(pg_temp.cents('ava', 6000, 'paid_cents'), pg_temp.cents('ben', 3000, 'paid_cents')),
      jsonb_build_array(pg_temp.cents('ava', 3000, 'share_cents'), pg_temp.cents('ben', 3000, 'share_cents'),
                        pg_temp.cents('cleo', 3000, 'share_cents')),
      '{"category": "food", "notes": "From Splitwise"}'),
    pg_temp.expense('Returned tickets', 3000,
      jsonb_build_array(pg_temp.cents('cleo', 3000, 'paid_cents')),
      jsonb_build_array(pg_temp.cents('ava', 1500, 'share_cents'), pg_temp.cents('cleo', 1500, 'share_cents')),
      '{"is_refund": true}'),
    pg_temp.payment('cleo', 'ava', 1000)
  )
$$;

-- Who can import ------------------------------------------------------------------------------

select tests.login_anon();
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), pg_temp.file()) $$,
  '42501', null, 'anon cannot import'
);
reset role;

select tests.login('outsider');
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), pg_temp.file()) $$,
  '42501', 'not_a_member', 'only members can import into a group'
);

reset role;
update public.groups set archived_at = now() where id = tests.id('arch');
select tests.login('ava');
select throws_ok(
  $$ select public.import_expenses(tests.id('arch'), jsonb_build_array(pg_temp.expense('Old', 100,
       jsonb_build_array(pg_temp.cents('ava', 100, 'paid_cents')),
       jsonb_build_array(pg_temp.cents('ben', 100, 'share_cents'))))) $$,
  '23514', 'group_archived', 'an archived group takes no imports'
);

-- A whole file -------------------------------------------------------------------------------

select tests.login('ben');
select is(
  public.import_expenses(tests.id('g'), pg_temp.file(), 'splitwise'),
  '{"expenses": 2, "payments": 1}'::jsonb,
  'a member imports two expenses and a payment'
);
reset role;

select is(
  array[pg_temp.bal('g', 'ava'), pg_temp.bal('g', 'ben'), pg_temp.bal('g', 'cleo')],
  -- Dinner: Ava +3000, Ben 0, Cleo -3000. Refund: Cleo -1500, Ava +1500. Payment: Cleo +1000, Ava -1000.
  array[3500, 0, -3500]::bigint[],
  'balances are what the file says'
);
select is(
  (select string_agg(p.paid_cents::text, ',' order by p.paid_cents desc) from public.expense_payers p
   join public.expenses e on e.id = p.expense_id where e.group_id = tests.id('g') and e.description = 'Dinner'),
  '6000,3000',
  'several payers are kept'
);
select is(
  (select (split_type, category, notes, spent_at, created_by)::text from public.expenses
   where group_id = tests.id('g') and description = 'Dinner'),
  ('exact', 'food', 'From Splitwise', '2026-03-01', tests.uid('ben'))::text,
  'expenses are exact splits with category, notes and date, added by the importer'
);
select ok(
  (select is_refund from public.expenses where group_id = tests.id('g') and description = 'Returned tickets'),
  'refunds stay refunds'
);
select is(
  (select (from_user, to_user, amount_cents, settled_at)::text from public.settlements where group_id = tests.id('g')),
  (tests.uid('cleo'), tests.uid('ava'), 1000, '2026-03-02 12:00:00+00'::timestamptz)::text,
  'the payment is dated the day the file gives'
);
select is(
  (select array_agg(verb) from public.activity
   where group_id = tests.id('g') and (verb like 'expense%' or verb like 'settlement%')),
  array['expenses.imported'],
  'the import is one activity entry'
);
select is(
  (select data from public.activity where group_id = tests.id('g') and verb = 'expenses.imported'),
  '{"expenses": 2, "payments": 1, "source": "splitwise"}'::jsonb,
  'the entry says what came in and from where'
);
-- The expense notifications are written at commit; run them now.
set constraints public.expenses_notify immediate;
set constraints public.expenses_notify deferred;
select is(
  (select count(*)::int from public.notifications
   where data ->> 'group_id' = tests.id('g')::text and (type like 'expense.%' or type like 'settlement.%')),
  0,
  'nobody gets a notification per imported row'
);

-- Outside an import, everything is logged and notified as before.
select set_config('potluck.importing', '', true);
select tests.login('ava');
select lives_ok(
  $$ select public.create_expense_v2(jsonb_build_object('group_id', tests.id('g'), 'description', 'Taxi',
       'amount_cents', 1200, 'splits', tests.people('ava', 'ben'))) $$,
  'a normal expense after the import'
);
reset role;
set constraints public.expenses_notify immediate;
select is(
  (select count(*)::int from public.activity where group_id = tests.id('g') and verb = 'expense.created'),
  1,
  'later expenses are logged one by one again'
);
select is(
  (select count(*)::int from public.notifications
   where data ->> 'group_id' = tests.id('g')::text and (type like 'expense.%' or type like 'settlement.%')),
  1,
  'and notify again'
);

-- Nothing or everything ----------------------------------------------------------------------

select tests.login('ava');
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), pg_temp.file() || jsonb_build_array(
       pg_temp.expense('Stranger', 100, jsonb_build_array(pg_temp.cents('ava', 100, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('outsider', 100, 'share_cents'))))) $$,
  '23514', 'split_member_not_in_group', 'a row splitting with someone outside the group fails'
);
select is(
  pg_temp.hint_of($$ select public.import_expenses(tests.id('g'), pg_temp.file() || jsonb_build_array(
       pg_temp.expense('Stranger', 100, jsonb_build_array(pg_temp.cents('ava', 100, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('outsider', 100, 'share_cents'))))) $$),
  'import_row:4',
  'the error names the row'
);
select is(
  (select count(*)::int from public.expenses where group_id = tests.id('g')),
  3,
  'and nothing from the failed file was written'
);
select is(
  (select count(*)::int from public.settlements where group_id = tests.id('g')),
  1,
  'not even the payments before it'
);
select is(
  pg_temp.hint_of($$ select public.import_expenses(tests.id('g'), jsonb_build_array(
       pg_temp.expense('Short', 9000, jsonb_build_array(pg_temp.cents('ava', 8000, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('ava', 9000, 'share_cents'))))) $$),
  'import_row:1',
  'the first row counts as 1'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(
       pg_temp.expense('Short', 9000, jsonb_build_array(pg_temp.cents('ava', 8000, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('ava', 9000, 'share_cents'))))) $$,
  '22023', 'payers_sum_mismatch', 'payers that do not add up fail like create_expense_v2'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(
       pg_temp.expense('Short', 9000, jsonb_build_array(pg_temp.cents('ava', 9000, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('ava', 8000, 'share_cents'))))) $$,
  '22023', 'splits_sum_mismatch', 'shares that do not add up fail'
);

-- Input checks -------------------------------------------------------------------------------

select throws_ok(
  $$ select public.import_expenses(tests.id('g'), '[]') $$,
  '22023', 'invalid_import', 'an empty file'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), '{"kind": "expense"}') $$,
  '22023', 'invalid_import', 'rows must be a list'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), (select jsonb_agg(pg_temp.payment('ben', 'ava', 1))
       from generate_series(1, 5001))) $$,
  '22023', 'import_too_large', 'at most 5000 rows'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), pg_temp.file(), 'quicken') $$,
  '22023', 'invalid_import', 'only known sources'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), '[{"kind": "transfer"}]') $$,
  '22023', 'invalid_import', 'a row is an expense or a payment'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(
       pg_temp.expense('Undated', 100, jsonb_build_array(pg_temp.cents('ava', 100, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('ben', 100, 'share_cents')), '{"spent_at": "someday"}'))) $$,
  '22023', 'invalid_import', 'every expense needs a date'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(
       pg_temp.expense('Nobody paid', 100, null, jsonb_build_array(pg_temp.cents('ben', 100, 'share_cents'))))) $$,
  '22023', 'invalid_payers', 'every expense says who paid'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.payment('ava', 'ava', 100))) $$,
  '22023', 'invalid_recipient', 'a payment needs two people'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.payment('ava', 'ben', 0))) $$,
  '22023', 'invalid_amount', 'a payment needs an amount'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.payment('ava', 'ben', 100)
       || '{"currency": "EURO"}')) $$,
  '22023', 'invalid_currency', 'a payment needs a currency code'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.payment('ava', 'ben', 100)
       || '{"currency": "EUR", "paid_on": "2025-06-01"}')) $$,
  '23514', 'fx_rate_unavailable', 'a payment before the first known rate fails'
);
select is(
  public.import_expenses(tests.id('g'), jsonb_build_array(pg_temp.payment('ava', 'ben', 1000)
    || '{"currency": "EUR", "paid_on": "2026-02-01"}')),
  '{"expenses": 0, "payments": 1}'::jsonb,
  'a payment in another currency takes the rate of its day'
);
reset role;
select is(
  (select fx_rate::text from public.settlements where group_id = tests.id('g') and currency = 'EUR'),
  '1.100000000000',
  'and keeps it'
);

-- People who left ----------------------------------------------------------------------------

delete from public.group_members where group_id = tests.id('left') and user_id = tests.uid('dan');
select tests.login('ava');
select throws_ok(
  $$ select public.import_expenses(tests.id('left'), jsonb_build_array(
       pg_temp.expense('Gone', 100, jsonb_build_array(pg_temp.cents('ava', 100, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('dan', 100, 'share_cents'))))) $$,
  '23514', 'split_member_not_in_group', 'no share for someone who left'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('left'), jsonb_build_array(
       pg_temp.expense('Gone', 100, jsonb_build_array(pg_temp.cents('dan', 100, 'paid_cents')),
         jsonb_build_array(pg_temp.cents('ava', 100, 'share_cents'))))) $$,
  '23514', 'payer_not_in_group', 'no payment by someone who left'
);
select throws_ok(
  $$ select public.import_expenses(tests.id('left'), jsonb_build_array(pg_temp.payment('ava', 'dan', 100))) $$,
  '23514', 'member_not_in_group', 'no payment to someone who left'
);
reset role;
select is(pg_temp.bal('left', 'dan'), 0::bigint, 'their balance did not move');

-- Backup -------------------------------------------------------------------------------------

insert into public.comments (expense_id, author_id, body)
select id, tests.uid('ava'), 'Great dinner' from public.expenses where group_id = tests.id('g') and description = 'Dinner';
insert into public.comments (expense_id, author_id, body, deleted_at)
select id, tests.uid('ava'), 'Oops', now() from public.expenses where group_id = tests.id('g') and description = 'Dinner';
select tests.login('ava');
select set_config('tests.backup', public.export_my_data()::text, true);
reset role;
create view pg_temp.backup as select current_setting('tests.backup')::jsonb as doc;

select is(
  (select (doc ->> 'format') || ' ' || (doc ->> 'version') from backup),
  'potluck-backup 1',
  'the backup names its format and version'
);
select is(
  (select doc -> 'profile' ->> 'id' from backup),
  tests.uid('ava')::text,
  'it is the caller''s profile'
);
select is(
  (select array_agg(x ->> 'name' order by x ->> 'name') from backup, jsonb_array_elements(doc -> 'groups') x),
  array['Flat', 'Old', 'Trip'],
  'every group of the caller, archived ones too, and no other'
);
select is(
  (select jsonb_array_length(x -> 'payers') from backup, jsonb_array_elements(doc -> 'groups') g,
     jsonb_array_elements(g -> 'expenses') x where x ->> 'description' = 'Dinner'),
  2,
  'expenses list their payers'
);
select is(
  (select jsonb_typeof(x -> 'fx_rate') from backup, jsonb_array_elements(doc -> 'groups') g,
     jsonb_array_elements(g -> 'payments') x where x ->> 'currency' = 'EUR'),
  'string',
  'rates are decimal text'
);
select is(
  (select jsonb_agg(c ->> 'body') from backup, jsonb_array_elements(doc -> 'groups') g,
     jsonb_array_elements(g -> 'expenses') x, jsonb_array_elements(x -> 'comments') c),
  '["Great dinner"]'::jsonb,
  'comments come with their expense, deleted ones do not'
);
select ok(
  (select bool_or(p ->> 'id' = tests.uid('dan')::text) from backup, jsonb_array_elements(doc -> 'people') p),
  'people who left are still named'
);
select ok(
  not exists (select 1 from backup, jsonb_array_elements(doc -> 'people') p
              where p ->> 'id' = tests.uid('outsider')::text),
  'people the caller shares nothing with are not'
);

select tests.login_anon();
select throws_ok($$ select public.export_my_data() $$, '42501', null, 'anon has no backup');
reset role;

select * from finish();
rollback;
