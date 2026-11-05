-- EXPLAIN (ANALYZE, BUFFERS) of the hot read paths as a signed-in user. LOCAL DATABASE ONLY.
-- Load supabase/snippets/perf_volume.sql first, then:
--
--   docker exec -i supabase_db_potluck psql -U postgres -q < supabase/snippets/perf_hot_paths.sql
--
-- Runs inside a rolled back transaction as role authenticated with perf01's JWT claims, so RLS
-- applies exactly as it does for the API. perf01 is the heavy user (12 groups, about 2,400
-- expenses in reach). For a light user in a big database, pass the seed user ava instead:
--
--   psql ... -v me=aaaaaaaa-0000-4000-8000-000000000001 \
--     -v grp=10000000-0000-4000-8000-000000000001 \
--     -v ev15=20000000-0000-4000-8000-000000000001 -v ev30=20000000-0000-4000-8000-000000000001
--
-- Run it twice and read the second run (warm cache). Results live in docs/dogfood/performance.md.

\if :{?me}
\else
\set me '9e9f0000-0000-4000-8000-000000000001'
\endif
\if :{?grp}
\else
\set grp '9e9f1000-0000-4000-8000-000000000008'
\endif
\if :{?ev15}
\else
\set ev15 '9e9f2000-0000-4000-8000-000000000002'
\endif
\if :{?ev30}
\else
\set ev30 '9e9f2000-0000-4000-8000-000000000007'
\endif
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'me', 'role', 'authenticated')::text, true);
\echo === Q1 group_balances one group
explain (analyze, buffers, costs off, summary on) select group_id, user_id, net_cents from public.group_balances where group_id = :'grp';
\echo === Q2 group_balances across my groups (in list)
explain (analyze, buffers, costs off, summary on) select group_id, user_id, net_cents from public.group_balances where group_id in (select private.my_group_ids());
\echo === Q3 home balances (user_id filter)
explain (analyze, buffers, costs off, summary on) select group_id, net_cents from public.group_balances where user_id = :'me';
\echo === Q4 expenses list page with splits
explain (analyze, buffers, costs off, summary on)
select e.*, coalesce((select json_agg(json_build_object('user_id', s.user_id, 'share_cents', s.share_cents, 'weight', s.weight)) from public.expense_splits s where s.expense_id = e.id), '[]') as expense_splits
from public.expenses e where e.group_id = :'grp' and e.deleted_at is null
order by e.spent_at desc, e.created_at desc, e.id limit 1000;
\echo === Q5 activity feed page
explain (analyze, buffers, costs off, summary on)
select a.id, a.group_id, a.actor_id, a.verb, a.subject_id, a.data, a.created_at,
  (select row_to_json(p) from (select p.id, p.display_name, p.avatar_path from public.profiles p where p.id = a.actor_id) p) as actor,
  (select row_to_json(g) from (select g.id, g.name, g.emoji, g.is_direct from public.groups g where g.id = a.group_id) g) as grp
from public.activity a order by a.created_at desc limit 30;
\echo === Q6 my_timeline
explain (analyze, buffers, costs off, summary on) select * from public.my_timeline(now(), now() + interval '60 days');
\echo === Q7 best_slots 15min event
explain (analyze, buffers, costs off, summary on) select * from public.best_slots(:'ev15', 5);
\echo === Q7b best_slots 30min 10 member event
explain (analyze, buffers, costs off, summary on) select * from public.best_slots(:'ev30', 5);
\echo === Q8 simplified_debts
explain (analyze, buffers, costs off, summary on) select * from public.simplified_debts(:'grp');
\echo === Q9 unread count
explain (analyze, buffers, costs off, summary on) select count(*) from public.notifications where user_id = :'me' and read_at is null;
\echo === Q10 notifications page
explain (analyze, buffers, costs off, summary on) select * from public.notifications where user_id = :'me' order by created_at desc limit 50;
\echo === Q11 my groups with members
explain (analyze, buffers, costs off, summary on)
select g.*, (select json_agg(json_build_object('role', m.role, 'joined_at', m.joined_at, 'profiles', (select row_to_json(p) from (select p.id, p.display_name, p.avatar_path, p.deleted_at from public.profiles p where p.id = m.user_id) p))) from public.group_members m where m.group_id = g.id) as members
from public.groups g order by g.updated_at desc;
\echo === Q12 people (profiles visible)
explain (analyze, buffers, costs off, summary on) select id, display_name, avatar_path, deleted_at from public.profiles;
\echo === Q13 event availability
explain (analyze, buffers, costs off, summary on) select event_id, user_id, slot_start, level from public.availability where event_id = :'ev15';
\echo === Q14 settlements list
explain (analyze, buffers, costs off, summary on) select * from public.settlements where group_id = :'grp' and deleted_at is null order by settled_at desc, id limit 1000;
\echo === Q15 past events
explain (analyze, buffers, costs off, summary on) select e.*, (select row_to_json(g) from (select g.name, g.emoji, g.color from public.groups g where g.id = e.group_id) g) from public.events e where e.status in ('scheduled','done') and e.ends_at < now() order by e.starts_at desc limit 20;
\echo === Q16 single expense with splits
explain (analyze, buffers, costs off, summary on) select e.*, (select json_agg(s) from public.expense_splits s where s.expense_id = e.id) from public.expenses e where e.id = (select x.id from public.expenses x where x.group_id = :'grp' order by x.id limit 1);
rollback;
