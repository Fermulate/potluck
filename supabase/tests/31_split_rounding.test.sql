-- Where the leftover cent goes, the same in every split type. Twin of
-- packages/core/src/money/split-remainder.test.ts: same people, same cases, same answers.
-- Floor each exact share, then one cent each to the largest remainders, ties to the smaller
-- user id (never to whoever is listed first).
begin;
select plan(12);

create temporary table people (name text primary key, id uuid not null) on commit drop;
insert into people values
  ('a', '00000000-0000-4000-8000-00000000000a'),
  ('b', '00000000-0000-4000-8000-00000000000b'),
  ('c', '00000000-0000-4000-8000-00000000000c');

-- Each person's cents as "a=51,b=50", in name order.
create function pg_temp.cents(amount bigint, kind public.split_type, splits jsonb) returns text
language sql as $$
  select string_agg(p.name || '=' || r.share_cents, ',' order by p.name)
  from private.compute_split_rows(amount, kind, splits) r
  join people p on p.id = r.user_id
$$;

-- A split listed in the given order: [name, field, value] triples.
create function pg_temp.splits(variadic parts text[]) returns jsonb
language sql as $$
  select jsonb_agg(
    case
      when parts[i + 1] = 'none' then jsonb_build_object('user_id', p.id)
      else jsonb_build_object('user_id', p.id, parts[i + 1], parts[i + 2]::numeric)
    end
    order by i
  )
  from generate_series(1, array_length(parts, 1), 3) as i
  join people p on p.name = parts[i]
$$;

-- 1.01 between two people, listed b first: 50.5 cents each, a takes the cent everywhere.
select is(pg_temp.cents(101, 'equal', pg_temp.splits('b', 'none', '0', 'a', 'none', '0')),
  'a=51,b=50', 'equal: a tie goes to the smaller id');
select is(pg_temp.cents(101, 'percent', pg_temp.splits('b', 'weight', '50', 'a', 'weight', '50')),
  'a=51,b=50', 'percent: a tie goes to the smaller id');
select is(pg_temp.cents(101, 'shares', pg_temp.splits('b', 'weight', '1', 'a', 'weight', '1')),
  'a=51,b=50', 'shares: a tie goes to the smaller id');
select is(pg_temp.cents(101, 'adjustment',
    pg_temp.splits('b', 'adjustment_cents', '0', 'a', 'adjustment_cents', '0')),
  'a=51,b=50', 'adjustment: a tie goes to the smaller id');

-- 10.01 at 50 / 30 / 20, listed c first: 500.5, 300.3 and 200.2.
select is(pg_temp.cents(1001, 'percent',
    pg_temp.splits('c', 'weight', '20', 'b', 'weight', '30', 'a', 'weight', '50')),
  'a=501,b=300,c=200', 'percent: the largest remainder takes the cent');
select is(pg_temp.cents(1001, 'shares',
    pg_temp.splits('c', 'weight', '2', 'b', 'weight', '3', 'a', 'weight', '5')),
  'a=501,b=300,c=200', 'shares: the largest remainder takes the cent');

-- 1.01 at 25 / 25 / 50: 25.25, 25.25 and 50.5, so c takes it although a is smaller.
select is(pg_temp.cents(101, 'percent',
    pg_temp.splits('a', 'weight', '25', 'b', 'weight', '25', 'c', 'weight', '50')),
  'a=25,b=25,c=51', 'percent: the largest remainder wins over the smaller id');
select is(pg_temp.cents(101, 'shares',
    pg_temp.splits('a', 'weight', '1', 'b', 'weight', '1', 'c', 'weight', '2')),
  'a=25,b=25,c=51', 'shares: the largest remainder wins over the smaller id');

-- Adjustments: only the equal part rounds.
select is(pg_temp.cents(1000, 'adjustment',
    pg_temp.splits('a', 'adjustment_cents', '0', 'b', 'adjustment_cents', '0', 'c', 'adjustment_cents', '100')),
  'a=300,b=300,c=400', 'adjustment: nothing over when the rest divides evenly');
select is(pg_temp.cents(1001, 'adjustment',
    pg_temp.splits('c', 'adjustment_cents', '100', 'b', 'adjustment_cents', '0', 'a', 'adjustment_cents', '0')),
  'a=301,b=300,c=400', 'adjustment: the cent over the equal part goes to the smaller id');

-- Typed percents with decimals stay exact until the cents: 3333.33, 3333.33, 3334.33 (and a bit).
select is(pg_temp.cents(10001, 'percent',
    pg_temp.splits('a', 'weight', '33.33', 'b', 'weight', '33.33', 'c', 'weight', '33.34')),
  'a=3333,b=3333,c=3335', 'percent: two decimal percents round once, at the cents');

select throws_ok(
  $$ select pg_temp.cents(1000, 'percent', pg_temp.splits('a', 'weight', '50', 'b', 'weight', '30', 'c', 'weight', '10')) $$,
  '22023', 'percent_sum', 'percents that do not make 100 are refused');

select * from finish();
rollback;
