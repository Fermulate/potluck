-- Events RLS, set_availability, request_availability, best_slots,
-- schedule_event, cancel_event, RSVPs, my_timeline.
begin;
select plan(59);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.create_user('m3');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('owner', array['m1', 'm2', 'm3'], array['admin'], 'Hike crew'));

-- Grid cell start, `days` from today at hh:mm UTC.
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql immutable as $$
  select ((current_date + days) + hhmm::time) at time zone 'UTC'
$$;
grant execute on function pg_temp.at(int, text) to authenticated, anon;

-- Event RLS
select tests.login('outsider');
select throws_ok(
  $$ insert into public.events (group_id, title) values (tests.id('g'), 'Crash') $$,
  '42501', null, 'outsiders cannot create events in the group'
);

select tests.login('m1');
select throws_ok(
  $$ insert into public.events (group_id, title, status) values (tests.id('g'), 'Sneaky', 'scheduled') $$,
  '42501', null, 'events cannot be created already scheduled'
);
select lives_ok(
  $$ insert into public.events (group_id, title, timezone, window_start, window_end, day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees)
     values (tests.id('g'), 'Saturday hike', 'UTC', current_date + 1, current_date + 2, 600, 720, 30, 60, 2) $$,
  'members create polls'
);
select tests.remember('ev', (select id from public.events where title = 'Saturday hike'));
select throws_ok(
  $$ insert into public.events (group_id, title, timezone) values (tests.id('g'), 'Moon party', 'Mars/Base') $$,
  '23514', null, 'unknown time zones are rejected on insert'
);
select throws_ok(
  $$ update public.events set timezone = 'Mars/Base' where id = tests.id('ev') $$,
  '23514', null, 'and on update'
);
select is((select created_by from public.events where id = tests.id('ev')), tests.uid('m1'), 'creator recorded');

select tests.login('m2');
update public.events set title = 'Hijacked' where id = tests.id('ev');
delete from public.events where id = tests.id('ev');
select tests.login('outsider');
select is((select count(*)::int from public.events where id = tests.id('ev')), 0, 'outsiders cannot see the event');
reset role;
select is((select title from public.events where id = tests.id('ev')), 'Saturday hike', 'other members cannot edit or delete it');

select tests.login('admin');
update public.events set location = 'Trailhead' where id = tests.id('ev');
select tests.login('m1');
update public.events set description = 'Bring water' where id = tests.id('ev');
reset role;
select is(
  (select location || ' / ' || description from public.events where id = tests.id('ev')),
  'Trailhead / Bring water',
  'creator and admins edit details'
);
select tests.login('m1');
select throws_ok(
  $$ update public.events set status = 'scheduled' where id = tests.id('ev') $$,
  '42501', null, 'status only changes through RPCs'
);

-- request_availability
select is(request_availability(tests.id('ev')), 4, 'no list means everyone who has not answered');
select is(
  (select count(*)::int from public.availability_requests where event_id = tests.id('ev') and responded_at is null),
  4,
  'request rows created'
);
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'availability.requested' and data ->> 'event_id' = tests.id('ev')::text),
  4,
  'everyone asked is notified'
);
select tests.login('m1');
select throws_ok(
  $$ select request_availability(tests.id('ev'), array[tests.uid('outsider')]) $$,
  'P0002', 'member_not_found', 'cannot ask outsiders'
);
select is(request_availability(tests.id('ev'), array[tests.uid('m2'), tests.uid('m1')]), 1, 'explicit list, never yourself');
reset role;
update public.profiles set deleted_at = now() where id = tests.uid('m3');
select tests.login('m1');
select is(request_availability(tests.id('ev'), array[tests.uid('m2'), tests.uid('m3')]), 1, 'closed accounts are never asked');
reset role;
update public.profiles set deleted_at = null where id = tests.uid('m3');
select tests.login('m1');

-- set_availability
select is(
  set_availability(tests.id('ev'), jsonb_build_array(
    pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30'), pg_temp.at(1, '11:00'), pg_temp.at(1, '11:30'),
    pg_temp.at(2, '10:00'), pg_temp.at(2, '10:30'))),
  6,
  'bare timestamps are saved as yes'
);

select tests.login('m2');
select is(
  set_availability(tests.id('ev'), jsonb_build_array(
    jsonb_build_object('slot_start', pg_temp.at(1, '10:00'), 'level', 'yes'),
    jsonb_build_object('slot_start', pg_temp.at(1, '10:30'), 'level', 'yes'),
    jsonb_build_object('slot_start', pg_temp.at(1, '11:00'), 'level', 'maybe'),
    jsonb_build_object('slot_start', pg_temp.at(1, '11:30'), 'level', 'maybe'),
    jsonb_build_object('slot_start', pg_temp.at(2, '10:00')),
    jsonb_build_object('slot_start', pg_temp.at(2, '10:30')))),
  6,
  'objects with levels are saved'
);
select ok(
  (select responded_at is not null from public.availability_requests where event_id = tests.id('ev') and user_id = tests.uid('m2')),
  'answering marks the request responded'
);

select tests.login('m3');
select throws_ok(
  $$ select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '09:30'))) $$,
  '22023', 'invalid_slot', 'before day start'
);
select throws_ok(
  $$ select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '12:00'))) $$,
  '22023', 'invalid_slot', 'at day end'
);
select throws_ok(
  $$ select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '10:15'))) $$,
  '22023', 'invalid_slot', 'off the slot grid'
);
select throws_ok(
  $$ select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(5, '10:00'))) $$,
  '22023', 'invalid_slot', 'outside the date window'
);
select throws_ok(
  $$ select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '10:00'), pg_temp.at(1, '10:00'))) $$,
  '22023', 'duplicate_slot', 'duplicates rejected'
);
select throws_ok(
  $$ select set_availability(tests.id('ev'), '[{"slot_start": "not a date"}]') $$,
  '22023', 'invalid_slots', 'garbage rejected'
);
select is(set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '11:00'))), 1, 'first answer');
select is(
  set_availability(tests.id('ev'), jsonb_build_array(pg_temp.at(1, '10:30'), pg_temp.at(1, '11:00'), pg_temp.at(2, '10:00'), pg_temp.at(2, '10:30'))),
  4,
  'answering again replaces the previous answer'
);
select is((select count(*)::int from public.availability where event_id = tests.id('ev') and user_id = tests.uid('m3')), 4, 'only the latest answer is stored');

select tests.login('outsider');
select throws_ok(
  $$ select set_availability(tests.id('ev'), '[]') $$,
  '42501', 'not_a_member', 'outsiders cannot answer'
);
select is((select count(*)::int from public.availability where event_id = tests.id('ev')), 0, 'outsiders see no availability');
select throws_ok(
  $$ insert into public.availability (event_id, user_id, slot_start) values (tests.id('ev'), tests.uid('outsider'), now()) $$,
  '42501', null, 'no direct availability writes'
);

-- best_slots
-- day 1: m1 yes 10:00-12:00, m2 yes 10:00-11:00 + maybe 11:00-12:00, m3 yes 10:30-11:30
-- day 2: m1, m2, m3 yes 10:00-11:00. Duration 60 = 2 cells. owner and admin never answer.
select tests.login('owner');
select results_eq(
  $$ select starts_at, ends_at, yes_count, maybe_count, score, missing from best_slots(tests.id('ev'), 10) $$,
  $$ values
    (pg_temp.at(2, '10:00'), pg_temp.at(2, '11:00'), 3, 0, 3.0, (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('admin')]) u)),
    (pg_temp.at(1, '10:30'), pg_temp.at(1, '11:30'), 2, 1, 2.5, (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('admin')]) u)),
    (pg_temp.at(1, '10:00'), pg_temp.at(1, '11:00'), 2, 0, 2.0, (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('admin'), tests.uid('m3')]) u)),
    (pg_temp.at(1, '11:00'), pg_temp.at(1, '12:00'), 1, 1, 1.5, (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('admin'), tests.uid('m3')]) u))
  $$,
  'ranked by score, people must cover every cell of the duration, maybe counts half'
);
select is(
  (select count(*)::int from best_slots(tests.id('ev'))),
  4,
  'default limit is 5 (only 4 qualify)'
);
select is(
  (select array_agg(starts_at) from best_slots(tests.id('ev'), 2)),
  array[pg_temp.at(2, '10:00'), pg_temp.at(1, '10:30')],
  'limit is respected'
);

reset role;
update public.events set min_attendees = 3 where id = tests.id('ev');
select tests.login('owner');
select is(
  (select array_agg(starts_at order by starts_at) from best_slots(tests.id('ev'))),
  array[pg_temp.at(1, '10:30'), pg_temp.at(2, '10:00')],
  'min_attendees counts yes and maybe'
);

reset role;
update public.events set min_attendees = 2, duration_minutes = 90 where id = tests.id('ev');
select tests.login('owner');
select is(
  (select array_agg(starts_at order by starts_at) from best_slots(tests.id('ev'))),
  array[pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30')],
  'a 90 minute duration needs 3 cells and must end by day end'
);
reset role;
update public.events set duration_minutes = 60 where id = tests.id('ev');

-- Answers given on the 30 minute grid stay after the grid changes to 60
-- minutes. Only the exact cell start counts, like rankSlots: at day 1 10:00,
-- m1 and m2 said yes, m3 has nothing at 10:00.
update public.events set slot_minutes = 60 where id = tests.id('ev');
select tests.login('owner');
select is(
  (select (yes_count, maybe_count, missing)::text from best_slots(tests.id('ev'), 100) where starts_at = pg_temp.at(1, '10:00')),
  (2, 0, (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('admin'), tests.uid('m3')]) u))::text,
  'extra answers inside the duration do not change the count'
);
reset role;
update public.events set slot_minutes = 30 where id = tests.id('ev');

select tests.login('outsider');
select throws_ok($$ select * from best_slots(tests.id('ev')) $$, '42501', 'not_a_member', 'outsiders cannot rank slots');

-- schedule_event
select tests.login('m2');
select throws_ok(
  $$ select schedule_event(tests.id('ev'), pg_temp.at(2, '10:00')) $$,
  '42501', 'not_allowed', 'other members cannot lock the time'
);
select tests.login('m1');
select is(
  (select (status, starts_at, ends_at)::text from schedule_event(tests.id('ev'), pg_temp.at(2, '10:00'))),
  ('scheduled'::public.event_status, pg_temp.at(2, '10:00'), pg_temp.at(2, '11:00'))::text,
  'the creator locks the time; ends_at follows the duration'
);
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'event.scheduled' and data ->> 'event_id' = tests.id('ev')::text),
  4,
  'every other member is told'
);
select ok(
  exists (select 1 from public.activity where verb = 'event.scheduled' and subject_id = tests.id('ev')),
  'activity logged'
);
select tests.login('m1');
select throws_ok(
  $$ select set_availability(tests.id('ev'), '[]') $$,
  '23514', 'event_not_polling', 'no availability once scheduled'
);
select throws_ok(
  $$ select request_availability(tests.id('ev')) $$,
  '23514', 'event_not_polling', 'no requests once scheduled'
);

select tests.login('admin');
select lives_ok($$ select schedule_event(tests.id('ev'), pg_temp.at(1, '10:30')) $$, 'admins can reschedule');
reset role;
select is(
  (select count(*)::int from public.activity where verb = 'event.scheduled' and subject_id = tests.id('ev')),
  2,
  'reschedule logged as event.scheduled again'
);

-- RSVPs
select tests.login('m2');
select lives_ok(
  $$ insert into public.event_rsvps (event_id, status) values (tests.id('ev'), 'going') $$,
  'members RSVP for themselves'
);
select throws_ok(
  $$ insert into public.event_rsvps (event_id, user_id, status) values (tests.id('ev'), tests.uid('m3'), 'going') $$,
  '42501', null, 'not for others'
);
select tests.login('m3');
update public.event_rsvps set status = 'declined' where event_id = tests.id('ev') and user_id = tests.uid('m2');
select tests.login('outsider');
select throws_ok(
  $$ insert into public.event_rsvps (event_id, status) values (tests.id('ev'), 'going') $$,
  '42501', null, 'outsiders cannot RSVP'
);
reset role;
select is((select status from public.event_rsvps where event_id = tests.id('ev') and user_id = tests.uid('m2')), 'going'::public.rsvp_status, 'others cannot change my RSVP');

-- my_timeline
select tests.login('m1');
insert into public.events (group_id, title, window_start, window_end) values (tests.id('g'), 'Movie night', current_date + 3, current_date + 9);
select tests.remember('poll', (select id from public.events where title = 'Movie night'));
select request_availability(tests.id('poll'), array[tests.uid('m2')]);

select tests.login('m2');
select results_eq(
  $$ select event_id, status, my_rsvp, going_count, availability_requested, availability_submitted from my_timeline() $$,
  $$ values
    (tests.id('ev'), 'scheduled'::public.event_status, 'going'::public.rsvp_status, 1, false, true),
    (tests.id('poll'), 'polling'::public.event_status, null::public.rsvp_status, 0, true, false) $$,
  'timeline lists scheduled events and open polls with my state'
);
select is((select count(*)::int from my_timeline(now() + interval '20 days', now() + interval '30 days')), 0, 'the range filters events');
select tests.login('outsider');
select is((select count(*)::int from my_timeline()), 0, 'other people''s events never show');

-- cancel_event
select tests.login('m2');
select throws_ok($$ select cancel_event(tests.id('ev')) $$, '42501', 'not_allowed', 'other members cannot cancel');
select tests.login('owner');
select is((select status from cancel_event(tests.id('ev'))), 'cancelled'::public.event_status, 'owner cancels');
select is((select status from cancel_event(tests.id('ev'))), 'cancelled'::public.event_status, 'cancelling twice is harmless');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'event.cancelled' and data ->> 'event_id' = tests.id('ev')::text),
  4,
  'members are told about the cancellation'
);
select tests.login('m1');
select throws_ok(
  $$ select schedule_event(tests.id('ev'), pg_temp.at(1, '10:00')) $$,
  '23514', 'event_not_schedulable', 'cancelled events stay cancelled'
);
select throws_ok($$ select schedule_event(gen_random_uuid(), now()) $$, 'P0002', 'event_not_found', 'unknown event');

select * from finish();
rollback;
