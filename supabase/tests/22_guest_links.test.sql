-- Guest availability links: creating and revoking links, the anon preview and save RPCs, expiry,
-- revocation, the guest cap, rate limits, who can read what, removing a guest's answer, and
-- best_slots counting guests (the same case as the guest test in packages/core rank-slots).
begin;
select plan(80);

select tests.create_user('owner');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.create_user('stranger');
select tests.remember('g', tests.group_with('owner', array['m1', 'm2'], '{}', 'Guest crew'));

-- Grid cell `days` from today at hh:mm UTC as a slot object, yes unless a level is given.
create function pg_temp.slot(days int, hhmm text, level text default 'yes') returns jsonb
language sql immutable as $$
  select jsonb_build_object('slot_start', ((current_date + days) + hhmm::time) at time zone 'UTC', 'level', level)
$$;
grant execute on function pg_temp.slot(int, text, text) to authenticated, anon;

-- Tokens the RPC hands back, by guest.
create temp table tok (who text primary key, token text);
grant all on tok to anon, authenticated;
create function pg_temp.tok(who text) returns text language sql stable as $$
  select t.token from tok t where t.who = $1
$$;
grant execute on function pg_temp.tok(text) to authenticated, anon;

-- m1 organizes a two day poll, 10:00 to 12:00 UTC, 30 minute slots, one hour long.
select tests.login('m1');
insert into public.events (group_id, title, emoji, timezone, window_start, window_end, day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees)
values (tests.id('g'), 'Guest hike', '🥾', 'UTC', current_date + 1, current_date + 2, 600, 720, 30, 60, 2);
select tests.remember('ev', (select id from public.events where title = 'Guest hike'));
reset role;
update public.groups set emoji = '🏕️' where id = tests.id('g');

-- Creating links --------------------------------------------------------------------------------

select tests.login_anon();
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 5) $$, tests.id('ev')),
  '42501', null, 'anon cannot create a guest link'
);

select tests.login('stranger');
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 5) $$, tests.id('ev')),
  '42501', 'not_a_member', 'outsiders cannot create a guest link'
);

select tests.login('m2');
select throws_ok(
  format($$ select public.create_guest_link(%L, '1h', 5) $$, tests.id('ev')),
  '22023', 'invalid_guest_link_ttl', 'expiry must be 24h, 7d or 30d'
);
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 0) $$, tests.id('ev')),
  '22023', 'invalid_guest_limit', 'a link takes at least one guest'
);
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 101) $$, tests.id('ev')),
  '22023', 'invalid_guest_limit', 'a link takes at most 100 guests'
);

-- Any member can make one (m2 is not the organizer).
select tests.remember('l1', (select id from public.create_guest_link(tests.id('ev'), '7d', 2)));
select is(
  (select expires_at from public.event_guest_links where id = tests.id('l1')),
  now() + interval '7 days',
  'a 7d link expires in 7 days'
);
select is(
  (select expires_at from public.create_guest_link(tests.id('ev'), '24h', 5)),
  now() + interval '24 hours',
  'a 24h link expires in 24 hours'
);
select is(
  (select expires_at from public.create_guest_link(tests.id('ev'), '30d')),
  now() + interval '30 days',
  'a 30d link expires in 30 days'
);
select is(
  (select max_guests from public.event_guest_links where expires_at = now() + interval '30 days'),
  10,
  'the cap defaults to 10 guests'
);
select is(
  (select created_by from public.event_guest_links where id = tests.id('l1')),
  tests.uid('m2'),
  'the link records who made it'
);
reset role;
create temp table l1 as select code from public.event_guest_links where id = tests.id('l1');
grant select on l1 to anon, authenticated;
create function pg_temp.code() returns text language sql stable as $$ select code from l1 $$;
grant execute on function pg_temp.code() to authenticated, anon;

select ok(char_length(pg_temp.code()) >= 16, 'link codes are long enough not to guess');

-- Reading links --------------------------------------------------------------------------------

select tests.login('m1');
select is((select count(*)::int from public.event_guest_links), 3, 'members see the plan''s links');
select tests.login('stranger');
select is((select count(*)::int from public.event_guest_links), 0, 'outsiders see no links');
select tests.login_anon();
select throws_ok($$ select * from public.event_guest_links $$, '42501', null, 'anon cannot read links');
select throws_ok($$ select * from public.event_guests $$, '42501', null, 'anon cannot read guests');
select throws_ok($$ select * from public.event_guest_availability $$, '42501', null, 'anon cannot read guest slots');

-- The anon preview ------------------------------------------------------------------------------

select results_eq(
  $$ select status, title, emoji, group_emoji, host_name, timezone, max_guests, guest_count, respondents, my_name, my_slots, heat
     from public.guest_link_preview(pg_temp.code()) $$,
  $$ values ('open', 'Guest hike', '🥾', '🏕️', 'M2', 'UTC', 2, 0, 0, null::text, null::jsonb, '[]'::jsonb) $$,
  'anon sees the plan, the host''s first name and an empty heatmap'
);
select results_eq(
  $$ select window_start, window_end, day_start_minute, day_end_minute, slot_minutes, duration_minutes
     from public.guest_link_preview(pg_temp.code()) $$,
  $$ values (current_date + 1, current_date + 2, 600, 720, 30, 60) $$,
  'the preview carries the grid'
);
select throws_ok(
  $$ select * from public.guest_link_preview('not-a-real-code') $$,
  'PT404', 'guest_link_not_found', 'unknown codes are not found'
);

-- Guests answering ------------------------------------------------------------------------------

select throws_ok(
  format($$ select * from public.set_guest_availability(%L, '  ', null, %L) $$,
    pg_temp.code(), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '22023', 'invalid_guest_name', 'a guest needs a name'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, %L, null, %L) $$,
    pg_temp.code(), repeat('x', 41), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '22023', 'invalid_guest_name', 'names are capped at 40 characters'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, %L, null, %L) $$,
    pg_temp.code(), E'Ana\nBob', jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '22023', 'invalid_guest_name', 'names cannot hold control characters'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', null, '[]') $$, pg_temp.code()),
  '22023', 'guest_slots_required', 'a new guest has to pick a time'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', null, %L) $$,
    pg_temp.code(), jsonb_build_array(pg_temp.slot(1, '12:00'))),
  '22023', 'invalid_slot', 'times outside the grid are rejected'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', null, %L) $$,
    pg_temp.code(), jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:00'))),
  '22023', 'duplicate_slot', 'a time cannot appear twice'
);
select throws_ok(
  $$ select * from public.set_guest_availability('not-a-real-code', 'Ana', null, '[]') $$,
  'PT404', 'guest_link_not_found', 'saving to an unknown code is not found'
);

insert into tok
select 'ana', guest_token from public.set_guest_availability(
  pg_temp.code(), '  Ana  ', null, jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:30')));
select ok(char_length(pg_temp.tok('ana')) >= 32, 'a new guest gets a long random token back');

reset role;
select results_eq(
  $$ select display_name, token_hash = sha256(convert_to(pg_temp.tok('ana'), 'UTF8')), saves
     from public.event_guests where link_id = tests.id('l1') $$,
  $$ values ('Ana', true, 1) $$,
  'the guest row keeps the trimmed name and only a hash of the token'
);
select is(
  (select count(*)::int from public.event_guest_availability where event_id = tests.id('ev')),
  2,
  'the guest''s slots are stored'
);

select tests.login_anon();
select results_eq(
  $$ select my_name, jsonb_array_length(my_slots), guest_count, respondents
     from public.guest_link_preview(pg_temp.code(), pg_temp.tok('ana')) $$,
  $$ values ('Ana', 2, 1, 1) $$,
  'the guest''s token brings back their own answer'
);
select is(
  (select my_name from public.guest_link_preview(pg_temp.code(), 'someone-elses-token-0000000000')),
  null,
  'a token the link does not know shows no answer'
);

select is(
  (select saved from public.set_guest_availability(pg_temp.code(), 'Ana B', pg_temp.tok('ana'),
    jsonb_build_array(pg_temp.slot(1, '10:00')))),
  1,
  'the same token edits the answer'
);
reset role;
select results_eq(
  $$ select count(*)::int, min(display_name), min(saves) from public.event_guests where link_id = tests.id('l1') $$,
  $$ values (1, 'Ana B', 2) $$,
  'editing renames the same guest and counts the save'
);
select tests.login_anon();

insert into tok
select 'ben', guest_token from public.set_guest_availability(
  pg_temp.code(), 'Ben', null, jsonb_build_array(pg_temp.slot(1, '10:00', 'maybe'), pg_temp.slot(1, '10:30', 'maybe')));
select isnt(pg_temp.tok('ben'), pg_temp.tok('ana'), 'each guest gets their own token');

-- The cap ---------------------------------------------------------------------------------------

select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Cy', null, %L) $$,
    pg_temp.code(), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_link_full', 'a full link turns new guests away'
);
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Cy', 'made-up-token-000000000000', %L) $$,
    pg_temp.code(), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_link_full', 'an unknown token counts as a new guest'
);
select results_eq(
  $$ select status, title, heat, my_name from public.guest_link_preview(pg_temp.code()) $$,
  $$ values ('full', 'Guest hike', null::jsonb, null::text) $$,
  'a new visitor to a full link sees that it is full, without the heatmap'
);
select is(
  (select status from public.guest_link_preview(pg_temp.code(), pg_temp.tok('ana'))),
  'open',
  'a guest who already answered still sees the link open'
);
select is(
  (select saved from public.set_guest_availability(pg_temp.code(), 'Ana', pg_temp.tok('ana'),
    jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:30')))),
  2,
  'and can still edit their answer'
);

-- Members reading guests ------------------------------------------------------------------------

select tests.login('m1');
select set_eq(
  $$ select display_name from public.event_guests where event_id = tests.id('ev') $$,
  array['Ana', 'Ben'],
  'members see who answered as a guest'
);
select is(
  (select count(*)::int from public.event_guest_availability where event_id = tests.id('ev')),
  4,
  'members see guest slots for the heatmap'
);
select throws_ok(
  $$ select token_hash from public.event_guests $$,
  '42501', null, 'members cannot read token hashes'
);
select throws_ok(
  format($$ insert into public.event_guest_availability (guest_id, event_id, slot_start) values (%L, %L, now()) $$,
    (select id from public.event_guests where display_name = 'Ana'), tests.id('ev')),
  '42501', null, 'members cannot write guest slots directly'
);
select throws_ok(
  $$ update public.event_guest_links set revoked_at = null $$,
  '42501', null, 'members cannot update links directly'
);

select tests.login('stranger');
select is((select count(*)::int from public.event_guests), 0, 'outsiders see no guests');
select is((select count(*)::int from public.event_guest_availability), 0, 'outsiders see no guest slots');

-- best_slots with guests ------------------------------------------------------------------------

select tests.login('m1');
select set_availability(tests.id('ev'), jsonb_build_array(pg_temp.slot(1, '10:00'), pg_temp.slot(1, '10:30')));

-- m1 yes, Ana yes, Ben maybe for 10:00 to 11:00; nobody covers 10:30 to 11:30.
select results_eq(
  $$ select starts_at, yes_count, maybe_count, score, missing from public.best_slots(tests.id('ev')) $$,
  format($$ values (((current_date + 1) + '10:00'::time) at time zone 'UTC', 2, 1, 2.5::numeric, %L::uuid[]) $$,
    (select array_agg(u order by u) from unnest(array[tests.uid('owner'), tests.uid('m2')]) u)),
  'guests count in best_slots like members'
);
reset role;
update public.events set min_attendees = 3 where id = tests.id('ev');
select tests.login('m1');
select is(
  (select count(*)::int from public.best_slots(tests.id('ev'))),
  1,
  'guests count toward min_attendees'
);

-- The aggregated heatmap a guest sees, and what it leaves out.
select tests.login_anon();
select results_eq(
  $$ select respondents, heat from public.guest_link_preview(pg_temp.code(), pg_temp.tok('ana')) $$,
  format($$ values (3, %L::jsonb) $$, jsonb_build_array(
    jsonb_build_object('slot_start', ((current_date + 1) + '10:00'::time) at time zone 'UTC', 'yes', 2, 'maybe', 1),
    jsonb_build_object('slot_start', ((current_date + 1) + '10:30'::time) at time zone 'UTC', 'yes', 2, 'maybe', 1)
  )),
  'guests see counts per slot from members and guests'
);
reset role;
create temp table leak as
select to_jsonb(p)::text as body from public.guest_link_preview(pg_temp.code(), pg_temp.tok('ana')) p;
select ok(
  not exists (
    select 1 from leak, (select id from auth.users union select id from public.event_guests) x
    where leak.body like '%' || x.id::text || '%'
  ),
  'the preview carries no user or guest ids'
);
select ok(
  not exists (select 1 from leak where body ~* '(test\.local|Tester|Guest crew|Ben)'),
  'the preview carries no emails, full names, group name or other guests'' names'
);

-- Removing a guest's answer ---------------------------------------------------------------------

reset role;
create temp table ben as select id from public.event_guests where display_name = 'Ben';
grant select on ben to authenticated, anon;

select tests.login('m2');
select throws_ok(
  $$ select public.remove_guest_answer((select id from ben)) $$,
  '42501', 'not_allowed', 'members who did not organize the plan cannot remove guests'
);
select tests.login('stranger');
select throws_ok(
  $$ select public.remove_guest_answer((select id from ben)) $$,
  '42501', 'not_a_member', 'outsiders cannot remove guests'
);
select tests.login_anon();
select throws_ok(
  $$ select public.remove_guest_answer((select id from ben)) $$,
  '42501', null, 'anon cannot remove guests'
);
select tests.login('m1');
select lives_ok($$ select public.remove_guest_answer((select id from ben)) $$, 'the organizer removes a guest');
select is(
  (select count(*)::int from public.event_guest_availability ga join ben on ben.id = ga.guest_id),
  0,
  'their slots go with them'
);
select throws_ok(
  $$ select public.remove_guest_answer((select id from ben)) $$,
  'PT404', 'guest_not_found', 'removing twice is not found'
);
-- Removing Ben freed a seat: his old token is unknown now, so he comes back as a new guest.
select tests.login_anon();
insert into tok
select 'ben2', guest_token from public.set_guest_availability(
  pg_temp.code(), 'Ben', pg_temp.tok('ben'), jsonb_build_array(pg_temp.slot(1, '11:00')));
select isnt(pg_temp.tok('ben2'), pg_temp.tok('ben'), 'a removed guest who answers again gets a new token');

-- Rate limits -----------------------------------------------------------------------------------

reset role;
update public.event_guests set saves = 60 where display_name = 'Ana';
select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', %L, %L) $$,
    pg_temp.code(), pg_temp.tok('ana'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_rate_limited', 'a guest can save 60 times an hour'
);
reset role;
update public.event_guests set saves_window_start = now() - interval '61 minutes' where display_name = 'Ana';
select tests.login_anon();
select lives_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', %L, %L) $$,
    pg_temp.code(), pg_temp.tok('ana'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  'the limit resets after an hour'
);
reset role;
select is((select saves from public.event_guests where display_name = 'Ana'), 1, 'and the count starts again');

-- 20 new guests on one link in 10 minutes is the most it takes.
select tests.login('m1');
select tests.remember('busy', (select id from public.create_guest_link(tests.id('ev'), '7d', 100)));
reset role;
insert into public.event_guests (link_id, event_id, group_id, display_name, token_hash)
select tests.id('busy'), tests.id('ev'), tests.id('g'), 'Crowd ' || i, sha256(convert_to('crowd' || i, 'UTF8'))
from generate_series(1, 20) i;
create temp table busy as select code from public.event_guest_links where id = tests.id('busy');
grant select on busy to anon, authenticated;
select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_guest_availability((select code from busy), 'Dee', null, %L) $$,
    jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_rate_limited', 'a link takes at most 20 new guests per 10 minutes'
);

-- Revoking --------------------------------------------------------------------------------------

select tests.login('owner');
select tests.remember('l2', (select id from public.create_guest_link(tests.id('ev'), '7d', 5)));
select tests.login('m2');
select throws_ok(
  format($$ select public.revoke_guest_link(%L) $$, tests.id('l2')),
  '42501', 'not_allowed', 'members cannot revoke someone else''s link'
);
select tests.login('stranger');
select throws_ok(
  format($$ select public.revoke_guest_link(%L) $$, tests.id('l2')),
  '42501', 'not_a_member', 'outsiders cannot revoke links'
);
select tests.login_anon();
select throws_ok(
  format($$ select public.revoke_guest_link(%L) $$, tests.id('l2')),
  '42501', null, 'anon cannot revoke links'
);
select tests.login('m1');
select isnt(
  (select revoked_at from public.revoke_guest_link(tests.id('l2'))),
  null,
  'the organizer revokes any link on their plan'
);
select throws_ok(
  format($$ select public.revoke_guest_link(%L) $$, gen_random_uuid()),
  'PT404', 'guest_link_not_found', 'revoking an unknown link is not found'
);
select tests.login('m2');
select lives_ok(format($$ select public.revoke_guest_link(%L) $$, tests.id('l1')), 'the creator revokes their own link');

select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_guest_availability(%L, 'Ana', %L, %L) $$,
    pg_temp.code(), pg_temp.tok('ana'), jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_link_revoked', 'a revoked link rejects edits'
);
select results_eq(
  $$ select status, title, heat, my_name from public.guest_link_preview(pg_temp.code(), pg_temp.tok('ana')) $$,
  $$ values ('revoked', null::text, null::jsonb, null::text) $$,
  'a revoked link shows nothing about the plan'
);
select tests.login('m1');
select is(
  (select count(*)::int from public.event_guests where link_id = tests.id('l1')),
  2,
  'answers already given stay on the plan'
);

-- Expiry ----------------------------------------------------------------------------------------

select tests.remember('l3', (select id from public.create_guest_link(tests.id('ev'), '24h', 5)));
reset role;
update public.event_guest_links set expires_at = now() - interval '1 second' where id = tests.id('l3');
create temp table l3 as select code from public.event_guest_links where id = tests.id('l3');
grant select on l3 to anon, authenticated;
select tests.login_anon();
select throws_ok(
  format($$ select * from public.set_guest_availability((select code from l3), 'Eve', null, %L) $$,
    jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'guest_link_expired', 'an expired link rejects answers'
);
select is(
  (select status from public.guest_link_preview((select code from l3))),
  'expired',
  'an expired link says so'
);

-- Too many open links ---------------------------------------------------------------------------

reset role;
insert into public.event_guest_links (event_id, group_id, created_by, max_guests, expires_at)
select tests.id('ev'), tests.id('g'), tests.uid('m1'), 5, now() + interval '1 day'
from generate_series(1, 20 - (
  select count(*)::int from public.event_guest_links
  where event_id = tests.id('ev') and revoked_at is null and expires_at > now()
));
select tests.login('m1');
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 5) $$, tests.id('ev')),
  '23514', 'guest_link_limit', 'a plan has at most 20 open links'
);

-- Archived groups -------------------------------------------------------------------------------

reset role;
delete from public.event_guests where link_id = tests.id('busy');
update public.groups set archived_at = now() where id = tests.id('g');
select tests.login_anon();
select is(
  (select status from public.guest_link_preview((select code from busy))),
  'archived',
  'links in an archived group are closed'
);
select throws_ok(
  format($$ select * from public.set_guest_availability((select code from busy), 'Fay', null, %L) $$,
    jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'group_archived', 'and reject answers'
);
select tests.login('m1');
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 5) $$, tests.id('ev')),
  '23514', 'group_archived', 'no new links in an archived group'
);
reset role;
update public.groups set archived_at = null where id = tests.id('g');

-- Scheduled plans -------------------------------------------------------------------------------

select tests.login('m1');
select schedule_event(tests.id('ev'), ((current_date + 1) + '10:00'::time) at time zone 'UTC');
select tests.login_anon();
select results_eq(
  $$ select status, title from public.guest_link_preview((select code from busy)) $$,
  $$ values ('closed', null::text) $$,
  'once the plan is scheduled its links close'
);
select throws_ok(
  format($$ select * from public.set_guest_availability((select code from busy), 'Fay', null, %L) $$,
    jsonb_build_array(pg_temp.slot(1, '10:00'))),
  '23514', 'event_not_polling', 'and reject answers'
);
select tests.login('m1');
select throws_ok(
  format($$ select public.create_guest_link(%L, '7d', 5) $$, tests.id('ev')),
  '23514', 'event_not_polling', 'a scheduled plan takes no new links'
);

select * from finish();
rollback;
