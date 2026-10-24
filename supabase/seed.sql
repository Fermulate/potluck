-- Local demo data. Every account signs in with password "potluck-demo".
--
--   ava@potluck.test   Ava Chen      owns Hike crew
--   ben@potluck.test   Ben Ortiz     owns Roommates, admin of Hike crew
--   cleo@potluck.test  Cleo Park     admin of Roommates
--   dev@potluck.test   Dev Patel     admin of Dim sum club
--   eli@potluck.test   Eli Novak
--   fay@potluck.test   Fay Okafor    owns Dim sum club
--
-- Writes go through the real RPCs (impersonating each user) so balances,
-- activity and notifications look exactly like production data. All dates are
-- relative to now().

-- Users ----------------------------------------------------------------------

create temporary table seed_users (handle text primary key, id uuid not null, full_name text not null, tz text not null);
insert into seed_users values
  ('ava',  'aaaaaaaa-0000-4000-8000-000000000001', 'Ava Chen',   'America/Los_Angeles'),
  ('ben',  'bbbbbbbb-0000-4000-8000-000000000002', 'Ben Ortiz',  'America/Los_Angeles'),
  ('cleo', 'cccccccc-0000-4000-8000-000000000003', 'Cleo Park',  'America/Los_Angeles'),
  ('dev',  'dddddddd-0000-4000-8000-000000000004', 'Dev Patel',  'America/New_York'),
  ('eli',  'eeeeeeee-0000-4000-8000-000000000005', 'Eli Novak',  'Europe/Lisbon'),
  ('fay',  'ffffffff-0000-4000-8000-000000000006', 'Fay Okafor', 'America/Los_Angeles');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.handle || '@potluck.test', extensions.crypt('potluck-demo', extensions.gen_salt('bf')), now() - interval '90 days',
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('display_name', u.full_name, 'timezone', u.tz, 'onboarded', true),
  now() - interval '90 days', now() - interval '90 days',
  '', '', '', ''
from seed_users u;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.handle || '@potluck.test', 'email_verified', true),
  'email', now() - interval '1 day', now() - interval '90 days', now() - interval '90 days'
from seed_users u;

update public.profiles p set default_currency = 'EUR' from seed_users u where p.id = u.id and u.handle = 'eli';

create function pg_temp.uid(h text) returns uuid language sql stable as $$
  select id from seed_users where handle = h
$$;

-- Session-wide impersonation for the RPCs below.
create function pg_temp.act_as(h text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(h), 'role', 'authenticated')::text, false);
$$;

-- FX rates (the fx-sync edge function keeps these fresh in production) -------

insert into public.fx_rates (base, quote, day, rate)
select 'EUR', 'USD', d::date, 1.08 + 0.002 * (extract(day from d)::int % 5)
from generate_series(current_date - 60, current_date, interval '1 day') d
union all
select 'GBP', 'USD', d::date, 1.27 + 0.001 * (extract(day from d)::int % 7)
from generate_series(current_date - 60, current_date, interval '1 day') d;

-- Groups ---------------------------------------------------------------------

insert into public.groups (id, name, emoji, color, currency, created_by, created_at) values
  ('10000000-0000-4000-8000-000000000001', 'Hike crew',    '🥾', 'green',  'USD', pg_temp.uid('ava'), now() - interval '80 days'),
  ('10000000-0000-4000-8000-000000000002', 'Roommates',    '🏠', 'orange', 'USD', pg_temp.uid('ben'), now() - interval '85 days'),
  ('10000000-0000-4000-8000-000000000003', 'Dim sum club', '🥟', 'red',    'USD', pg_temp.uid('fay'), now() - interval '70 days');

insert into public.group_members (group_id, user_id, role, joined_at)
select g.id, pg_temp.uid(m.handle), m.role::public.group_role, now() - (m.days || ' days')::interval
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'ava',  'owner',  80),
  ('10000000-0000-4000-8000-000000000001'::uuid, 'ben',  'admin',  79),
  ('10000000-0000-4000-8000-000000000001'::uuid, 'cleo', 'member', 78),
  ('10000000-0000-4000-8000-000000000001'::uuid, 'dev',  'member', 75),
  ('10000000-0000-4000-8000-000000000001'::uuid, 'eli',  'member', 60),
  ('10000000-0000-4000-8000-000000000001'::uuid, 'fay',  'member', 20),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'ben',  'owner',  85),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'cleo', 'admin',  85),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'ava',  'member', 84),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'fay',  'member', 84),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'fay',  'owner',  70),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'dev',  'admin',  69),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'ava',  'member', 65),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'eli',  'member', 64),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'cleo', 'member', 50)
) as m (gid, handle, role, days)
join public.groups g on g.id = m.gid;

-- An open invite link for the join page.
insert into public.group_invites (group_id, code, role, max_uses, expires_at, created_by)
values ('10000000-0000-4000-8000-000000000001', 'hikecrew-demo', 'member', 10, now() + interval '14 days', pg_temp.uid('ava'));

-- Expenses -------------------------------------------------------------------
-- (group, payer, description, amount, currency, split type, people, weights or
--  amounts, days ago, category, recurrence)

create temporary table seed_expenses (
  n int primary key,
  grp text, payer text, description text, amount bigint, currency text, kind text,
  people text[], weights numeric[], days int, category text, recurrence text
);

insert into seed_expenses values
  -- Hike crew
  (1,  'hike', 'ava',  'Trailhead parking',        2400,   'USD', 'equal',    '{ava,ben,cleo,dev}', null, 40, 'transport', null),
  (2,  'hike', 'ben',  'Campsite reservation',     8600,   'USD', 'equal',    '{ava,ben,cleo,dev,eli}', null, 38, 'lodging', null),
  (3,  'hike', 'cleo', 'Groceries for camp',       13457,  'USD', 'equal',    '{ava,ben,cleo,dev,eli}', null, 37, 'groceries', null),
  (4,  'hike', 'dev',  'Firewood',                 1800,   'USD', 'equal',    '{ben,cleo,dev}', null, 37, 'supplies', null),
  (5,  'hike', 'eli',  'Gas for two cars',         7420,   'USD', 'exact',    '{ava,ben,dev,eli}', '{1855,1855,1855,1855}', 30, 'transport', null),
  (6,  'hike', 'ava',  'Bear canister rental',     2500,   'USD', 'shares',   '{ava,ben,cleo}', '{1,1,2}', 22, 'gear', null),
  (7,  'hike', 'ben',  'Post-hike burgers',        9640,   'USD', 'itemized', '{ava,ben,cleo,dev,eli}', '{2150,2490,1800,1900,1300}', 15, 'food', null),
  (8,  'hike', 'fay',  'Trail maps',               1200,   'USD', 'equal',    '{ava,cleo,fay}', null, 9, 'gear', null),
  (9,  'hike', 'cleo', 'Sunscreen and bug spray',  2299,   'USD', 'equal',    '{ava,ben,cleo,dev,eli,fay}', null, 5, 'supplies', null),
  (10, 'hike', 'dev',  'Coffee at the summit cafe', 3150,  'USD', 'equal',    '{ava,ben,cleo,dev,eli,fay}', null, 2, 'food', null),
  -- Roommates
  (11, 'home', 'ben',  'Rent (two months ago)',    360000, 'USD', 'percent',  '{ben,cleo,ava,fay}', '{30,30,20,20}', 60, 'rent', null),
  (12, 'home', 'ben',  'Rent',                     360000, 'USD', 'percent',  '{ben,cleo,ava,fay}', '{30,30,20,20}', 30, 'rent', 'monthly'),
  (13, 'home', 'cleo', 'Internet',                 6999,   'USD', 'equal',    '{ben,cleo,ava,fay}', null, 45, 'utilities', null),
  (14, 'home', 'cleo', 'Internet',                 6999,   'USD', 'equal',    '{ben,cleo,ava,fay}', null, 15, 'utilities', 'monthly'),
  (15, 'home', 'ava',  'Costco run',               18734,  'USD', 'equal',    '{ben,cleo,ava,fay}', null, 28, 'groceries', null),
  (16, 'home', 'fay',  'Dish soap, sponges, trash bags', 2645, 'USD', 'equal', '{ben,cleo,ava,fay}', null, 21, 'household', null),
  (17, 'home', 'ben',  'Electricity',              11280,  'USD', 'shares',   '{ben,cleo,ava,fay}', '{2,1,1,1}', 19, 'utilities', null),
  (18, 'home', 'ava',  'Plant for the living room', 4500,  'USD', 'exact',    '{ava,ben,cleo,fay}', '{1500,1000,1000,1000}', 12, 'household', null),
  (19, 'home', 'cleo', 'Pizza night',              5260,   'USD', 'equal',    '{ben,cleo,ava,fay}', null, 7, 'food', null),
  (20, 'home', 'fay',  'Groceries',                9318,   'USD', 'equal',    '{ben,cleo,ava,fay}', null, 3, 'groceries', null),
  (21, 'home', 'ben',  'Water bill',               4210,   'USD', 'equal',    '{ben,cleo,ava,fay}', null, 1, 'utilities', null),
  -- Dim sum club
  (22, 'dim',  'fay',  'Golden Dragon',            14280,  'USD', 'equal',    '{fay,dev,ava,eli,cleo}', null, 50, 'food', null),
  (23, 'dim',  'dev',  'Lucky Garden',             11965,  'USD', 'equal',    '{fay,dev,ava,eli}', null, 36, 'food', null),
  (24, 'dim',  'eli',  'Pasteis de nata in Lisbon', 2400,  'EUR', 'equal',    '{ava,eli,cleo}', null, 29, 'food', null),
  (25, 'dim',  'eli',  'Jade Palace',              16720,  'USD', 'itemized', '{fay,dev,ava,eli,cleo}', '{3100,3600,3320,3900,2800}', 22, 'food', null),
  (26, 'dim',  'cleo', 'Bubble tea round',         3150,   'USD', 'equal',    '{fay,dev,ava,eli,cleo}', null, 14, 'drinks', null),
  (27, 'dim',  'fay',  'Hong Kong Lounge',         15870,  'USD', 'percent',  '{fay,dev,ava,eli,cleo}', '{20,20,20,20,20}', 8, 'food', null),
  (28, 'dim',  'dev',  'Egg tarts to go',          1800,   'USD', 'shares',   '{ava,dev,eli}', '{2,1,1}', 6, 'food', null),
  (29, 'dim',  'ava',  'Tea leaves for the group', 2675,   'USD', 'equal',    '{fay,dev,ava,eli,cleo}', null, 1, 'drinks', null),
  -- 1:1 between Ava and Fay
  (30, 'direct', 'fay', 'Concert tickets',         15000,  'USD', 'equal',    '{ava,fay}', null, 10, 'entertainment', null),
  -- Added twice by mistake, then deleted (shows up as restorable)
  (31, 'hike', 'eli',  'Coffee at the summit cafe', 3150,  'USD', 'equal',    '{ava,ben,cleo,dev,eli,fay}', null, 2, 'food', null);

do $$
declare
  x record;
  gid uuid;
  direct_gid uuid;
  splits jsonb;
  eid uuid;
begin
  perform pg_temp.act_as('ava');
  direct_gid := public.get_or_create_direct_group(pg_temp.uid('fay'));

  for x in select * from seed_expenses order by n loop
    gid := case x.grp
      when 'hike' then '10000000-0000-4000-8000-000000000001'::uuid
      when 'home' then '10000000-0000-4000-8000-000000000002'::uuid
      when 'dim' then '10000000-0000-4000-8000-000000000003'::uuid
      else direct_gid
    end;

    select jsonb_agg(
      case
        when x.kind in ('exact', 'itemized') then jsonb_build_object('user_id', pg_temp.uid(p.h), 'share_cents', x.weights[p.i])
        when x.kind in ('percent', 'shares') then jsonb_build_object('user_id', pg_temp.uid(p.h), 'weight', x.weights[p.i])
        else jsonb_build_object('user_id', pg_temp.uid(p.h))
      end
      order by p.i
    )
    into splits
    from unnest(x.people) with ordinality as p (h, i);

    perform pg_temp.act_as(x.payer);
    select e.id into eid from public.create_expense(jsonb_strip_nulls(jsonb_build_object(
      'group_id', gid,
      'description', x.description,
      'amount_cents', x.amount,
      'currency', x.currency,
      'split_type', x.kind,
      'splits', splits,
      'spent_at', current_date - x.days,
      'category', x.category,
      'recurrence', x.recurrence
    ))) e;

    update public.expenses e
    set created_at = (current_date - x.days) + time '19:30' + (x.n || ' minutes')::interval
    where e.id = eid;

    if x.n = 31 then
      perform public.delete_expense(eid);
    end if;
  end loop;
end;
$$;

update public.expenses set notes = 'Includes the extra bag of ice' where description = 'Groceries for camp';

-- Settlements ----------------------------------------------------------------

do $$
declare
  x record;
  sid uuid;
begin
  -- settle_up always records the caller paying now; backdate afterwards.
  for x in
    select * from (values
      (1, 'dev',  '10000000-0000-4000-8000-000000000001'::uuid, 'ben',  2000,   null, 'Venmo',                      interval '10 days'),
      (2, 'eli',  '10000000-0000-4000-8000-000000000001'::uuid, 'cleo', 1500,   null, 'cash at the trailhead',      interval '6 days'),
      (3, 'cleo', '10000000-0000-4000-8000-000000000002'::uuid, 'ben',  108000, null, 'rent',                       interval '55 days'),
      (4, 'ava',  '10000000-0000-4000-8000-000000000002'::uuid, 'ben',  72000,  null, 'rent',                       interval '54 days'),
      (5, 'fay',  '10000000-0000-4000-8000-000000000002'::uuid, 'ben',  72000,  null, 'rent',                       interval '52 days'),
      (6, 'fay',  '10000000-0000-4000-8000-000000000002'::uuid, 'ben',  50000,  null, 'rent, part 1',               interval '5 days'),
      (7, 'eli',  '10000000-0000-4000-8000-000000000003'::uuid, 'fay',  2500,   'EUR', null,                        interval '3 days'),
      (8, 'ava',  null::uuid,                                   'fay',  7500,   null, 'thanks for grabbing these!', interval '2 days')
    ) as t (n, payer, gid, payee, amount, currency, note, ago)
    order by n
  loop
    perform pg_temp.act_as(x.payer);
    select s.id into sid from public.settle_up(
      coalesce(x.gid, public.get_or_create_direct_group(pg_temp.uid(x.payee))),
      pg_temp.uid(x.payee), x.amount, x.currency, x.note
    ) s;
    update public.settlements s set settled_at = now() - x.ago where s.id = sid;
  end loop;
end;
$$;

-- Events ---------------------------------------------------------------------

-- A poll: sunrise hike next week, 3 hours, 7:00 to 13:00 Pacific.
insert into public.events (
  id, group_id, title, description, location, emoji, timezone, window_start, window_end,
  day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees, created_by, created_at
) values (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'Mt. Tam sunrise hike', 'Steep Ravine loop, then breakfast in Stinson.', 'Pantoll Ranger Station', '🌄',
  'America/Los_Angeles', current_date + 3, current_date + 9, 420, 780, 30, 180, 3,
  pg_temp.uid('ava'), now() - interval '2 days'
);

-- A scheduled one: gear swap in two days at 18:00 Pacific.
insert into public.events (
  id, group_id, title, description, location, emoji, timezone, window_start, window_end,
  duration_minutes, min_attendees, created_by, created_at
) values (
  '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'Gear swap + tacos', 'Bring anything you have not used in a year.', 'Ben''s backyard', '🌮',
  'America/Los_Angeles', current_date + 1, current_date + 4, 120, 2,
  pg_temp.uid('ben'), now() - interval '6 days'
);

do $$
declare
  poll uuid := '20000000-0000-4000-8000-000000000001';
  x record;
begin
  perform pg_temp.act_as('ava');
  perform public.request_availability(poll);

  -- (who, day offsets from window start, local from, local to, maybe from)
  for x in
    select * from (values
      ('ava',  array[0, 1, 3, 5], '07:00'::time, '13:00'::time, '11:00'::time),
      ('ben',  array[0, 3, 4],    '07:00'::time, '11:30'::time, '10:00'::time),
      ('cleo', array[0, 1, 3],    '08:00'::time, '13:00'::time, '12:00'::time),
      ('dev',  array[3, 4, 5],    '07:00'::time, '12:00'::time, '07:00'::time),
      ('eli',  array[0, 3, 6],    '07:30'::time, '10:30'::time, '10:00'::time)
    ) as t (who, days, from_t, to_t, maybe_from)
  loop
    perform pg_temp.act_as(x.who);
    perform public.set_availability(poll, (
      select jsonb_agg(jsonb_build_object(
        'slot_start', ((current_date + 3 + d) + s.t) at time zone 'America/Los_Angeles',
        'level', case when s.t >= x.maybe_from then 'maybe' else 'yes' end
      ))
      from unnest(x.days) as d
      cross join lateral (
        select g::time as t from generate_series(timestamp '2000-01-01' + x.from_t, timestamp '2000-01-01' + x.to_t - interval '30 minutes', interval '30 minutes') g
      ) s
    ));
  end loop;

  perform pg_temp.act_as('ben');
  perform public.schedule_event('20000000-0000-4000-8000-000000000002', ((current_date + 2) + time '18:00') at time zone 'America/Los_Angeles');
end;
$$;

insert into public.event_rsvps (event_id, user_id, status, updated_at)
select '20000000-0000-4000-8000-000000000002', pg_temp.uid(r.who), r.status::public.rsvp_status, now() - interval '1 day'
from (values ('ava', 'going'), ('ben', 'going'), ('cleo', 'going'), ('dev', 'maybe'), ('eli', 'declined')) as r (who, status);

-- Comments -------------------------------------------------------------------

do $$
begin
  perform pg_temp.act_as('dev');
  insert into public.comments (expense_id, body, author_id)
  select e.id, 'Next time we split the firewood with the other campsite!', pg_temp.uid('dev')
  from public.expenses e where e.description = 'Firewood';

  perform pg_temp.act_as('fay');
  insert into public.comments (event_id, body, author_id)
  values ('20000000-0000-4000-8000-000000000001', 'I can only do weekends, sorry!', pg_temp.uid('fay'));

  perform pg_temp.act_as('cleo');
  insert into public.comments (expense_id, body, author_id)
  select e.id, 'Did this include the tip?', pg_temp.uid('cleo')
  from public.expenses e where e.description = 'Hong Kong Lounge';
end;
$$;

-- Tidy up --------------------------------------------------------------------

-- Spread the feed over time to match the rows it describes.
update public.activity a set created_at = e.created_at
from public.expenses e where a.subject_id = e.id and a.verb = 'expense.created';
update public.activity a set created_at = s.settled_at
from public.settlements s where a.subject_id = s.id;
update public.activity a set created_at = m.joined_at
from public.group_members m where a.verb = 'member.joined' and a.subject_id = m.user_id and a.group_id = m.group_id;
update public.activity a set created_at = g.created_at
from public.groups g where a.verb = 'group.created' and a.group_id = g.id;
update public.activity a set created_at = ev.created_at
from public.events ev where a.verb = 'event.created' and a.subject_id = ev.id;

select set_config('request.jwt.claims', '', false);
