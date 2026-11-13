-- Search, totals and charts.
--
-- * pg_trgm indexes, so search_money can match descriptions, notes, payment notes and comments
--   (on expenses and on payments) with ILIKE without reading every row in the viewer's groups.
-- * View expense_ledger: one row per (expense, person) with what that person paid and their
--   share, both in group currency, using the same convert-once and largest-remainder rules as
--   group_balances (summing paid minus share over a group gives the expense part of each
--   balance). It reads expense_payers (several payers) and flips refunds, like group_balances.
--   Totals and charts read it.
-- * spending_summary(in_group, from_day, to_day, in_currency): the viewer's totals per group,
--   month and category (group spend, paid, share, payments made and received), in each group's
--   currency or all converted into one at each expense's own date. Same rules as
--   spendingSummary in packages/core.
-- * search_money(...): live expenses and payments across the viewer's groups (or one group),
--   matched on description, notes, comments, people and amount, with filters, newest first,
--   keyset paged.
-- * deleted_items(in_group, ...): a group's deleted expenses and payments, most recently deleted
--   first, with who deleted them.
-- * friend_activity(friend, ...): the feed entries that involve both the viewer and a friend.
-- See docs/adr/0017-search-and-spending-totals-in-sql.md.

create extension if not exists pg_trgm with schema extensions;

create index expenses_description_trgm_idx on public.expenses
  using gin (description extensions.gin_trgm_ops);
create index expenses_notes_trgm_idx on public.expenses
  using gin (notes extensions.gin_trgm_ops) where notes is not null;
create index settlements_note_trgm_idx on public.settlements
  using gin (note extensions.gin_trgm_ops) where note is not null;
create index comments_body_trgm_idx on public.comments
  using gin (body extensions.gin_trgm_ops) where expense_id is not null and deleted_at is null;
create index comments_settlement_body_trgm_idx on public.comments
  using gin (body extensions.gin_trgm_ops) where settlement_id is not null and deleted_at is null;

-- The person filter on the activity feed pages by (actor_id, created_at). The old single
-- column index is a prefix of this one.
create index activity_actor_id_created_at_idx on public.activity (actor_id, created_at desc, id desc);
drop index if exists public.activity_actor_id_idx;

-- Who deleted an expense or payment, and the friend feed, look entries up by what they are about.
create index activity_subject_id_idx on public.activity (subject_id, created_at desc);

-- Ledger -------------------------------------------------------------------------------------

create view public.expense_ledger with (security_invoker = true) as
-- Same rules as group_balances (20261113091955_expense_entry.sql): the amount is converted once,
-- spread over the payers by what each paid and over the split by each share (largest remainder,
-- ties by user id, both times), and a refund flips both signs. Every step carries group_id and
-- partitions its windows by (group_id, id), so a filter on group_id or expense_id reaches the
-- base tables instead of running after the windows.
with totals as not materialized (
  select
    e.id,
    e.group_id,
    e.spent_at,
    e.category,
    g.currency::text as currency,
    case when e.is_refund then -1 else 1 end as sign,
    private.convert_minor(e.amount_cents, e.fx_rate, e.currency::text, g.currency::text) as total
  from public.expenses e
  join public.groups g on g.id = e.group_id
  where e.deleted_at is null
),
split_parts as not materialized (
  select
    t.id,
    t.group_id,
    t.spent_at,
    t.category,
    t.currency,
    t.sign,
    t.total,
    s.user_id,
    div(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as base,
    mod(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as rem
  from totals t
  join public.expense_splits s on s.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
split_shares as not materialized (
  select
    p.group_id,
    p.id,
    p.spent_at,
    p.category,
    p.currency,
    p.sign,
    p.total,
    p.user_id,
    p.base + case
      when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
        <= p.total::numeric - sum(p.base) over (partition by p.group_id, p.id)
      then 1 else 0
    end as share
  from split_parts p
),
-- What each person paid, from expense_payers, spread the same way.
payer_parts as not materialized (
  select
    t.id,
    t.group_id,
    t.spent_at,
    t.category,
    t.currency,
    t.sign,
    t.total,
    x.user_id,
    div(t.total::numeric * x.paid_cents::numeric, sum(x.paid_cents) over w) as base,
    mod(t.total::numeric * x.paid_cents::numeric, sum(x.paid_cents) over w) as rem
  from totals t
  join public.expense_payers x on x.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
payer_shares as not materialized (
  select
    p.group_id,
    p.id,
    p.spent_at,
    p.category,
    p.currency,
    p.sign,
    p.total,
    p.user_id,
    p.base + case
      when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
        <= p.total::numeric - sum(p.base) over (partition by p.group_id, p.id)
      then 1 else 0
    end as paid
  from payer_parts p
),
lines as not materialized (
  select s.group_id, s.id, s.spent_at, s.category, s.currency, s.sign, s.total, s.user_id,
    0::numeric as paid, s.share
  from split_shares s
  union all
  select p.group_id, p.id, p.spent_at, p.category, p.currency, p.sign, p.total, p.user_id,
    p.paid, 0::numeric
  from payer_shares p
)
select
  l.group_id,
  l.id as expense_id,
  l.user_id,
  l.spent_at,
  l.category,
  l.currency,
  (l.sign * l.total)::bigint as total_cents,
  (l.sign * sum(l.paid))::bigint as paid_cents,
  (l.sign * sum(l.share))::bigint as share_cents
from lines l
group by l.group_id, l.id, l.user_id, l.spent_at, l.category, l.currency, l.sign, l.total;

comment on view public.expense_ledger is
  'Per expense and person: paid and share in group currency (live expenses only).';

revoke all on table public.expense_ledger from anon, authenticated;
grant select on table public.expense_ledger to authenticated;
grant select on table public.expense_ledger to service_role;

-- Totals -------------------------------------------------------------------------------------

-- The rate the Spending view converts with. The direct rate (or inverse) as private.fx_rate
-- finds it, else the two legs through USD, then EUR, multiplied and rounded to 12 places. Only
-- for totals shown in another currency: saving an expense or a payment, and every balance, keep
-- using private.fx_rate and never triangulate. Same rule as spendingRate in packages/core.
create or replace function private.insights_fx_rate(from_currency char(3), to_currency char(3), on_day date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result numeric := private.fx_rate(from_currency, to_currency, on_day);
  base char(3);
  first_leg numeric;
  second_leg numeric;
begin
  if result is not null then
    return result;
  end if;
  foreach base in array array['USD', 'EUR']::char(3)[] loop
    continue when base = from_currency or base = to_currency;
    first_leg := private.fx_rate(from_currency, base, on_day);
    second_leg := private.fx_rate(base, to_currency, on_day);
    if first_leg is not null and second_leg is not null then
      return round(first_leg * second_leg, 12);
    end if;
  end loop;
  return null;
end;
$$;

-- Only spending_summary (running as the owner) calls it.
revoke execute on function private.insights_fx_rate(char, char, date) from public, anon, authenticated;

create or replace function public.spending_summary(
  in_group uuid default null,
  from_day date default null,
  to_day date default null,
  in_currency text default null
)
returns table (
  group_id uuid,
  currency text,
  month date,
  category text,
  expense_count int,
  spend_cents bigint,
  paid_cents bigint,
  share_cents bigint,
  payments_made_cents bigint,
  payments_received_cents bigint,
  unconverted_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gids uuid[];
  tz text;
  target text := upper(nullif(btrim(spending_summary.in_currency), ''));
begin
  if spending_summary.in_group is not null then
    perform private.require_member(spending_summary.in_group);
    gids := array[spending_summary.in_group];
  else
    gids := array(select private.my_group_ids());
  end if;
  if from_day is not null and to_day is not null and from_day > to_day then
    raise exception using message = 'invalid_date_range', detail = 'The start date is after the end date', errcode = '22023';
  end if;
  if target is not null and target !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Pick a currency', errcode = '22023';
  end if;
  tz := private.user_time_zone(uid);

  -- With in_currency, every amount (already in its group's currency) is converted once more, at
  -- the rate on or before that expense's date (a payment's day for payments), with the lookup
  -- and rounding expenses use when they are saved, plus private.insights_fx_rate's step through
  -- a common base when two currencies have no rate between them. Amounts with no rate are left
  -- out and counted in unconverted_count.
  return query
  with ledger as (
    select
      l.*,
      row_number() over (partition by l.group_id, l.expense_id order by l.user_id) = 1 as first_line
    from public.expense_ledger l
    where l.group_id = any (gids)
      and (spending_summary.from_day is null or l.spent_at >= spending_summary.from_day)
      and (spending_summary.to_day is null or l.spent_at <= spending_summary.to_day)
  ),
  lines as (
    select
      x.group_id,
      x.currency,
      date_trunc('month', x.spent_at)::date as month,
      coalesce(x.category, 'other') as category,
      x.user_id,
      x.first_line,
      x.total_cents,
      x.paid_cents,
      x.share_cents,
      case
        when target is null or target = x.currency then 1::numeric
        else private.insights_fx_rate(x.currency::char(3), target::char(3), x.spent_at)
      end as rate
    from ledger x
    where x.first_line or x.user_id = uid
  ),
  payments as (
    select
      st.group_id,
      g.currency::text as currency,
      (st.settled_at at time zone tz)::date as day,
      st.from_user,
      st.to_user,
      private.convert_minor(st.amount_cents, st.fx_rate, st.currency::text, g.currency::text) as amount
    from public.settlements st
    join public.groups g on g.id = st.group_id
    where st.group_id = any (gids)
      and st.deleted_at is null
      and (st.from_user = uid or st.to_user = uid)
  ),
  payment_lines as (
    select
      p.*,
      case
        when target is null or target = p.currency then 1::numeric
        else private.insights_fx_rate(p.currency::char(3), target::char(3), p.day)
      end as rate
    from payments p
    where (spending_summary.from_day is null or p.day >= spending_summary.from_day)
      and (spending_summary.to_day is null or p.day <= spending_summary.to_day)
  )
  select
    x.group_id,
    x.currency,
    x.month,
    x.category,
    sum(x.expense_count)::int,
    sum(x.spend_cents)::bigint,
    sum(x.paid_cents)::bigint,
    sum(x.share_cents)::bigint,
    sum(x.payments_made_cents)::bigint,
    sum(x.payments_received_cents)::bigint,
    sum(x.unconverted_count)::int
  from (
    select
      l.group_id,
      coalesce(target, l.currency) as currency,
      l.month,
      l.category,
      -- Converted expenses only; the rest are in unconverted_count.
      count(*) filter (where l.first_line and l.rate is not null) as expense_count,
      coalesce(sum(private.convert_minor(l.total_cents, l.rate, l.currency, coalesce(target, l.currency)))
        filter (where l.first_line and l.rate is not null), 0) as spend_cents,
      coalesce(sum(private.convert_minor(l.paid_cents, l.rate, l.currency, coalesce(target, l.currency)))
        filter (where l.user_id = uid and l.rate is not null), 0) as paid_cents,
      coalesce(sum(private.convert_minor(l.share_cents, l.rate, l.currency, coalesce(target, l.currency)))
        filter (where l.user_id = uid and l.rate is not null), 0) as share_cents,
      0::bigint as payments_made_cents,
      0::bigint as payments_received_cents,
      count(*) filter (where l.first_line and l.rate is null) as unconverted_count
    from lines l
    group by l.group_id, l.currency, l.month, l.category
    union all
    select
      p.group_id,
      coalesce(target, p.currency),
      date_trunc('month', p.day)::date,
      null::text,
      0,
      0,
      0,
      0,
      coalesce(sum(private.convert_minor(p.amount, p.rate, p.currency, coalesce(target, p.currency)))
        filter (where p.from_user = uid and p.rate is not null), 0),
      coalesce(sum(private.convert_minor(p.amount, p.rate, p.currency, coalesce(target, p.currency)))
        filter (where p.to_user = uid and p.rate is not null), 0),
      count(*) filter (where p.rate is null)
    from payment_lines p
    group by p.group_id, p.currency, date_trunc('month', p.day)
  ) x
  group by x.group_id, x.currency, x.month, x.category
  order by x.month, x.group_id, x.category nulls last;
end;
$$;

comment on function public.spending_summary(uuid, date, date, text) is
  'The viewer''s spending per group, month and category, in group currency or converted into in_currency at each expense''s date. Payment rows have no category.';

revoke execute on function public.spending_summary(uuid, date, date, text) from public, anon;
grant execute on function public.spending_summary(uuid, date, date, text) to authenticated, service_role;

-- Search -------------------------------------------------------------------------------------

create or replace function public.search_money(
  query text default null,
  in_group uuid default null,
  person uuid default null,
  from_day date default null,
  to_day date default null,
  categories text[] default null,
  kinds text[] default null,
  before_day date default null,
  before_at timestamptz default null,
  before_id uuid default null,
  max_rows int default 50
)
returns table (
  kind text,
  id uuid,
  group_id uuid,
  day date,
  at timestamptz,
  description text,
  category text,
  amount_cents bigint,
  currency text,
  group_currency text,
  group_amount_cents bigint,
  paid_by uuid,
  to_user uuid,
  created_by uuid,
  my_paid_cents bigint,
  my_share_cents bigint,
  deleted_at timestamptz,
  matched text,
  snippet text,
  payers uuid[],
  is_refund boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gids uuid[];
  q text := nullif(btrim(coalesce(search_money.query, '')), '');
  pat text;
  amount_text text;
  amounts numeric[];
  tz text;
  lim int := least(greatest(coalesce(search_money.max_rows, 50), 1), 100);
  want_expenses boolean := search_money.kinds is null or 'expense' = any (search_money.kinds);
  want_payments boolean := (search_money.kinds is null or 'payment' = any (search_money.kinds))
    and search_money.categories is null;
begin
  if search_money.in_group is not null then
    perform private.require_member(search_money.in_group);
    gids := array[search_money.in_group];
  else
    gids := array(select private.my_group_ids());
  end if;
  if from_day is not null and to_day is not null and from_day > to_day then
    raise exception using message = 'invalid_date_range', detail = 'The start date is after the end date', errcode = '22023';
  end if;
  if char_length(q) > 200 then
    raise exception using message = 'invalid_query', detail = 'Search for something shorter', errcode = '22023';
  end if;
  if (before_id is null) <> (before_day is null) or (before_id is null) <> (before_at is null) then
    raise exception using message = 'invalid_cursor', detail = 'A page cursor needs a day, a time and an id', errcode = '22023';
  end if;
  tz := private.user_time_zone(uid);

  if q is not null then
    pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- "12.50", "12,50", "$12.50", "12.50 EUR": an amount in the expense's own currency. Three
    -- digits after the separator also read as thousands ("1,000", "2.500"). A reading only
    -- matches a currency with at least as many minor units as it has decimals.
    if q ~* '^[^0-9a-z]{0,3}\s*[0-9]{1,12}([.,][0-9]{1,3})?\s*([a-z]{3}|[^0-9a-z]{0,3})$' then
      amount_text := substring(q from '[0-9]{1,12}(?:[.,][0-9]{1,3})?');
      amounts := array[replace(amount_text, ',', '.')::numeric];
      if amount_text ~ '[.,][0-9]{3}$' then
        amounts := amounts || translate(amount_text, '.,', '')::numeric;
      end if;
    end if;
  end if;

  return query
  with hits as (
    select e.id, 1 as rank, 'description'::text as matched, null::text as snippet
    from public.expenses e
    where q is not null and e.group_id = any (gids) and e.description ilike pat
    union all
    select e.id, 2, 'notes', e.notes
    from public.expenses e
    where q is not null and e.group_id = any (gids) and e.notes ilike pat
    union all
    select c.expense_id, 3, 'comment', c.body
    from public.comments c
    where q is not null
      and c.group_id = any (gids)
      and c.expense_id is not null
      and c.deleted_at is null
      and c.body ilike pat
    union all
    select x.expense_id, 4, 'person', p.display_name
    from public.expense_payers x
    join public.expenses e on e.id = x.expense_id
    join public.profiles p on p.id = x.user_id
    where q is not null and e.group_id = any (gids) and p.display_name ilike pat
    union all
    select s.expense_id, 4, 'person', p.display_name
    from public.expense_splits s
    join public.expenses e on e.id = s.expense_id
    join public.profiles p on p.id = s.user_id
    where q is not null and e.group_id = any (gids) and p.display_name ilike pat
    union all
    select e.id, 5, 'amount', null
    from public.expenses e
    where amounts is not null
      and e.group_id = any (gids)
      and exists (
        select 1 from unnest(amounts) a
        where scale(a) <= private.minor_units(e.currency::text)
          and e.amount_cents = a * power(10::numeric, private.minor_units(e.currency::text))
      )
  ),
  best as (
    select distinct on (h.id) h.id, h.matched, h.snippet
    from hits h
    order by h.id, h.rank
  ),
  payment_comments as (
    select distinct on (c.settlement_id) c.settlement_id, c.body
    from public.comments c
    where q is not null
      and c.group_id = any (gids)
      and c.settlement_id is not null
      and c.deleted_at is null
      and c.body ilike pat
    order by c.settlement_id, c.created_at, c.id
  ),
  expense_rows as (
    select
      'expense'::text as kind,
      e.id,
      e.group_id,
      e.spent_at as day,
      e.created_at as at,
      e.description,
      e.category,
      e.amount_cents,
      e.currency::text as currency,
      g.currency::text as group_currency,
      private.convert_minor(e.amount_cents, e.fx_rate, e.currency::text, g.currency::text) as group_amount_cents,
      e.paid_by,
      null::uuid as to_user,
      e.created_by,
      e.deleted_at,
      b.matched,
      b.snippet,
      -- Everyone who paid, most first (or who got a refund).
      array(
        select x.user_id from public.expense_payers x
        where x.expense_id = e.id
        order by x.paid_cents desc, x.user_id
      ) as payers,
      e.is_refund
    from public.expenses e
    join public.groups g on g.id = e.group_id
    left join best b on b.id = e.id
    where want_expenses
      and e.group_id = any (gids)
      and (q is null or b.id is not null)
      and e.deleted_at is null
      and (search_money.categories is null or coalesce(e.category, 'other') = any (search_money.categories))
      and (
        search_money.person is null
        or exists (
          select 1 from public.expense_payers x
          where x.expense_id = e.id and x.user_id = search_money.person
        )
        or exists (
          select 1 from public.expense_splits s
          where s.expense_id = e.id and s.user_id = search_money.person
        )
      )
  ),
  payment_rows as (
    select
      'payment'::text as kind,
      st.id,
      st.group_id,
      (st.settled_at at time zone tz)::date as day,
      st.settled_at as at,
      st.note as description,
      null::text as category,
      st.amount_cents,
      st.currency::text as currency,
      g.currency::text as group_currency,
      private.convert_minor(st.amount_cents, st.fx_rate, st.currency::text, g.currency::text) as group_amount_cents,
      st.from_user as paid_by,
      st.to_user,
      st.created_by,
      st.deleted_at,
      case
        when q is null then null
        when st.note ilike pat then 'notes'
        when pc.body is not null then 'comment'
        when pf.display_name ilike pat or pt.display_name ilike pat then 'person'
        when exists (
          select 1 from unnest(amounts) a
          where scale(a) <= private.minor_units(st.currency::text)
            and st.amount_cents = a * power(10::numeric, private.minor_units(st.currency::text))
        ) then 'amount'
      end as matched,
      case
        when q is not null and st.note ilike pat then null
        when pc.body is not null then pc.body
        when q is not null and pf.display_name ilike pat then pf.display_name
        when q is not null and pt.display_name ilike pat then pt.display_name
      end as snippet,
      array[st.from_user] as payers,
      false as is_refund
    from public.settlements st
    join public.groups g on g.id = st.group_id
    join public.profiles pf on pf.id = st.from_user
    join public.profiles pt on pt.id = st.to_user
    left join payment_comments pc on pc.settlement_id = st.id
    where want_payments
      and st.group_id = any (gids)
      and st.deleted_at is null
      and (
        search_money.person is null
        or st.from_user = search_money.person
        or st.to_user = search_money.person
      )
  ),
  page as (
    select u.*
    from (
      select * from expense_rows
      union all
      select * from payment_rows where q is null or payment_rows.matched is not null
    ) u
    where (search_money.from_day is null or u.day >= search_money.from_day)
      and (search_money.to_day is null or u.day <= search_money.to_day)
      and (
        search_money.before_id is null
        or (u.day, u.at, u.id) < (search_money.before_day, search_money.before_at, search_money.before_id)
      )
    order by u.day desc, u.at desc, u.id desc
    limit lim
  )
  select
    pg.kind,
    pg.id,
    pg.group_id,
    pg.day,
    pg.at,
    pg.description,
    pg.category,
    pg.amount_cents,
    pg.currency,
    pg.group_currency,
    pg.group_amount_cents,
    pg.paid_by,
    pg.to_user,
    pg.created_by,
    mine.paid_cents,
    mine.share_cents,
    pg.deleted_at,
    pg.matched,
    pg.snippet,
    pg.payers,
    pg.is_refund
  from page pg
  left join lateral (
    select l.paid_cents, l.share_cents
    from public.expense_ledger l
    where pg.kind = 'expense'
      and l.group_id = pg.group_id
      and l.expense_id = pg.id
      and l.user_id = uid
    -- Keeps this a per-row subquery, so the group and expense ids reach the ledger's window
    -- functions instead of the ledger being computed for every group first.
    offset 0
  ) mine on true
  order by pg.day desc, pg.at desc, pg.id desc;
end;
$$;

comment on function public.search_money(text, uuid, uuid, date, date, text[], text[], date, timestamptz, uuid, integer) is
  'Expenses and payments in the viewer''s groups matching a query and filters, newest first. Page with before_day, before_at, before_id.';

revoke execute on function public.search_money(text, uuid, uuid, date, date, text[], text[], date, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_money(text, uuid, uuid, date, date, text[], text[], date, timestamptz, uuid, integer) to authenticated, service_role;

-- Recently deleted ---------------------------------------------------------------------------

create or replace function public.deleted_items(
  in_group uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_rows int default 50
)
returns table (
  kind text,
  id uuid,
  group_id uuid,
  day date,
  description text,
  category text,
  amount_cents bigint,
  currency text,
  paid_by uuid,
  to_user uuid,
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  payers uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  tz text;
  lim int := least(greatest(coalesce(deleted_items.max_rows, 50), 1), 100);
begin
  perform private.require_member(deleted_items.in_group);
  if (deleted_items.before_at is null) <> (deleted_items.before_id is null) then
    raise exception using message = 'invalid_cursor', detail = 'A page cursor needs a time and an id', errcode = '22023';
  end if;
  tz := private.user_time_zone(uid);

  return query
  select
    d.kind,
    d.id,
    d.group_id,
    d.day,
    d.description,
    d.category,
    d.amount_cents,
    d.currency,
    d.paid_by,
    d.to_user,
    d.created_by,
    d.deleted_at,
    who.actor_id,
    d.payers
  from (
    select
      'expense'::text as kind,
      e.id,
      e.group_id,
      e.spent_at as day,
      e.description,
      e.category,
      e.amount_cents,
      e.currency::text as currency,
      e.paid_by,
      null::uuid as to_user,
      e.created_by,
      e.deleted_at,
      array(select x.user_id from public.expense_payers x where x.expense_id = e.id) as payers
    from public.expenses e
    where e.group_id = deleted_items.in_group and e.deleted_at is not null
    union all
    select
      'payment',
      st.id,
      st.group_id,
      (st.settled_at at time zone tz)::date,
      st.note,
      null,
      st.amount_cents,
      st.currency::text,
      st.from_user,
      st.to_user,
      st.created_by,
      st.deleted_at,
      array[st.from_user]
    from public.settlements st
    where st.group_id = deleted_items.in_group and st.deleted_at is not null
  ) d
  left join lateral (
    -- The latest delete in the feed for this row is who deleted it.
    select a.actor_id
    from public.activity a
    where a.subject_id = d.id
      and a.verb = case d.kind when 'expense' then 'expense.deleted' else 'settlement.deleted' end
    order by a.created_at desc
    limit 1
  ) who on true
  where deleted_items.before_id is null
     or (d.deleted_at, d.id) < (deleted_items.before_at, deleted_items.before_id)
  order by d.deleted_at desc, d.id desc
  limit lim;
end;
$$;

comment on function public.deleted_items(uuid, timestamptz, uuid, integer) is
  'A group''s deleted expenses and payments, most recently deleted first, with who deleted each.';

revoke execute on function public.deleted_items(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.deleted_items(uuid, timestamptz, uuid, integer) to authenticated, service_role;

-- Activity with a friend ---------------------------------------------------------------------

create or replace function public.friend_activity(
  friend uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_rows int default 30
)
returns table (
  id uuid,
  group_id uuid,
  actor_id uuid,
  verb text,
  subject_id uuid,
  data jsonb,
  created_at timestamptz,
  actor_info jsonb,
  group_info jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gids uuid[] := array(select private.my_group_ids());
  lim int := least(greatest(coalesce(friend_activity.max_rows, 30), 1), 100);
begin
  if friend_activity.friend is null or friend_activity.friend = uid then
    raise exception using message = 'invalid_friend', detail = 'Pick someone other than yourself', errcode = '22023';
  end if;
  if (friend_activity.before_at is null) <> (friend_activity.before_id is null) then
    raise exception using message = 'invalid_cursor', detail = 'A page cursor needs a time and an id', errcode = '22023';
  end if;

  -- Both people paid for (expense_payers) or share in the expense (for expense entries and
  -- comments on one), the payment is between them (and comments on it), or it happened in their
  -- one-to-one tab.
  return query
  select
    a.id,
    a.group_id,
    a.actor_id,
    a.verb,
    a.subject_id,
    a.data,
    a.created_at,
    case when p.id is null then null else
      jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
    end,
    jsonb_build_object('id', g.id, 'name', g.name, 'emoji', g.emoji, 'is_direct', g.is_direct)
  from public.activity a
  join public.groups g on g.id = a.group_id
  left join public.profiles p on p.id = a.actor_id
  where a.group_id = any (gids)
    and (
      friend_activity.before_id is null
      or (a.created_at, a.id) < (friend_activity.before_at, friend_activity.before_id)
    )
    and (
      (
        -- Their one-to-one tab, minus the bookkeeping of setting it up.
        g.is_direct
        and a.verb not like 'member.%'
        and a.verb not like 'group.%'
        and exists (
          select 1 from public.group_members m
          where m.group_id = g.id and m.user_id = friend_activity.friend
        )
      )
      or (
        (a.verb like 'settlement.%' or (a.verb = 'comment.created' and a.data ? 'settlement_id'))
        and exists (
          select 1 from public.settlements st
          where st.id = case
              when a.verb = 'comment.created' then private.try_uuid(a.data ->> 'settlement_id')
              else a.subject_id
            end
            and (
              (st.from_user = uid and st.to_user = friend_activity.friend)
              or (st.from_user = friend_activity.friend and st.to_user = uid)
            )
        )
      )
      or (
        (a.verb like 'expense.%' or (a.verb = 'comment.created' and a.data ? 'expense_id'))
        and exists (
          select 1
          from public.expenses e
          where e.id = case
              when a.verb = 'comment.created' then private.try_uuid(a.data ->> 'expense_id')
              else a.subject_id
            end
            and (
              exists (select 1 from public.expense_payers x where x.expense_id = e.id and x.user_id = uid)
              or exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.user_id = uid)
            )
            and (
              exists (
                select 1 from public.expense_payers x
                where x.expense_id = e.id and x.user_id = friend_activity.friend
              )
              or exists (
                select 1 from public.expense_splits s
                where s.expense_id = e.id and s.user_id = friend_activity.friend
              )
            )
        )
      )
    )
  order by a.created_at desc, a.id desc
  limit lim;
end;
$$;

comment on function public.friend_activity(uuid, timestamptz, uuid, integer) is
  'Feed entries that involve both the viewer and a friend, newest first.';

revoke execute on function public.friend_activity(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.friend_activity(uuid, timestamptz, uuid, integer) to authenticated, service_role;
