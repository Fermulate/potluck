-- Cron job bodies: recurring expense materialization, event reminders,
-- finishing past events.
begin;
select plan(22);

-- Ignore any seeded rates; each test adds the ones it needs.
delete from public.fx_rates;

select tests.create_user('owner');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.create_user('m3');

select tests.remember('g', tests.group_with('owner', array['m1', 'm2', 'm3'], '{}', 'House', 'USD'));

-- Monthly template starting mid January.
select tests.login('m1');
select tests.remember('r', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Streaming', 'amount_cents', 1000, 'recurrence', 'monthly',
  'spent_at', '2026-01-15', 'split_type', 'shares',
  'splits', jsonb_build_array(
    jsonb_build_object('user_id', tests.uid('m1'), 'weight', 1),
    jsonb_build_object('user_id', tests.uid('m2'), 'weight', 2))))));
-- Weekly template far in the past.
select tests.remember('w', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Cleaner', 'amount_cents', 3000, 'recurrence', 'weekly',
  'spent_at', '2025-01-01', 'splits', tests.people('m1', 'm2')))));
-- EUR template with no stored rate.
select tests.remember('eur', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Parking', 'amount_cents', 500, 'currency', 'EUR', 'fx_rate', 1.1,
  'recurrence', 'monthly', 'spent_at', '2026-03-01', 'splits', tests.people('m1')))));
-- Template that will lose a member.
select tests.remember('gone', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Gym', 'amount_cents', 4000, 'recurrence', 'monthly',
  'spent_at', '2026-03-01', 'splits', tests.people('m1', 'm3')))));

-- m3 settles up and leaves the group
select tests.login('m3');
select settle_up(tests.id('g'), tests.uid('m1'), 2000);
select leave_group(tests.id('g'));
reset role;

select is(private.materialize_recurring_expenses('2026-04-20'), 15, 'creates every due expense (3 monthly + 12 weekly)');

select is(
  (select array_agg(spent_at order by spent_at) from public.expenses where recurring_id = tests.id('r')),
  array['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']::date[],
  'monthly template caught up through the run date'
);
select is(
  (select next_run_on from public.recurring_expenses where id = tests.id('r')),
  '2026-05-15'::date,
  'next run moved to the following period'
);
select is(
  (select array_agg(s.share_cents order by s.share_cents) from public.expense_splits s
   join public.expenses e on e.id = s.expense_id
   where e.recurring_id = tests.id('r') and e.spent_at = '2026-04-15'),
  array[333, 667]::bigint[],
  'splits are derived from the template weights'
);
select is(
  (select (created_by, paid_by, fx_rate)::text from public.expenses where recurring_id = tests.id('r') and spent_at = '2026-04-15'),
  (tests.uid('m1'), tests.uid('m1'), 1::numeric(18,8))::text,
  'creator, payer and rate come from the template'
);
select is(
  (select count(*)::int from public.expenses where recurring_id = tests.id('w')),
  13,
  'a long overdue weekly template catches up at most 12 periods per run'
);
select is(
  (select next_run_on from public.recurring_expenses where id = tests.id('w')),
  '2025-04-02'::date,
  'and continues next run'
);
select is(
  (select (active, next_run_on)::text from public.recurring_expenses where id = tests.id('eur')),
  (true, '2026-04-01'::date)::text,
  'a missing fx rate leaves the template due'
);
select is(
  (select active from public.recurring_expenses where id = tests.id('gone')),
  false,
  'a template with a departed member is deactivated'
);
select is(
  (select count(*)::int from public.expenses where recurring_id = tests.id('gone')),
  1,
  'and creates nothing'
);
select ok(
  exists (select 1 from public.activity where verb = 'expense.created' and actor_id = tests.uid('m1') and data ->> 'description' = 'Streaming'),
  'materialized expenses show in the feed as the template creator'
);
set constraints all immediate;
select ok(
  (select count(*) from public.notifications where type = 'expense.created' and user_id = tests.uid('m2') and data ->> 'description' = 'Streaming') >= 3,
  'split members are notified about materialized expenses'
);

insert into public.fx_rates (base, quote, day, rate) values ('EUR', 'USD', '2026-03-31', 1.2);
select is(private.materialize_recurring_expenses('2026-04-20'), 13, 'a rerun picks up the fx-blocked template and the next 12 weeks');
select is(
  (select fx_rate from public.expenses where recurring_id = tests.id('eur') and spent_at = '2026-04-01'),
  1.2::numeric(18,8),
  'rate looked up at materialization'
);

-- Reminders
select tests.login('m1');
insert into public.events (group_id, title) values (tests.id('g'), 'BBQ');
insert into public.events (group_id, title) values (tests.id('g'), 'Later');
insert into public.events (group_id, title) values (tests.id('g'), 'Yesterday');
select tests.remember('soon', (select id from public.events where title = 'BBQ'));
select tests.remember('later', (select id from public.events where title = 'Later'));
select tests.remember('past', (select id from public.events where title = 'Yesterday'));
select schedule_event(tests.id('soon'), now() + interval '3 hours');
select schedule_event(tests.id('later'), now() + interval '2 days');
select schedule_event(tests.id('past'), now() - interval '1 day');
reset role;
insert into public.event_rsvps (event_id, user_id, status) values
  (tests.id('soon'), tests.uid('m1'), 'going'),
  (tests.id('soon'), tests.uid('m2'), 'declined');
delete from public.notifications;

select is(private.send_event_reminders(), 1, 'only events starting within 24h are reminded');
select results_eq(
  $$ select user_id, type from public.notifications where data ->> 'event_id' = tests.id('soon')::text order by type, user_id $$,
  $$ values (tests.uid('m1'), 'event.reminder'), (tests.uid('owner'), 'rsvp.reminder') $$,
  'going people get a reminder, people who have not answered get an RSVP nudge, decliners get nothing'
);
select ok((select reminder_sent_at is not null from public.events where id = tests.id('soon')), 'reminder is recorded');
select is(private.send_event_reminders(), 0, 'reminders are sent once');
select is((select count(*)::int from public.notifications), 2, 'no duplicates');

select tests.login('m1');
select schedule_event(tests.id('soon'), now() + interval '4 hours');
reset role;
select is(private.send_event_reminders(), 1, 'rescheduling re-arms the reminder');

select is(private.finish_past_events(), 1, 'past scheduled events are finished');
select is((select status from public.events where id = tests.id('past')), 'done'::public.event_status, 'status is done');

select * from finish();
rollback;
