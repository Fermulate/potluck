-- Realistic volume for performance work. LOCAL DATABASE ONLY.
--
--   docker exec -i supabase_db_potluck psql -U postgres -v ON_ERROR_STOP=1 < supabase/snippets/perf_volume.sql
--
-- Creates its own accounts and groups and never touches the seed users:
--   40 users       perf01..perf40@perf.potluck.test (password "potluck-demo")
--   15 groups      "Perf 01".."Perf 15", 4 to 12 members each
--   3,000 expenses equal splits, about 5% in EUR, about 2% soft deleted
--   about 300 settlements
--   40 events      polls with availability, scheduled events with RSVPs
--   300 comments
-- perf01 is the heavy user: member of 12 groups, with thousands of rows in reach.
--
-- Running it again first removes everything it created, so it is repeatable.
-- Every row is generated from setseed(), so plans compare across runs.

begin;

select setseed(0.42);

-- Clean up a previous run ---------------------------------------------------

delete from public.groups where id::text like '9e9f1000-%';
delete from auth.users where email like '%@perf.potluck.test';

-- Users ----------------------------------------------------------------------

create temporary table perf_users on commit drop as
select
  n,
  ('9e9f0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id,
  'perf' || lpad(n::text, 2, '0') as handle
from generate_series(1, 40) n;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.handle || '@perf.potluck.test', extensions.crypt('potluck-demo', extensions.gen_salt('bf', 4)),
  now() - interval '400 days',
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('display_name', 'Perf ' || initcap(u.handle), 'timezone', 'America/Los_Angeles', 'onboarded', true),
  now() - interval '400 days', now() - interval '400 days',
  '', '', '', ''
from perf_users u;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.handle || '@perf.potluck.test', 'email_verified', true),
  'email', now() - interval '1 day', now() - interval '400 days', now() - interval '400 days'
from perf_users u;

-- Groups and members ---------------------------------------------------------

create temporary table perf_groups on commit drop as
select
  g,
  ('9e9f1000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as id,
  case when g = 15 then 'EUR' else 'USD' end as currency
from generate_series(1, 15) g;

insert into public.groups (id, name, emoji, color, currency, created_by, created_at)
select
  pg.id,
  'Perf ' || lpad(pg.g::text, 2, '0'),
  (array['🍕', '🏠', '🥾', '🎉', '🏖️'])[1 + pg.g % 5],
  (array['green', 'orange', 'red', 'blue', 'purple'])[1 + pg.g % 5],
  pg.currency,
  ('9e9f0000-0000-4000-8000-' || lpad((case when pg.g <= 3 then 1 else 2 + (pg.g * 7) % 39 end)::text, 12, '0'))::uuid,
  now() - interval '380 days'
from perf_groups pg;

-- perf01 joins groups 1..12. Each group gets 4 to 12 members from a rotating
-- window so people overlap across groups. perf01 owns groups 1..3.
create temporary table perf_members on commit drop as
with picks as (
  select pg.g, pg.id as group_id, 2 + ((pg.g * 7 + k) % 39) as n, k + 1 as ord
  from perf_groups pg
  cross join lateral generate_series(0, 3 + pg.g % 9 - (case when pg.g <= 12 then 1 else 0 end) - 1) k
  union all
  select pg.g, pg.id, 1, 0 from perf_groups pg where pg.g <= 12
)
select p.group_id, u.id as user_id, p.ord,
  case
    when p.g <= 3 and p.n = 1 then 'owner'
    when p.g > 3 and p.ord = 1 then 'owner'
    when p.ord = 2 then 'admin'
    else 'member'
  end::public.group_role as role
from picks p
join perf_users u on u.n = p.n;

insert into public.group_members (group_id, user_id, role, joined_at)
select group_id, user_id, role, now() - interval '380 days' + (ord || ' hours')::interval
from perf_members;

-- Expenses: 200 per group ------------------------------------------------------

create temporary table perf_expenses on commit drop as
select
  ('9e9f3000-0000-4000-8000-' || lpad((pg.g * 1000 + i)::text, 12, '0'))::uuid as id,
  pg.id as group_id,
  pg.currency as group_currency,
  i,
  (100 + floor(random() * 25000))::bigint as amount_cents,
  random() as r_currency,
  random() as r_deleted,
  floor(random() * 365)::int as days_ago,
  (array['food', 'groceries', 'transport', 'lodging', 'utilities', 'drinks', 'gear', 'rent'])[1 + floor(random() * 8)::int] as category
from perf_groups pg
cross join generate_series(1, 200) i;

-- Payer and participants: a random subset of 2+ members, payer always included.
create temporary table perf_participants on commit drop as
select e.id as expense_id, m.user_id, row_number() over (partition by e.id order by m.user_id) as rn
from perf_expenses e
join perf_members m on m.group_id = e.group_id
where random() < 0.7 or m.ord in (1, 2);

create temporary table perf_payer on commit drop as
select distinct on (p.expense_id) p.expense_id, p.user_id
from perf_participants p
order by p.expense_id, random();

insert into public.expenses (
  id, group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
  category, spent_at, created_by, created_at, deleted_at
)
select
  e.id, e.group_id,
  initcap(e.category) || ' #' || e.i,
  e.amount_cents,
  case when e.group_currency = 'USD' and e.r_currency < 0.05 then 'EUR' else e.group_currency end,
  case when e.group_currency = 'USD' and e.r_currency < 0.05 then 1.08 else 1 end,
  p.user_id, 'equal', e.category,
  current_date - e.days_ago,
  p.user_id,
  now() - (e.days_ago || ' days')::interval,
  case when e.r_deleted < 0.02 then now() - interval '1 day' end
from perf_expenses e
join perf_payer p on p.expense_id = e.id;

-- Equal shares, remainder cents to the first participants.
insert into public.expense_splits (expense_id, user_id, share_cents)
select
  p.expense_id, p.user_id,
  e.amount_cents / c.n + case when p.rn <= e.amount_cents % c.n then 1 else 0 end
from perf_participants p
join perf_expenses e on e.id = p.expense_id
join (select expense_id, count(*) as n from perf_participants group by expense_id) c on c.expense_id = p.expense_id;

-- Settlements: 20 per group --------------------------------------------------

insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, settled_at, created_by, created_at)
select s.group_id, s.from_user, s.to_user, s.amount, s.currency, s.at, s.from_user, s.at
from (
  select
    pg.id as group_id,
    pg.currency,
    (select m.user_id from perf_members m where m.group_id = pg.id and m.ord = (i % 2) + 1) as from_user,
    (select m.user_id from perf_members m where m.group_id = pg.id and m.ord = (i % 2) + 2) as to_user,
    (500 + floor(random() * 20000))::bigint as amount,
    now() - (floor(random() * 300) || ' days')::interval as at
  from perf_groups pg
  cross join generate_series(1, 20) i
) s
where s.from_user is not null and s.to_user is not null;

-- Events: 40 across groups 1..12 ---------------------------------------------

create temporary table perf_events on commit drop as
select
  ('9e9f2000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id,
  n,
  (select pg.id from perf_groups pg where pg.g = 1 + (n - 1) % 12) as group_id,
  case
    when n % 4 = 0 then 'scheduled_past'
    when n % 4 = 1 then 'scheduled'
    else 'polling'
  end as kind,
  case when n % 10 = 2 then 15 else 30 end as slot_minutes,
  case when n % 10 = 2 then 13 else 6 end as window_days
from generate_series(1, 40) n;

insert into public.events (
  id, group_id, title, emoji, status, timezone, window_start, window_end,
  day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees,
  starts_at, ends_at, created_by, created_at
)
select
  e.id, e.group_id, 'Perf plan ' || e.n, '📅',
  (case e.kind when 'polling' then 'polling' when 'scheduled' then 'scheduled' else 'done' end)::public.event_status,
  'America/Los_Angeles',
  current_date + (e.n % 7), current_date + (e.n % 7) + e.window_days,
  480, 1320, e.slot_minutes, 120, 2,
  case
    when e.kind = 'scheduled' then now() + ((2 + e.n % 50) || ' days')::interval
    when e.kind = 'scheduled_past' then now() - ((1 + e.n % 90) || ' days')::interval
  end,
  case
    when e.kind = 'scheduled' then now() + ((2 + e.n % 50) || ' days')::interval + interval '2 hours'
    when e.kind = 'scheduled_past' then now() - ((1 + e.n % 90) || ' days')::interval + interval '2 hours'
  end,
  (select m.user_id from perf_members m where m.group_id = e.group_id and m.ord = 1),
  now() - interval '3 days'
from perf_events e;

-- Availability for polls: each member marks about 45% of cells, 1 in 5 as maybe.
insert into public.availability (event_id, user_id, slot_start, level)
select ev.id, m.user_id, cell.slot_start,
  case when random() < 0.2 then 'maybe' else 'yes' end::public.availability_level
from perf_events pe
join public.events ev on ev.id = pe.id
join perf_members m on m.group_id = ev.group_id
cross join lateral (
  select ((ev.window_start + d) + make_interval(mins => mins)) at time zone ev.timezone as slot_start
  from generate_series(0, ev.window_end - ev.window_start) d
  cross join generate_series(ev.day_start_minute, ev.day_end_minute - ev.slot_minutes, ev.slot_minutes) mins
) cell
where pe.kind = 'polling' and random() < 0.45;

insert into public.availability_requests (event_id, user_id, requested_by, requested_at, responded_at)
select pe.id, m.user_id, ev.created_by, now() - interval '2 days',
  case when random() < 0.6 then now() - interval '1 day' end
from perf_events pe
join public.events ev on ev.id = pe.id
join perf_members m on m.group_id = ev.group_id
where pe.kind = 'polling' and m.user_id is distinct from ev.created_by;

insert into public.event_rsvps (event_id, user_id, status, updated_at)
select pe.id, m.user_id,
  (array['going', 'going', 'maybe', 'declined'])[1 + floor(random() * 4)::int]::public.rsvp_status,
  now() - interval '1 day'
from perf_events pe
join public.events ev on ev.id = pe.id
join perf_members m on m.group_id = ev.group_id
where pe.kind <> 'polling' and random() < 0.8;

-- Comments: 300 on random expenses -------------------------------------------

insert into public.comments (expense_id, author_id, body, created_at)
select e.id, p.user_id, 'Perf comment ' || n, now() - (n || ' hours')::interval
from generate_series(1, 300) n
join lateral (
  select x.id from perf_expenses x where x.i = 1 + (n * 37) % 200 and x.group_id = (
    select pg.id from perf_groups pg where pg.g = 1 + n % 15
  )
) e on true
join perf_payer p on p.expense_id = e.id;

commit;

-- Most people read their notifications eventually; leave the newest 40 unread.
update public.notifications n set read_at = n.created_at + interval '1 hour'
from (
  select id, row_number() over (partition by user_id order by created_at desc) as rn
  from public.notifications
  where user_id in (select id from auth.users where email like '%@perf.potluck.test')
) x
where x.id = n.id and x.rn > 40;

analyze public.groups, public.group_members, public.expenses, public.expense_splits, public.settlements,
  public.events, public.availability, public.availability_requests, public.event_rsvps,
  public.activity, public.comments, public.notifications, public.profiles, public.friendships;

select
  (select count(*) from auth.users where email like '%@perf.potluck.test') as users,
  (select count(*) from public.groups where id::text like '9e9f1000-%') as groups,
  (select count(*) from public.expenses where group_id::text like '9e9f1000-%') as expenses,
  (select count(*) from public.expense_splits s join public.expenses e on e.id = s.expense_id
    where e.group_id::text like '9e9f1000-%') as splits,
  (select count(*) from public.settlements where group_id::text like '9e9f1000-%') as settlements,
  (select count(*) from public.events where group_id::text like '9e9f1000-%') as events,
  (select count(*) from public.availability a join public.events e on e.id = a.event_id
    where e.group_id::text like '9e9f1000-%') as availability,
  (select count(*) from public.activity where group_id::text like '9e9f1000-%') as activity,
  (select count(*) from public.notifications n join auth.users u on u.id = n.user_id
    where u.email like '%@perf.potluck.test') as notifications;
