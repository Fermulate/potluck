-- Repeating expenses you can change (ADR 14): every 2 weeks, editing a template's amount, payers
-- and split (future expenses only), making an existing expense repeat, skipping one, the heads-up
-- the day before, and the departed member and archived group rules for each.
-- Schedule cases match packages/core/src/recurrence/recurrence.test.ts.
begin;
select plan(95);

delete from public.fx_rates;
insert into public.fx_rates (base, quote, day, rate) values ('EUR', 'USD', current_date, 1.1);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.create_user('eve');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('ava', array['ben', 'cleo', 'eve'], array['dan'], 'Flat', 'USD'));
select tests.remember('h', tests.group_with('ava', array['ben'], '{}', 'Old flat', 'USD'));
select tests.remember('arch', tests.group_with('ava', array['ben'], '{}', 'Shelved', 'USD'));

create function pg_temp.payer(handle text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), 'paid_cents', cents)
$$;
create function pg_temp.edit(key text, payload jsonb) returns public.recurring_expenses language sql as $$
  select * from public.update_recurring_expense(tests.id(key), payload)
$$;
create function pg_temp.tpl(key text) returns public.recurring_expenses language sql as $$
  select * from public.recurring_expenses where id = tests.id(key)
$$;

-- Schedule math ---------------------------------------------------------------------------------

select is(private.recurring_step('2026-01-01', 'biweekly', 1), '2026-01-15'::date, 'every 2 weeks adds 14 days');
select is(private.recurring_step('2026-12-25', 'biweekly', 25), '2027-01-08'::date, 'across a year end');
select is(private.recurring_step('2028-02-20', 'biweekly', 20), '2028-03-05'::date, 'across a leap day');
select is(private.recurring_next_from('2026-11-10', 'monthly', 10, '2026-11-13'), '2026-12-10'::date,
  'a recent start repeats one month on');
select is(private.recurring_next_from('2026-11-10', 'weekly', 10, '2026-11-13'), '2026-11-17'::date, 'one week on');
select is(private.recurring_next_from('2026-11-10', 'biweekly', 10, '2026-11-13'), '2026-11-24'::date, 'two weeks on');
select is(private.recurring_next_from('2026-11-10', 'yearly', 10, '2026-11-13'), '2027-11-10'::date, 'one year on');
select is(private.recurring_next_from('2026-08-01', 'monthly', 1, '2026-11-13'), '2026-12-01'::date,
  'missed months are skipped, not back-charged');
select is(private.recurring_next_from('2026-10-01', 'biweekly', 1, '2026-11-13'), '2026-11-26'::date,
  'missed fortnights are skipped');
select is(private.recurring_next_from('2026-09-01', 'weekly', 1, '2026-11-13'), '2026-11-17'::date,
  'missed weeks are skipped');
select is(private.recurring_next_from('2026-10-13', 'monthly', 13, '2026-11-13'), '2026-11-13'::date,
  'a date on the floor itself is kept');
select is(private.recurring_next_from('2026-01-31', 'monthly', 31, '2026-02-01'), '2026-02-28'::date,
  'short months clamp');
select is(private.recurring_next_from('2026-01-31', 'monthly', 31, '2026-03-01'), '2026-03-31'::date,
  'and the anchor day comes back');
select is(private.recurring_next_from('2026-01-31', 'monthly', 30, '2026-04-05'), '2026-04-30'::date,
  'the anchor day wins over the start day');

-- Every 2 weeks -------------------------------------------------------------------------------------

select tests.login('ava');
select tests.remember('fortnight', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Cleaner', 'amount_cents', 6000, 'recurrence', 'biweekly',
  'spent_at', '2026-11-01', 'splits', tests.people('ava', 'ben', 'cleo')))));
reset role;
select is((pg_temp.tpl('fortnight')).next_run_on, '2026-11-15'::date, 'a fortnightly template is due 14 days later');
select private.materialize_recurring_expenses('2026-11-29');
select is(
  (select array_agg(spent_at order by spent_at) from public.expenses where recurring_id = tests.id('fortnight')),
  array['2026-11-01', '2026-11-15', '2026-11-29']::date[],
  'the job posts it every 14 days'
);
select is((pg_temp.tpl('fortnight')).next_run_on, '2026-12-13'::date, 'and moves it on by 14 days');

-- Editing amount, payers and split -------------------------------------------------------------

select tests.login('ava');
select tests.remember('rent', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Rent', 'amount_cents', 150000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben', 'cleo')))));

select tests.login('eve');
select throws_ok($$ select pg_temp.edit('rent', '{"amount_cents": 1}') $$,
  '42501', 'not_allowed', 'a member who is not in it cannot edit it');
select tests.login('ben');
select lives_ok($$ select pg_temp.edit('rent', '{"category": "rent"}') $$,
  'someone in the split can edit it, as with expenses');
select tests.login('outsider');
select throws_ok($$ select pg_temp.edit('rent', '{"amount_cents": 1}') $$,
  '42501', null, 'outsiders cannot edit it');
select tests.login('dan');
select lives_ok($$ select pg_temp.edit('rent', '{"description": "Flat rent"}') $$, 'an admin can edit it');

select tests.login('ava');
select lives_ok($$ select pg_temp.edit('rent', '{"amount_cents": 160000}') $$, 'the creator changes the amount');
reset role;
select is(
  array[(pg_temp.tpl('rent')).amount_cents,
        (select amount_cents from public.expenses where recurring_id = tests.id('rent'))],
  array[160000, 150000]::bigint[],
  'the template is 1600 and the expense already posted stays 1500'
);
select private.materialize_recurring_expenses((pg_temp.tpl('rent')).next_run_on);
select is(
  (select array_agg(s.share_cents order by s.share_cents desc) from public.expense_splits s
   join public.expenses e on e.id = s.expense_id
   where e.recurring_id = tests.id('rent') and e.amount_cents = 160000),
  array[53334, 53333, 53333]::bigint[],
  'the next posted expense is 1600, split equally'
);

select tests.login('ava');
select lives_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'payers', jsonb_build_array(pg_temp.payer('ava', 100000), pg_temp.payer('ben', 60000)),
  'split_type', 'adjustment',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('ava'), 'adjustment_cents', 10000),
    jsonb_build_object('user_id', tests.uid('ben')),
    jsonb_build_object('user_id', tests.uid('cleo'))))), 'several payers and an adjustment split');
select is(
  ((pg_temp.tpl('rent')).paid_by, jsonb_array_length((pg_temp.tpl('rent')).payers), (pg_temp.tpl('rent')).split_type)::text,
  (tests.uid('ava'), 2, 'adjustment'::public.split_type)::text,
  'the template keeps both payers, the bigger one as paid_by'
);
select throws_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'payers', jsonb_build_array(pg_temp.payer('ava', 100000)))),
  '22023', 'payers_sum_mismatch', 'payers must add up to the amount');
select throws_ok($$ select pg_temp.edit('rent', '{"amount_cents": 170000}') $$,
  '22023', 'payers_sum_mismatch', 'a new amount needs new payer amounts once several people pay');
select throws_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object('next_run_on', current_date - 1)),
  '22023', 'invalid_next_run', 'the next date cannot be in the past');
select throws_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'split_type', 'equal', 'splits', tests.people('ava', 'outsider'))),
  '23514', 'split_member_not_in_group', 'everyone in the split must be in the group');
select throws_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'payers', jsonb_build_array(pg_temp.payer('outsider', 160000)))),
  '23514', 'payer_not_in_group', 'payers must be in the group');
select throws_ok($$ select pg_temp.edit('rent', '{"is_refund": true}') $$,
  '22023', 'invalid_payload', 'a refund cannot repeat');
select throws_ok($$ select public.update_recurring_expense(gen_random_uuid(), '{}') $$,
  'PT404', 'recurring_not_found', 'an unknown template is not found');
select throws_ok($$ select pg_temp.edit('rent', '{"currency": "JPY"}') $$,
  '23514', 'fx_rate_unavailable', 'a currency without a rate is refused');

select lives_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'split_type', 'itemized',
  'payers', jsonb_build_array(pg_temp.payer('ava', 160000)),
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Big room', 'amount_cents', 100000, 'user_ids', jsonb_build_array(tests.uid('ava'))),
    jsonb_build_object('description', 'Small rooms', 'amount_cents', 60000,
      'user_ids', jsonb_build_array(tests.uid('ben'), tests.uid('cleo')))),
  'notes', 'Landlord: Sam')), 'a by-item bill, with notes');
select is(
  (jsonb_array_length((pg_temp.tpl('rent')).items),
   (select array_agg((s ->> 'share_cents')::bigint order by (s ->> 'share_cents')::bigint desc)
    from jsonb_array_elements((pg_temp.tpl('rent')).splits) s))::text,
  (2, array[100000, 30000, 30000]::bigint[])::text,
  'the template keeps the items and the shares worked out from them'
);
reset role;
select set_config('tests.itemized_day', (pg_temp.tpl('rent')).next_run_on::text, true);
select private.materialize_recurring_expenses((pg_temp.tpl('rent')).next_run_on);
select is(
  (select (count(i.*), max(e.split_type::text), max(e.notes))::text from public.expense_items i
   join public.expenses e on e.id = i.expense_id
   where e.recurring_id = tests.id('rent') and e.spent_at = current_setting('tests.itemized_day')::date),
  (2::bigint, 'itemized', 'Landlord: Sam')::text,
  'the posted copy carries the items and the notes'
);
select ok(
  exists (select 1 from public.activity a where a.verb = 'recurring.updated' and a.subject_id = tests.id('rent')
          and (a.data ->> 'amount_cents')::bigint = 160000 and (a.data ->> 'from_amount_cents')::bigint = 150000),
  'edits are logged for the group'
);

select tests.login('ava');
select lives_ok(format($$ select pg_temp.edit('rent', %L) $$, jsonb_build_object(
  'recurrence', 'biweekly', 'next_run_on', current_date + 3)), 'the schedule can change');
select is(
  ((pg_temp.tpl('rent')).recurrence, (pg_temp.tpl('rent')).next_run_on, (pg_temp.tpl('rent')).anchor_day)::text,
  ('biweekly'::public.recurrence, current_date + 3, extract(day from current_date + 3)::smallint)::text,
  'and the template repeats from the new date'
);

-- A series on the 31st keeps its day when only the interval changes.
select tests.remember('storage', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Storage unit', 'amount_cents', 2000, 'recurrence', 'monthly',
  'spent_at', '2026-01-31', 'splits', tests.people('ava')))));
select lives_ok($$ select pg_temp.edit('storage', '{"recurrence": "yearly"}') $$, 'only the interval changes');
select is(((pg_temp.tpl('storage')).next_run_on, (pg_temp.tpl('storage')).anchor_day)::text,
  ('2026-02-28'::date, 31::smallint)::text, 'the 31st stays the day it repeats on');

-- "Today" is the caller's own day.
reset role;
update public.profiles set timezone = 'Pacific/Kiritimati' where id = tests.uid('ava');
select is(private.local_today(tests.uid('ava')), (now() at time zone 'Pacific/Kiritimati')::date,
  'local_today follows profiles.timezone');
select tests.login('ava');
select lives_ok(format($$ select pg_temp.edit('rent', %L) $$,
  jsonb_build_object('next_run_on', (now() at time zone 'Pacific/Kiritimati')::date)),
  'the next date can be the caller''s own today');
select throws_ok(format($$ select pg_temp.edit('rent', %L) $$,
  jsonb_build_object('next_run_on', (now() at time zone 'Pacific/Kiritimati')::date - 1)),
  '22023', 'invalid_next_run', 'but not their yesterday');
reset role;
update public.profiles set timezone = 'UTC' where id = tests.uid('ava');
select tests.login('ava');

-- Someone left ----------------------------------------------------------------------------------

select tests.remember('internet', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('h'), 'description', 'Internet', 'amount_cents', 4000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben')))));
select tests.remember('water_h', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('h'), 'description', 'Water', 'amount_cents', 2000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben')))));
select tests.remember('pizza', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('h'), 'description', 'Pizza', 'amount_cents', 3000, 'splits', tests.people('ava', 'ben')))));
reset role;
delete from public.group_members where group_id = tests.id('h') and user_id = tests.uid('ben');
update public.recurring_expenses set active = false where id = tests.id('internet');
select set_config('request.jwt.claims', '', true);
select private.materialize_recurring_expenses((pg_temp.tpl('water_h')).next_run_on);
select is((pg_temp.tpl('water_h')).active, false, 'the job pauses a template naming someone who left');
select ok(
  exists (select 1 from public.activity a where a.verb = 'recurring.paused' and a.subject_id = tests.id('water_h')
          and a.actor_id is null and a.data -> 'user_ids' ? tests.uid('ben')::text),
  'says so in the group''s activity, naming who left'
);
select is(
  (select array_agg(n.user_id) from public.notifications n
   where n.type = 'recurring.paused' and n.data ->> 'recurring_id' = tests.id('water_h')::text),
  array[tests.uid('ava')],
  'and tells whoever set it up'
);

select tests.login('ava');
select lives_ok($$ select pg_temp.edit('internet', '{"description": "Fibre"}') $$,
  'details of a template naming someone who left stay editable');
select throws_ok($$ select pg_temp.edit('internet', '{"amount_cents": 5000}') $$,
  '23514', 'split_member_not_in_group', 'its money does not');
select throws_ok($$ update public.recurring_expenses set active = true where id = tests.id('internet') $$,
  '23514', 'split_member_not_in_group', 'it cannot resume while it names them');
select lives_ok(format($$ select pg_temp.edit('internet', %L) $$, jsonb_build_object(
  'amount_cents', 5000, 'splits', tests.people('ava'))), 'taking them out of the split is allowed');
select lives_ok($$ update public.recurring_expenses set active = true where id = tests.id('internet') $$,
  'and then it can resume');
select throws_ok($$ select public.make_expense_recurring(tests.id('pizza'), 'monthly') $$,
  '23514', 'split_member_not_in_group', 'an expense naming someone who left cannot start repeating');

-- Archived groups -------------------------------------------------------------------------------

select tests.remember('arch_t', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('arch'), 'description', 'Storage', 'amount_cents', 1000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben')))));
select tests.remember('arch_e', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('arch'), 'description', 'Boxes', 'amount_cents', 1000, 'splits', tests.people('ava', 'ben')))));
reset role;
update public.groups set archived_at = now() where id = tests.id('arch');
select tests.login('ava');
select throws_ok($$ select pg_temp.edit('arch_t', '{"description": "Attic"}') $$,
  '23514', 'group_archived', 'templates in an archived group cannot be edited');
select throws_ok($$ select public.skip_recurring_expense(tests.id('arch_t')) $$,
  '23514', 'group_archived', 'or skipped');
select throws_ok($$ select public.make_expense_recurring(tests.id('arch_e'), 'monthly') $$,
  '23514', 'group_archived', 'and nothing there starts repeating');

-- Skipping one ----------------------------------------------------------------------------------

select tests.remember('weekly', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Window cleaner', 'amount_cents', 3000, 'recurrence', 'weekly',
  'splits', tests.people('ava', 'ben')))));
select tests.login('eve');
select throws_ok($$ select public.skip_recurring_expense(tests.id('weekly')) $$,
  '42501', 'not_allowed', 'a member who is not in it cannot skip it');
select tests.login('ava');
select is((select next_run_on from public.skip_recurring_expense(tests.id('weekly'))), current_date + 14,
  'skipping moves the next one a period on');
select ok(
  exists (select 1 from public.activity a where a.verb = 'recurring.skipped' and a.subject_id = tests.id('weekly')
          and (a.data ->> 'skipped_on')::date = current_date + 7),
  'the skip is logged with the date that will not post'
);
select tests.remember('phone', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Phone', 'amount_cents', 2000, 'recurrence', 'monthly',
  'spent_at', '2026-01-31', 'splits', tests.people('ava')))));
update public.recurring_expenses set active = false where id = tests.id('phone');
select is((select next_run_on from public.skip_recurring_expense(tests.id('phone'))), '2026-03-31'::date,
  'a skip from Feb 28 goes back to the 31st');

-- Making an expense repeat ----------------------------------------------------------------------

select tests.remember('gym', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Gym', 'amount_cents', 5000, 'spent_at', current_date - 10,
  'splits', tests.people('ava', 'ben')))));
select tests.login('ben');
select throws_ok($$ select public.make_expense_recurring(tests.id('gym'), 'monthly') $$,
  '42501', 'not_allowed', 'only someone who may edit the expense can make it repeat');
select tests.login('ava');
select tests.remember('gym_t', (select id from public.make_expense_recurring(tests.id('gym'), 'monthly')));
select is(
  ((pg_temp.tpl('gym_t')).next_run_on, (pg_temp.tpl('gym_t')).amount_cents, (pg_temp.tpl('gym_t')).created_by)::text,
  (((current_date - 10) + interval '1 month')::date, 5000::bigint, tests.uid('ava'))::text,
  'a recent expense repeats one month after its date'
);
select is((select recurring_id from public.expenses where id = tests.id('gym')), tests.id('gym_t'),
  'the expense now belongs to the series');
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('gym') and verb = 'expense.updated'),
  0, 'joining the series is not logged as an edit of the expense'
);
select ok(
  exists (select 1 from public.activity a where a.verb = 'recurring.created' and a.subject_id = tests.id('gym_t')
          and a.data ->> 'expense_id' = tests.id('gym')::text),
  'starting to repeat is logged'
);
select throws_ok($$ select public.make_expense_recurring(tests.id('gym'), 'weekly') $$,
  '23514', 'already_recurring', 'an expense that repeats cannot start repeating again');

select tests.remember('old', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Old bill', 'amount_cents', 5000, 'spent_at', current_date - 100,
  'splits', tests.people('ava', 'ben')))));
select ok(
  (select next_run_on >= current_date and next_run_on < current_date + 32
   from public.make_expense_recurring(tests.id('old'), 'monthly')),
  'an old expense picks up at the next date still to come'
);

select tests.remember('refund', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Deposit back', 'amount_cents', 5000, 'is_refund', true,
  'splits', tests.people('ava', 'ben')))));
select throws_ok($$ select public.make_expense_recurring(tests.id('refund'), 'monthly') $$,
  '22023', 'invalid_payload', 'a refund cannot repeat');
select tests.remember('gone', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Gone', 'amount_cents', 5000, 'splits', tests.people('ava', 'ben')))));
reset role;
update public.expenses set deleted_at = now() where id = tests.id('gone');
select tests.login('ava');
select throws_ok($$ select public.make_expense_recurring(tests.id('gone'), 'monthly') $$,
  '23514', 'expense_deleted', 'a deleted expense cannot repeat');
select throws_ok($$ select public.make_expense_recurring(gen_random_uuid(), 'monthly') $$,
  'PT404', 'expense_not_found', 'an unknown expense is not found');

select tests.remember('dinner', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 9000, 'split_type', 'itemized',
  'payers', jsonb_build_array(pg_temp.payer('ava', 6000), pg_temp.payer('ben', 3000)),
  'tip_cents', 1000,
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Pasta', 'amount_cents', 5000, 'user_ids', jsonb_build_array(tests.uid('ava'))),
    jsonb_build_object('description', 'Salad', 'amount_cents', 3000, 'user_ids', jsonb_build_array(tests.uid('ben'))))))));
select tests.remember('dinner_t', (select id from public.make_expense_recurring(tests.id('dinner'), 'biweekly')));
select is(
  ((pg_temp.tpl('dinner_t')).split_type, jsonb_array_length((pg_temp.tpl('dinner_t')).items),
   jsonb_array_length((pg_temp.tpl('dinner_t')).payers), (pg_temp.tpl('dinner_t')).tip_cents)::text,
  ('itemized'::public.split_type, 2, 2, 1000::bigint)::text,
  'items, tip and several payers carry over'
);
select tests.remember('fuel', (select id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Fuel', 'amount_cents', 10000, 'split_type', 'percent',
  'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('ava'), 'weight', 60),
                              jsonb_build_object('user_id', tests.uid('ben'), 'weight', 40))))));
select tests.remember('fuel_t', (select id from public.make_expense_recurring(tests.id('fuel'), 'yearly')));
select is(
  (select array_agg((s ->> 'weight')::numeric order by (s ->> 'weight')::numeric desc)
   from jsonb_array_elements((pg_temp.tpl('fuel_t')).splits) s),
  array[60, 40]::numeric[],
  'percentages carry over'
);

-- Heads-up before it posts --------------------------------------------------------------------
-- Posting date D = 2030-01-10 (posts 00:10 UTC). Each person hears at 09:00 on their own D - 1:
-- Ava in UTC+14 at 2030-01-08 19:00 UTC, Cleo in UTC at 2030-01-09 09:00, Ben in UTC-12 at
-- 2030-01-09 21:00 UTC.

select tests.remember('water', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Water', 'amount_cents', 9000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben', 'cleo')))));
select tests.remember('quiet', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Quiet', 'amount_cents', 9000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben')))));
select pg_temp.edit('quiet', '{"remind": false}');
select tests.remember('paused', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Paused', 'amount_cents', 9000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben')))));
select tests.remember('late', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Late', 'amount_cents', 6000, 'recurrence', 'monthly',
  'splits', tests.people('ava', 'ben', 'cleo')))));
select tests.login('dan');
select tests.remember('tea', (select recurring_id from create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Tea', 'amount_cents', 1000, 'recurrence', 'monthly',
  'splits', tests.people('dan')))));
reset role;
-- As the job: no signed-in user, so the archived group's guard does not apply.
select set_config('request.jwt.claims', '', true);
update public.profiles set timezone = 'Pacific/Kiritimati' where id = tests.uid('ava');
update public.profiles set timezone = 'Etc/GMT+12' where id = tests.uid('ben');
update public.profiles set timezone = 'UTC' where id = tests.uid('cleo');
update public.profiles set timezone = 'Asia/Kolkata' where id = tests.uid('dan');
update public.recurring_expenses set active = false where id = tests.id('paused');
update public.recurring_expenses set next_run_on = '2030-01-10'
where id in (tests.id('water'), tests.id('quiet'), tests.id('paused'), tests.id('arch_t'), tests.id('tea'));

create function pg_temp.heard(key text) returns text language sql as $$
  select coalesce(string_agg(u.email, ',' order by u.email), '')
  from public.notifications n join auth.users u on u.id = n.user_id
  where n.type = 'recurring.upcoming' and n.data ->> 'recurring_id' = tests.id(key)::text
$$;

select is(private.send_recurring_heads_ups('2030-01-08 18:59+00'), 0, 'nobody before 09:00 local anywhere');
select is(private.send_recurring_heads_ups('2030-01-08 19:00+00'), 1, 'UTC+14 hears first, at 09:00 their time');
select is(pg_temp.heard('water'), 'ava@test.local', 'that is Ava');
-- UTC+5:30: 09:00 there is 03:30 UTC, picked up by the :35 run.
select is(private.send_recurring_heads_ups('2030-01-09 03:05+00'), 0, 'a half-hour zone is not due at :05');
select is(private.send_recurring_heads_ups('2030-01-09 03:35+00'), 1, 'it hears at the :35 run, about 09:05 their time');
select is(pg_temp.heard('tea'), 'dan@test.local', 'that is Dan in India');
select is(private.send_recurring_heads_ups('2030-01-09 09:00+00'), 1, 'UTC hears at 09:00 UTC');
select is(private.send_recurring_heads_ups('2030-01-09 20:59+00'), 0, 'UTC-12 not yet');
select is(private.send_recurring_heads_ups('2030-01-09 21:00+00'), 1, 'UTC-12 hears at 09:00 their time');
select is(private.send_recurring_heads_ups('2030-01-09 23:00+00'), 0, 'a later run sends nothing new');
select is(pg_temp.heard('water'), 'ava@test.local,ben@test.local,cleo@test.local',
  'everyone in it heard once, the payer too');
select is(
  (select ((data ->> 'share_cents')::bigint, data ->> 'posts_on', (data ->> 'deadline')::timestamptz, data ->> 'timezone')::text
   from public.notifications
   where type = 'recurring.upcoming' and user_id = tests.uid('ben') and data ->> 'recurring_id' = tests.id('water')::text),
  (3000::bigint, '2030-01-10', '2030-01-10 00:10+00'::timestamptz, 'Etc/GMT+12')::text,
  'with their share, the posting date, the deadline and their zone'
);
select is(pg_temp.heard('quiet') || pg_temp.heard('paused') || pg_temp.heard('arch_t'), '',
  'nothing for templates with the heads-up off, paused ones or archived groups');

-- Moved to D after everyone's 09:00 passed: told on the next run, but only before it posts.
update public.recurring_expenses set next_run_on = '2030-01-10' where id = tests.id('late');
select is(private.send_recurring_heads_ups('2030-01-10 00:10+00'), 0, 'too late once it has posted');
select is(private.send_recurring_heads_ups('2030-01-10 00:05+00'), 3, 'late but before it posts: right away');
select is(pg_temp.heard('late'), 'ava@test.local,ben@test.local,cleo@test.local', 'once each');
select is(
  (select array_agg(u.email || ':' || array_to_string(n.channels, '+') order by u.email)
   from public.notifications n join auth.users u on u.id = n.user_id
   where n.type = 'recurring.upcoming' and n.data ->> 'recurring_id' = tests.id('late')::text),
  array['ava@test.local:push', 'ben@test.local:push', 'cleo@test.local:'],
  'one landing at 00:05 local stays in the inbox, no push; daytime ones push'
);
select is(
  (select data ->> 'quiet' from public.notifications
   where type = 'recurring.upcoming' and user_id = tests.uid('cleo') and data ->> 'recurring_id' = tests.id('late')::text),
  'true', 'it is marked quiet'
);
select is((select category from private.notification_types where type = 'recurring.upcoming'), 'reminders',
  'heads-ups follow the reminders setting');
select is((select schedule from cron.job where jobname = 'recurring-heads-up'), '5,35 * * * *', 'the job runs at :05 and :35');

-- Who can call what -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.update_recurring_expense(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.skip_recurring_expense(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.make_expense_recurring(uuid, public.recurrence)', 'execute'),
  'anon cannot call the new RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'private.send_recurring_heads_ups(timestamptz)', 'execute'),
  'people cannot run the heads-up job'
);
select * from finish();
rollback;
