-- private.monthly_summary and the monthly-summary job.
begin;
select plan(14);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dev');
select tests.create_user('fay');
select tests.remember('g', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Flat', 'USD'));
select tests.remember('h', tests.group_with('dev', array['fay'], '{}', 'Quiet', 'EUR'));

-- Ava pays 30.00 for all three; Cleo pays her 10.00 back. Ava +10, Ben -10, Cleo 0.
select tests.login('ava');
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Groceries',
  'amount_cents', 3000, 'splits', tests.people('ava', 'ben', 'cleo')));
select tests.login('cleo');
select settle_up(tests.id('g'), tests.uid('ava'), 1000);
-- An older expense that Ava and Ben cancel out, created last month.
select tests.login('ben');
select tests.remember('old', (select id from create_expense(jsonb_build_object('group_id', tests.id('g'),
  'description', 'Old', 'amount_cents', 1000, 'splits', tests.people('ava', 'ben')))));
select tests.login('ava');
select create_expense(jsonb_build_object('group_id', tests.id('g'), 'description', 'Old back',
  'amount_cents', 1000, 'splits', tests.people('ava', 'ben')));
reset role;
update public.expenses set created_at = date_trunc('month', now()) - interval '3 days'
where id = tests.id('old');

select set_config('tests.month', to_char(date_trunc('month', now()), 'YYYY-MM-DD'), true);

select results_eq(
  $$ select g ->> 'name', (g ->> 'net_cents')::bigint, (g ->> 'expenses')::int, (g ->> 'payments')::int, g ->> 'currency'
     from jsonb_array_elements(private.monthly_summary(tests.uid('ava'), current_setting('tests.month')::date) -> 'groups') g $$,
  $$ values ('Flat', 1000::bigint, 2, 1, 'USD') $$,
  'ava: her balance and what happened to her this month, in group currency'
);
select is(
  private.monthly_summary(tests.uid('ava'), current_setting('tests.month')::date) ->> 'month',
  current_setting('tests.month'),
  'the summary names its month'
);
select results_eq(
  $$ select (g ->> 'net_cents')::bigint, (g ->> 'expenses')::int, (g ->> 'payments')::int
     from jsonb_array_elements(private.monthly_summary(tests.uid('cleo'), current_setting('tests.month')::date) -> 'groups') g $$,
  $$ values (0::bigint, 1, 1) $$,
  'a settled group still shows when something happened in it'
);
select is(
  private.monthly_summary(tests.uid('dev'), current_setting('tests.month')::date) -> 'groups',
  '[]'::jsonb,
  'a quiet group with no balance is left out'
);
select results_eq(
  $$ select (g ->> 'expenses')::int
     from jsonb_array_elements(private.monthly_summary(tests.uid('ben'),
       (date_trunc('month', now()) - interval '1 month')::date) -> 'groups') g $$,
  $$ values (1) $$,
  'last month counts only what was created last month'
);

-- The job: one summary each for people with a non-zero balance. The seed's people have
-- balances too, so look only at this file's users.
create function pg_temp.summaries() returns table (handle text, channels text[]) language sql as $$
  select h, n.channels
  from unnest(array['ava', 'ben', 'cleo', 'dev', 'fay']) as h
  join public.notifications n on n.user_id = tests.uid(h) and n.type = 'summary.monthly'
  order by h
$$;

select ok(
  private.send_monthly_summaries(current_setting('tests.month')::date) >= 2,
  'the job reports how many it wrote'
);
select results_eq(
  $$ select handle from pg_temp.summaries() $$,
  $$ values ('ava'), ('ben') $$,
  'ava and ben get a summary; cleo (settled), dev and fay (nothing) do not'
);
select is(
  (select (data -> 'groups' -> 0 ->> 'net_cents')::bigint from public.notifications
   where type = 'summary.monthly' and user_id = tests.uid('ben')),
  -1000::bigint,
  'ben''s card says what he owes'
);
select is(private.send_monthly_summaries(current_setting('tests.month')::date), 0, 'a second run sends nothing new');
select results_eq(
  $$ select distinct channels from pg_temp.summaries() $$,
  $$ values ('{}'::text[]) $$,
  'with email off the summary is an inbox card only, never a push'
);

update public.app_config set value = 'true' where key = 'email_notifications';
delete from public.notifications where type = 'summary.monthly';
select tests.login('ben');
select set_notification_pref('monthly_summary', email => false);
reset role;
select ok(private.send_monthly_summaries(current_setting('tests.month')::date) >= 1, 'with email on, the job runs again');
select results_eq(
  $$ select handle, channels from pg_temp.summaries() $$,
  $$ values ('ava', '{email}'::text[]) $$,
  'it is emailed; turning the summary off stops the inbox card and the email'
);

-- Closed accounts get nothing.
delete from public.notifications where type = 'summary.monthly';
select tests.login('ben');
select set_notification_pref('monthly_summary', email => true);
reset role;
update public.profiles set deleted_at = now() where id = tests.uid('ben');
select private.send_monthly_summaries(current_setting('tests.month')::date);
select results_eq(
  $$ select handle from pg_temp.summaries() $$,
  $$ values ('ava') $$,
  'closed accounts are skipped'
);

select ok(
  not has_function_privilege('authenticated', 'private.send_monthly_summaries(date)', 'execute'),
  'clients cannot run the job'
);

select * from finish();
rollback;
