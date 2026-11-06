-- set_availability holds a transaction advisory lock per (event, viewer) around its replace.
begin;
select plan(7);

select tests.create_user('owner');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.remember('g', tests.group_with('owner', array['m1', 'm2'], '{}', 'Lock crew'));

-- Grid cell start, `days` from today at hh:mm UTC, as a set_availability slot object.
create function pg_temp.slot(days int, hhmm text) returns jsonb language sql immutable as $$
  select jsonb_build_object('slot_start', ((current_date + days) + hhmm::time) at time zone 'UTC')
$$;
grant execute on function pg_temp.slot(int, text) to authenticated, anon;

-- The pg_locks row of the 64-bit key pg_advisory_xact_lock(key) takes: classid holds the high
-- half, objid the low half, objsubid is 1 (PostgreSQL docs, pg_locks).
create function pg_temp.lock_key(event uuid, viewer uuid) returns bigint language sql stable as $$
  select hashtextextended(event::text || ':' || viewer::text, 0)
$$;
create function pg_temp.holds_lock(event uuid, viewer uuid) returns bool language sql stable as $$
  select exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory'
      and l.pid = pg_backend_pid()
      and l.granted
      and l.objsubid = 1
      and l.classid = ((pg_temp.lock_key(event, viewer) >> 32) & 4294967295)::oid
      and l.objid = (pg_temp.lock_key(event, viewer) & 4294967295)::oid
  )
$$;
grant execute on function pg_temp.lock_key(uuid, uuid) to authenticated, anon;
grant execute on function pg_temp.holds_lock(uuid, uuid) to authenticated, anon;

select tests.login('m1');
insert into public.events (group_id, title, timezone, window_start, window_end, day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees)
values (tests.id('g'), 'Lock hike', 'UTC', current_date + 1, current_date + 2, 600, 720, 30, 60, 2);
select tests.remember('ev', (select id from public.events where title = 'Lock hike'));

select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  0,
  'no advisory lock is held before the call'
);

select is(
  set_availability(tests.id('ev'), jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:30'))),
  2,
  'the viewer''s slots are saved'
);
select ok(pg_temp.holds_lock(tests.id('ev'), tests.uid('m1')), 'the call took the lock for this event and viewer');
select ok(not pg_temp.holds_lock(tests.id('ev'), tests.uid('m2')), 'the lock is per viewer, not per event');

-- The lock is transaction scoped, so a second replace in the same transaction re-enters it.
select is(
  set_availability(tests.id('ev'), jsonb_build_array(pg_temp.slot(2, '10:00'))),
  1,
  'a second replace still works'
);
select results_eq(
  $$ select slot_start from public.availability where event_id = tests.id('ev') and user_id = tests.uid('m1') $$,
  $$ select ((current_date + 2) + '10:00'::time) at time zone 'UTC' $$,
  'the server ends on the last map'
);
select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  1,
  'the lock stays held until the transaction ends'
);

select * from finish();
rollback;
