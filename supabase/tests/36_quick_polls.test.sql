-- Quick polls (ADR 22): nobody reads or writes the tables directly; creating a poll and its
-- checks; names on and off; seats and the people cap; the creator token doubling as the creator's
-- answer token; the preview per status; closing, expiry and deleting; the hourly purge; and the
-- save and create rate limits (the same limits as packages/core quick-polls).
begin;
select plan(80);

select tests.create_user('alice');

-- Grid cell `days` from today at hh:mm UTC as a slot object, yes unless a level is given.
create function pg_temp.slot(days int, hhmm text, level text default 'yes') returns jsonb
language sql immutable as $$
  select jsonb_build_object('slot_start', ((current_date + days) + hhmm::time) at time zone 'UTC', 'level', level)
$$;
grant execute on function pg_temp.slot(int, text, text) to authenticated, anon;

-- A valid create payload: two days from tomorrow, 10:00 to 12:00 UTC, an hour long, 7 days.
create function pg_temp.payload(extra jsonb default '{}') returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'title', 'Board games', 'timezone', 'UTC',
    'window_start', current_date + 1, 'window_end', current_date + 2,
    'day_start_minute', 600, 'day_end_minute', 720, 'duration_minutes', 60, 'ttl', '7d'
  ) || extra
$$;
grant execute on function pg_temp.payload(jsonb) to authenticated, anon;

-- Polls by name (code and creator token) and answer tokens by who.
create temp table polls (name text primary key, code text, creator text);
grant all on polls to anon, authenticated;
create function pg_temp.code(name text) returns text language sql stable as $$
  select p.code from polls p where p.name = $1
$$;
create function pg_temp.creator(name text) returns text language sql stable as $$
  select p.creator from polls p where p.name = $1
$$;
create temp table tok (who text primary key, token text);
grant all on tok to anon, authenticated;
create function pg_temp.tok(who text) returns text language sql stable as $$
  select t.token from tok t where t.who = $1
$$;
grant execute on function pg_temp.code(text), pg_temp.creator(text), pg_temp.tok(text) to authenticated, anon;

-- Nobody touches the tables -----------------------------------------------------------------------

select tests.login_anon();
select throws_ok($$ select * from public.quick_polls $$, '42501', null, 'anon cannot read polls');
select throws_ok($$ select * from public.quick_poll_answers $$, '42501', null, 'anon cannot read answers');
select throws_ok($$ select * from public.quick_poll_slots $$, '42501', null, 'anon cannot read slots');
select throws_ok(
  $$ insert into public.quick_polls (timezone, window_start, window_end, day_start_minute, day_end_minute, duration_minutes, creator_token_hash, expires_at)
     values ('UTC', current_date, current_date, 600, 720, 60, '\x00', now() + interval '1 day') $$,
  '42501', null, 'anon cannot write polls'
);
select throws_ok($$ select private.purge_quick_polls() $$, '42501', null, 'anon cannot run the purge');

select tests.login('alice');
select throws_ok($$ select * from public.quick_polls $$, '42501', null, 'signed in users cannot read polls');
select throws_ok($$ select * from public.quick_poll_answers $$, '42501', null, 'signed in users cannot read answers');
select throws_ok($$ select * from public.quick_poll_slots $$, '42501', null, 'signed in users cannot read slots');
select throws_ok(
  $$ delete from public.quick_poll_answers $$,
  '42501', null, 'signed in users cannot write answers'
);
select lives_ok(
  $$ insert into polls select 'alice', q.code, q.creator_token from public.create_quick_poll(pg_temp.payload()) q $$,
  'signed in users can make a poll too'
);

-- Creating a poll ---------------------------------------------------------------------------------

select tests.login_anon();
select throws_ok($$ select public.create_quick_poll('[]') $$, '22023', 'invalid_quick_poll', 'the payload is an object');
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"max_people": "lots"}')) $$,
  '22023', 'invalid_quick_poll', 'numbers are numbers'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"ttl": "30d"}')) $$,
  '22023', 'invalid_quick_poll_ttl', 'polls last 24h or 7d, not 30d'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload() - 'ttl') $$,
  '22023', 'invalid_quick_poll_ttl', 'a poll needs a ttl'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"max_people": 16}')) $$,
  '22023', 'invalid_quick_poll_people', 'a poll takes at most 15 people'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"max_people": 1}')) $$,
  '22023', 'invalid_quick_poll_people', 'a poll takes at least 2 people'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload(jsonb_build_object('window_end', current_date + 15))) $$,
  '22023', 'invalid_quick_poll_window', 'a window covers at most 14 days'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload(jsonb_build_object('window_end', current_date))) $$,
  '22023', 'invalid_quick_poll_window', 'a window ends on or after its start'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload(jsonb_build_object('window_start', current_date - 3, 'window_end', current_date - 1))) $$,
  '22023', 'invalid_quick_poll_window', 'a window is not all in the past'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload(jsonb_build_object('title', repeat('a', 81)))) $$,
  '22023', 'invalid_quick_poll_title', 'titles are up to 80 characters'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"timezone": "Mars/Olympus"}')) $$,
  '22023', 'invalid_quick_poll_timezone', 'the time zone must exist'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"slot_minutes": 15}')) $$,
  '22023', 'invalid_quick_poll_slot_minutes', 'slots are 30 or 60 minutes'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"day_end_minute": 620}')) $$,
  '22023', 'invalid_quick_poll_hours', 'the day holds at least one slot'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload('{"duration_minutes": 10}')) $$,
  '22023', 'invalid_quick_poll_duration', 'plans last at least 15 minutes'
);

select lives_ok(
  $$ insert into polls select 'big', q.code, q.creator_token
     from public.create_quick_poll(pg_temp.payload(jsonb_build_object('max_people', 15, 'window_start', current_date, 'window_end', current_date + 13, 'title', '  Board' || chr(8203) || '   night  '))) q $$,
  '15 people and a 14 day window are fine'
);
select lives_ok(
  $$ insert into polls select 'plain', q.code, q.creator_token
     from public.create_quick_poll(pg_temp.payload('{"title": "   ", "ttl": "24h"}') - 'slot_minutes' - 'max_people' - 'names_required') q $$,
  'a blank title is no title'
);
reset role;
select results_eq(
  $$ select title, max_people, window_end - window_start from public.quick_polls where code = pg_temp.code('big') $$,
  $$ values ('Board night'::text, 15, 13) $$,
  'the title is cleaned like a guest name, 15 people and 14 days are kept'
);
select results_eq(
  $$ select title, max_people, slot_minutes, names_required, expires_at, closed_at
     from public.quick_polls where code = pg_temp.code('plain') $$,
  $$ values (null::text, 10, 30, true, now() + interval '24 hours', null::timestamptz) $$,
  'defaults: no title, 10 people, 30 minute slots, names asked; 24h lasts 24 hours'
);
select is(
  (select expires_at from public.quick_polls where code = pg_temp.code('big')),
  now() + interval '7 days',
  'a 7d poll lasts 7 days'
);
select ok(char_length(pg_temp.code('big')) >= 16, 'codes are long enough not to guess');
select is(
  (select creator_token_hash from public.quick_polls where code = pg_temp.code('big')),
  sha256(convert_to(pg_temp.creator('big'), 'UTF8')),
  'only the hash of the creator token is kept'
);

-- Names on: seats, the cap, the creator token --------------------------------------------------

select tests.login_anon();
insert into polls select 'names', q.code, q.creator_token
from public.create_quick_poll(pg_temp.payload('{"max_people": 3}')) q;

select results_eq(
  $$ select status, title, timezone, window_start, window_end, day_start_minute, day_end_minute, slot_minutes,
            duration_minutes, names_required, max_people, is_creator, answers
     from public.quick_poll_preview(pg_temp.code('names')) $$,
  $$ values ('open', 'Board games', 'UTC', current_date + 1, current_date + 2, 600, 720, 30, 60, true, 3, false, '[]'::jsonb) $$,
  'an open poll shows its grid and no answers yet'
);
select is(
  (select is_creator from public.quick_poll_preview(pg_temp.code('names'), pg_temp.creator('names'))),
  true,
  'the creator token marks the creator'
);
select throws_ok(
  $$ select * from public.quick_poll_preview('not-a-real-code') $$,
  'PT404', 'quick_poll_not_found', 'unknown codes are not found'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, '  ', null, %L) $$,
    pg_temp.code('names'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '22023', 'invalid_quick_poll_name', 'a poll with names needs a name'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Ana', null, '[]') $$, pg_temp.code('names')),
  '22023', 'quick_poll_slots_required', 'a new answer picks at least one time'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Ana', null, %L) $$,
    pg_temp.code('names'), jsonb_build_array(pg_temp.slot(1, '12:00'))),
  '22023', 'invalid_slot', 'times outside the grid are refused'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Ana', null, '{"no": 1}') $$, pg_temp.code('names')),
  '22023', 'invalid_slots', 'slots are a list'
);

insert into tok select 'ana', s.answer_token
from public.set_quick_poll_availability(pg_temp.code('names'), 'Ana', null,
  jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:30', 'maybe'))) s;
insert into tok select 'cy', s.answer_token
from public.set_quick_poll_availability(pg_temp.code('names'), 'Cy', pg_temp.creator('names'),
  jsonb_build_array(pg_temp.slot(2, '11:00'))) s;
insert into tok select 'ben', s.answer_token
from public.set_quick_poll_availability(pg_temp.code('names'), 'Ben', 'not-a-token-this-poll-knows',
  jsonb_build_array(pg_temp.slot(2, '11:30'))) s;

select is(pg_temp.tok('cy'), pg_temp.creator('names'), 'the creator answers under their creator token');
select isnt(pg_temp.tok('ben'), 'not-a-token-this-poll-knows', 'an unknown token gets a fresh one');
select ok(char_length(pg_temp.tok('ana')) >= 16, 'a new answer gets a long token');

reset role;
select results_eq(
  $$ select a.seat, a.display_name, a.token_hash = p.creator_token_hash
     from public.quick_poll_answers a join public.quick_polls p on p.id = a.poll_id
     where p.code = pg_temp.code('names') order by a.seat $$,
  $$ values (1, 'Ana'::text, false), (2, 'Cy', true), (3, 'Ben', false) $$,
  'seats go 1, 2, 3 in order; the creator''s answer keeps the creator token hash'
);

select tests.login_anon();
select is(
  (select status from public.quick_poll_preview(pg_temp.code('names'))),
  'full',
  'three of three seats taken: full for someone new'
);
select is(
  (select jsonb_array_length(answers) from public.quick_poll_preview(pg_temp.code('names'))),
  3,
  'a full poll still shows its answers'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Dee', null, %L) $$,
    pg_temp.code('names'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'quick_poll_full', 'a full poll takes no new answers'
);
select is(
  (select s.saved from public.set_quick_poll_availability(pg_temp.code('names'), 'Ana B', pg_temp.tok('ana'),
    jsonb_build_array(pg_temp.slot(1, '10:00'))) s),
  1,
  'someone already in can edit a full poll'
);
select results_eq(
  $$ select status, answers -> 0 from public.quick_poll_preview(pg_temp.code('names'), pg_temp.tok('ana')) $$,
  $$ values ('open', jsonb_build_object('seat', 1, 'name', 'Ana B', 'mine', true, 'slots', jsonb_build_array(pg_temp.slot(1, '10:00')))) $$,
  'their own answer is marked mine, with their new name and times'
);
select results_eq(
  $$ select answers -> 1, answers -> 2 -> 'mine' from public.quick_poll_preview(pg_temp.code('names'), pg_temp.tok('ana')) $$,
  $$ values (jsonb_build_object('seat', 2, 'name', 'Cy', 'mine', false, 'slots', jsonb_build_array(pg_temp.slot(2, '11:00'))), 'false'::jsonb) $$,
  'other answers are not mine'
);
select is(
  (select array(select jsonb_object_keys(answers -> 0) order by 1) from public.quick_poll_preview(pg_temp.code('names'))),
  array['mine', 'name', 'seat', 'slots'],
  'answers carry no ids or hashes'
);

-- Names off ---------------------------------------------------------------------------------------

insert into polls select 'nameless', q.code, q.creator_token
from public.create_quick_poll(pg_temp.payload('{"names_required": false, "max_people": 2, "slot_minutes": 60}')) q;
select lives_ok(
  format($$ insert into tok select 'n1', s.answer_token from public.set_quick_poll_availability(%L, null, null, %L) s $$,
    pg_temp.code('nameless'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  'a poll without names takes an answer with no name'
);
select lives_ok(
  format($$ insert into tok select 'n2', s.answer_token from public.set_quick_poll_availability(%L, 'Ignored', null, %L) s $$,
    pg_temp.code('nameless'), jsonb_build_array(pg_temp.slot(1, '11:00'))),
  'and ignores a name it is given'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, null, %L, %L) $$,
    pg_temp.code('nameless'), pg_temp.tok('n1'), jsonb_build_array(pg_temp.slot(1, '10:30'))),
  '22023', 'invalid_slot', 'an hour grid refuses half hours'
);
select results_eq(
  $$ select a ->> 'seat', a -> 'name' from public.quick_poll_preview(pg_temp.code('nameless')) p,
       jsonb_array_elements(p.answers) a $$,
  $$ values ('1', 'null'::jsonb), ('2', 'null'::jsonb) $$,
  'answers are seats 1 and 2 with null names'
);
reset role;
select is(
  (select count(*)::int from public.quick_poll_answers a join public.quick_polls p on p.id = a.poll_id
   where p.code = pg_temp.code('nameless') and a.display_name is null),
  2,
  'no name is stored'
);

-- Closing and expiry ------------------------------------------------------------------------------

select tests.login_anon();
select throws_ok(
  format($$ select public.close_quick_poll(%L, %L) $$, pg_temp.code('names'), pg_temp.tok('ana')),
  '42501', 'not_allowed', 'only the creator can close a poll'
);
select throws_ok(
  format($$ select public.close_quick_poll(%L, null) $$, pg_temp.code('names')),
  '42501', 'not_allowed', 'closing needs a token'
);
select throws_ok(
  format($$ select public.close_quick_poll('not-a-real-code', %L) $$, pg_temp.creator('names')),
  'PT404', 'quick_poll_not_found', 'closing an unknown poll is not found'
);
select lives_ok(
  format($$ select public.close_quick_poll(%L, %L) $$, pg_temp.code('names'), pg_temp.creator('names')),
  'the creator closes the poll'
);
select lives_ok(
  format($$ select public.close_quick_poll(%L, %L) $$, pg_temp.code('names'), pg_temp.creator('names')),
  'closing again changes nothing'
);
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Ana', %L, %L) $$,
    pg_temp.code('names'), pg_temp.tok('ana'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'quick_poll_closed', 'a closed poll takes no edits'
);
select results_eq(
  $$ select status, jsonb_array_length(answers), is_creator
     from public.quick_poll_preview(pg_temp.code('names'), pg_temp.creator('names')) $$,
  $$ values ('closed', 3, true) $$,
  'a closed poll still shows its results'
);

reset role;
update public.quick_polls set expires_at = now() - interval '1 second'
where code in (pg_temp.code('names'), pg_temp.code('nameless'));
select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, null, %L, %L) $$,
    pg_temp.code('nameless'), pg_temp.tok('n1'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'quick_poll_expired', 'an expired poll takes no edits'
);
select results_eq(
  $$ select * from public.quick_poll_preview(pg_temp.code('nameless'), pg_temp.creator('nameless')) $$,
  $$ values ('expired', null::text, null::text, null::date, null::date, null::int, null::int, null::int,
             null::int, null::boolean, null::int, null::timestamptz, null::boolean, null::jsonb) $$,
  'an expired poll shows its status only'
);
select is(
  (select status from public.quick_poll_preview(pg_temp.code('names'))),
  'expired',
  'expired wins over closed'
);

-- Deleting ----------------------------------------------------------------------------------------

insert into polls select 'gone', q.code, q.creator_token from public.create_quick_poll(pg_temp.payload()) q;
insert into tok select 'g1', s.answer_token
from public.set_quick_poll_availability(pg_temp.code('gone'), 'Gil', null, jsonb_build_array(pg_temp.slot(1, '10:00'))) s;
reset role;
select tests.remember('gone', (select id from public.quick_polls where code = pg_temp.code('gone')));
select tests.login_anon();
select throws_ok(
  format($$ select public.delete_quick_poll(%L, %L) $$, pg_temp.code('gone'), pg_temp.tok('g1')),
  '42501', 'not_allowed', 'only the creator can delete a poll'
);
select lives_ok(
  format($$ select public.delete_quick_poll(%L, %L) $$, pg_temp.code('gone'), pg_temp.creator('gone')),
  'the creator deletes the poll'
);
select throws_ok(
  format($$ select * from public.quick_poll_preview(%L) $$, pg_temp.code('gone')),
  'PT404', 'quick_poll_not_found', 'a deleted poll is not found'
);
reset role;
select is(
  (select count(*)::int from public.quick_poll_answers a where a.poll_id = tests.id('gone')),
  0,
  'its answers went with it'
);

-- Purge -------------------------------------------------------------------------------------------

insert into private.quick_poll_creates (created_at) values (now() - interval '2 hours');
select tests.remember('names', (select id from public.quick_polls where code = pg_temp.code('names')));
select is(private.purge_quick_polls(), 2, 'the purge deletes the two expired polls');
select results_eq(
  $$ select count(*)::int from public.quick_polls where code in (pg_temp.code('names'), pg_temp.code('nameless')) $$,
  $$ values (0) $$,
  'expired polls are gone'
);
select is(
  (select count(*)::int from public.quick_poll_slots s
   where not exists (select 1 from public.quick_poll_answers a where a.id = s.answer_id))
  + (select count(*)::int from public.quick_poll_answers a where a.poll_id = tests.id('names')),
  0,
  'their answers and slots are gone'
);
select is(
  (select count(*)::int from public.quick_polls where code in (pg_temp.code('big'), pg_temp.code('plain'))),
  2,
  'live polls stay'
);
select is(
  (select count(*)::int from private.quick_poll_creates where created_at <= now() - interval '1 hour'),
  0,
  'create log rows past the hour go too'
);

-- Save rate limit ---------------------------------------------------------------------------------

select tests.login_anon();
insert into tok select 'r1', s.answer_token
from public.set_quick_poll_availability(pg_temp.code('big'), 'Rae', null, jsonb_build_array(pg_temp.slot(1, '10:00'))) s;
reset role;
update public.quick_poll_answers set saves = 60 where token_hash = sha256(convert_to(pg_temp.tok('r1'), 'UTF8'));
select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Rae', %L, %L) $$,
    pg_temp.code('big'), pg_temp.tok('r1'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'quick_poll_rate_limited', '60 saves an hour per answer'
);
reset role;
update public.quick_poll_answers set saves_window_start = now() - interval '61 minutes'
where token_hash = sha256(convert_to(pg_temp.tok('r1'), 'UTF8'));
select tests.login_anon();
select lives_ok(
  format($$ select * from public.set_quick_poll_availability(%L, 'Rae', %L, %L) $$,
    pg_temp.code('big'), pg_temp.tok('r1'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  'a new hour, new saves'
);

-- Create rate limit -------------------------------------------------------------------------------

-- PostgREST hands the request headers over as request.headers.
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.7, 10.0.0.1"}', true);
insert into polls select 'rl' || g, q.code, q.creator_token
-- The payload names g so each row makes its own poll.
from generate_series(1, 5) g, lateral public.create_quick_poll(pg_temp.payload(jsonb_build_object('title', 'Poll ' || g))) q;
select lives_ok(
  format($$ select public.delete_quick_poll(%L, %L) $$, pg_temp.code('rl1'), pg_temp.creator('rl1')),
  'deleting one of them'
);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload()) $$,
  '23514', 'quick_poll_rate_limited', 'five polls an hour per client, deleted ones included'
);
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.8, 10.0.0.1"}', true);
select lives_ok($$ select public.create_quick_poll(pg_temp.payload()) $$, 'the client is the first x-forwarded-for entry');
reset role;
select is(
  (select count(*)::int from private.quick_poll_creates where creator_hash = sha256(convert_to('198.51.100.7', 'UTF8'))),
  5,
  'the log keeps the hash of the client address'
);
insert into private.quick_poll_creates (creator_hash) select null from generate_series(1, 200);
select tests.login_anon();
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.9"}', true);
select throws_ok(
  $$ select public.create_quick_poll(pg_temp.payload()) $$,
  '23514', 'quick_poll_rate_limited', 'no more than 200 polls an hour in all'
);

select * from finish();
rollback;
