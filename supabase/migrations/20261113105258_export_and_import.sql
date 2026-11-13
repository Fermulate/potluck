-- Export, backup and import (ADR 18).
--
-- import_expenses(group_id, rows, source, batch_id, fingerprint) writes a whole file of expenses
-- and payments into one group in one transaction: every row or none. A file too big for one
-- request is sent ahead in parts with import_stage(batch_id, group_id, rows) (into
-- private.import_rows) and written by the import_expenses call that names the batch, so up to
-- 5,000 rows are one all or nothing write (the app splits a longer file into several imports).
--
-- The rows are checked and written as sets, not one save_expense call each, so a full file runs
-- in well under PostgREST's statement timeout. The checks are the ones save_expense makes when it
-- creates an exact split with a payers list: description, amount, currency, payers (valid, one per
-- person, adding up, members), split (valid, one per person, adding up, members), a rate into the
-- group currency for the day. Payments are checked like settle_up, but between any two members
-- and on the day the file gives. A row may carry `fx_rate` (the rate a Potluck file was written
-- with, or one the person typed); otherwise the day's stored rate is used, as for any expense.
-- A rate a row brings is bounded: its currency must be one Potluck has rates for, it must lie
-- between a fifth and five times the nearest stored rate for the pair (or carry
-- `fx_rate_confirmed`, which the app sets only after the person says the outlier is right), and
-- no row may come to more than 100,000,000,000 minor units in the group currency.
-- The first failing row stops everything; the error keeps save_expense's code and carries the row
-- in its hint (`import_row:<n>`, counting from 1).
--
-- While an import runs, `potluck.importing` holds the group id for the rest of the transaction.
-- Two new before insert triggers drop the per row activity and notifications it would cause
-- (also the expense notifications the deferred trigger writes at commit), so the group gets
-- one `expenses.imported` activity entry instead of hundreds of lines and pushes.
--
-- export_my_data(): the viewer's whole account as one JSON document (format `potluck-backup`,
-- version 1, documented in docs/backup-format.md). Rates are decimal text, like every read.

-- Holding back per row side effects -----------------------------------------------------------

create or replace function private.hold_import_activity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.group_id::text = current_setting('potluck.importing', true)
     and new.verb <> 'expenses.imported' then
    return null;
  end if;
  return new;
end;
$$;

create or replace function private.hold_import_notifications() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.data ->> 'group_id' = current_setting('potluck.importing', true) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function private.hold_import_activity() from public, anon, authenticated;
revoke execute on function private.hold_import_notifications() from public, anon, authenticated;

create trigger activity_hold_during_import
  before insert on public.activity
  for each row execute function private.hold_import_activity();

create trigger notifications_hold_during_import
  before insert on public.notifications
  for each row execute function private.hold_import_notifications();

-- Imported expenses skip the per row work an import would throw away anyway: the activity line
-- and the notification (the hold triggers above would drop them) and the lone payer row the
-- import replaces. Same triggers and functions as before, plus a WHEN clause, which Postgres
-- checks without calling the function. If a later migration recreates one of them without it,
-- imports stay quiet through the hold triggers, only slower.
create or replace trigger expenses_activity
  after insert or update on public.expenses
  for each row
  when (current_setting('potluck.importing', true) is distinct from new.group_id::text)
  execute function private.expenses_activity();

create or replace trigger expenses_sync_single_payer
  after insert or update of amount_cents, paid_by on public.expenses
  for each row
  when (current_setting('potluck.importing', true) is distinct from new.group_id::text)
  execute function private.sync_single_payer();

drop trigger expenses_notify on public.expenses;
create constraint trigger expenses_notify
  after insert on public.expenses
  deferrable initially deferred
  for each row
  when (current_setting('potluck.importing', true) is distinct from new.group_id::text)
  execute function private.expenses_notify();

-- Parsing helpers that never raise (an exception block per row would be a subtransaction each) --

-- A YYYY-MM-DD day, or null for anything else (2026-02-30 included).
create or replace function private.import_day(t text) returns date
language sql immutable parallel safe set search_path = '' as $$
  select case
    when t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then null
    when substr(t, 1, 4)::int < 1 or substr(t, 6, 2)::int not between 1 and 12 then null
    when substr(t, 9, 2)::int not between 1 and extract(day from
      make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, 1) + interval '1 month' - interval '1 day')::int then null
    else t::date
  end
$$;

create or replace function private.import_uuid(t text) returns uuid
language sql immutable parallel safe set search_path = '' as $$
  select case
    when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid
  end
$$;

-- Whole minor units from a JSON number between `low` and 100,000,000,000, else null.
create or replace function private.import_cents(j jsonb, low bigint) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select case
    when j is null or jsonb_typeof(j) <> 'number' then null
    when (j #>> '{}')::numeric <> trunc((j #>> '{}')::numeric) then null
    when (j #>> '{}')::numeric not between low and 100000000000 then null
    else (j #>> '{}')::bigint
  end
$$;

-- A positive rate with at most 12 digits either side of the point (numeric(24,12)), else null.
create or replace function private.import_rate(t text) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case
    when t is null or t !~ '^\d{1,12}(\.\d{1,12})?$' then null
    when t::numeric <= 0 then null
    else t::numeric
  end
$$;

revoke execute on function private.import_day(text) from public, anon, authenticated;
revoke execute on function private.import_uuid(text) from public, anon, authenticated;
revoke execute on function private.import_cents(jsonb, bigint) from public, anon, authenticated;
revoke execute on function private.import_rate(text) from public, anon, authenticated;

-- Files sent in parts ------------------------------------------------------------------------

create table private.import_batches (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index import_batches_group_id_idx on private.import_batches (group_id);
create index import_batches_created_by_idx on private.import_batches (created_by);
create index import_batches_created_at_idx on private.import_batches (created_at);

create table private.import_rows (
  batch_id uuid not null references private.import_batches (id) on delete cascade,
  position integer not null,
  row jsonb not null,
  primary key (batch_id, position)
);

revoke all on private.import_batches, private.import_rows from public, anon, authenticated;

-- Working tables for one import_expenses call, keyed by a random run id and emptied before it
-- returns (a failed call rolls its rows back). Unlogged: nothing here outlives the transaction.
create unlogged table private.import_input (
  run uuid not null,
  ord integer not null,
  kind text,
  day date,
  description text,
  amount bigint,
  currency text,
  category text,
  notes text,
  note text,
  is_refund boolean,
  rate_given boolean,
  rate numeric,
  rate_confirmed boolean,
  from_user uuid,
  to_user uuid,
  payers jsonb,
  splits jsonb,
  eid uuid not null,
  primary key (run, ord)
);

create unlogged table private.import_people (
  run uuid not null,
  ord integer not null,
  role text not null,
  pos integer not null,
  user_id uuid,
  cents bigint,
  primary key (run, ord, role, pos)
);

create unlogged table private.import_payer (
  run uuid not null,
  ord integer not null,
  user_id uuid not null,
  primary key (run, ord)
);

create unlogged table private.import_rates (
  run uuid not null,
  currency text not null,
  day date not null,
  rate numeric,
  near numeric,
  known boolean not null,
  primary key (run, currency, day)
);

revoke all on private.import_input, private.import_people, private.import_payer, private.import_rates
  from public, anon, authenticated;

-- Adds up to 2,000 rows to a batch the caller started in this group. Nothing is written to the
-- group until import_expenses names the batch. Batches older than an hour are dropped (also by the
-- purge-import-batches job), and starting a fourth drops the caller's oldest.
create or replace function public.import_stage(batch_id uuid, group_id uuid, rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  staged integer;
  incoming integer;
begin
  if import_stage.batch_id is null then
    raise exception using message = 'invalid_import', detail = 'An import needs an id', errcode = '22023';
  end if;
  if import_stage.rows is null or jsonb_typeof(import_stage.rows) <> 'array'
     or jsonb_array_length(import_stage.rows) = 0 then
    raise exception using message = 'invalid_import', detail = 'There is nothing to import', errcode = '22023';
  end if;
  incoming := jsonb_array_length(import_stage.rows);
  if incoming > 2000 then
    raise exception using message = 'import_too_large', detail = 'Send at most 2000 rows at a time', errcode = '22023';
  end if;

  perform private.require_member(import_stage.group_id);
  perform private.require_unarchived(import_stage.group_id);

  delete from private.import_batches b where b.created_at < now() - interval '1 hour';
  if not exists (select 1 from private.import_batches b where b.id = import_stage.batch_id) then
    delete from private.import_batches b
    where b.created_by = uid
      and b.id not in (
        select x.id from private.import_batches x where x.created_by = uid
        order by x.created_at desc, x.id limit 2
      );
  end if;
  insert into private.import_batches (id, group_id, created_by)
  values (import_stage.batch_id, import_stage.group_id, uid)
  on conflict (id) do nothing;
  if not exists (
    select 1 from private.import_batches b
    where b.id = import_stage.batch_id and b.group_id = import_stage.group_id and b.created_by = uid
  ) then
    raise exception using message = 'invalid_import', detail = 'That import belongs to someone else', errcode = '22023';
  end if;

  select count(*) into staged from private.import_rows r where r.batch_id = import_stage.batch_id;
  if staged + incoming > 5000 then
    raise exception using message = 'import_too_large', detail = 'Import at most 5000 rows at a time', errcode = '22023';
  end if;

  insert into private.import_rows (batch_id, position, row)
  select import_stage.batch_id, staged + e.ord, e.elem
  from jsonb_array_elements(import_stage.rows) with ordinality as e (elem, ord);

  return staged + incoming;
end;
$$;

revoke execute on function public.import_stage(uuid, uuid, jsonb) from public, anon;

-- Parts of an import nobody finished (a closed tab, a lost connection) go after an hour.
select cron.schedule('purge-import-batches', '*/15 * * * *',
  $$delete from private.import_batches where created_at < now() - interval '1 hour'$$);
grant execute on function public.import_stage(uuid, uuid, jsonb) to authenticated, service_role;

-- Import -------------------------------------------------------------------------------------

create or replace function public.import_expenses(
  group_id uuid,
  rows jsonb,
  source text default 'csv',
  batch_id uuid default null,
  fingerprint text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
-- The working tables have no statistics (they are empty between calls), so the planner would
-- join their thousands of rows one by one. Hash joins keep a full file to a second or two.
set enable_nestloop = off
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid := import_expenses.group_id;
  v_source text := lower(coalesce(nullif(btrim(import_expenses.source), ''), 'csv'));
  g public.groups;
  all_rows jsonb := '[]'::jsonb;
  total integer;
  bad record;
  n_expenses integer;
  n_payments integer;
  v_run uuid := gen_random_uuid();
begin
  if v_source not in ('splitwise', 'potluck', 'csv') then
    raise exception using message = 'invalid_import', detail = 'Unknown import source', errcode = '22023';
  end if;
  if import_expenses.batch_id is not null then
    if not exists (
      select 1 from private.import_batches b
      where b.id = import_expenses.batch_id and b.group_id = gid and b.created_by = uid
    ) then
      raise exception using message = 'invalid_import', detail = 'That import is gone; choose the file again', errcode = '22023';
    end if;
    select coalesce(jsonb_agg(r.row order by r.position), '[]'::jsonb) into all_rows
    from private.import_rows r where r.batch_id = import_expenses.batch_id;
  end if;
  if import_expenses.rows is not null and jsonb_typeof(import_expenses.rows) <> 'null' then
    if jsonb_typeof(import_expenses.rows) <> 'array' then
      raise exception using message = 'invalid_import', detail = 'Rows must be a list', errcode = '22023';
    end if;
    all_rows := all_rows || import_expenses.rows;
  end if;
  total := jsonb_array_length(all_rows);
  if total = 0 then
    raise exception using message = 'invalid_import', detail = 'There is nothing to import', errcode = '22023';
  end if;
  if total > 5000 then
    raise exception using message = 'import_too_large', detail = 'Import at most 5000 rows at a time', errcode = '22023';
  end if;

  -- Group row first, then membership, before any expense or payment row (lock order).
  perform 1 from public.groups x where x.id = gid for share;
  perform private.require_member(gid);
  perform private.require_unarchived(gid);
  select * into g from public.groups x where x.id = gid;

  -- Every row read once.
  insert into private.import_input (
    run, ord, kind, day, description, amount, currency, category, notes, note, is_refund,
    rate_given, rate, rate_confirmed, from_user, to_user, payers, splits, eid
  )
  select
    v_run,
    e.ord::integer as ord,
    e.kind,
    private.import_day(case e.kind when 'payment' then e.elem ->> 'paid_on' else e.elem ->> 'spent_at' end) as day,
    left(btrim(coalesce(e.elem ->> 'description', '')), 120) as description,
    private.import_cents(e.elem -> 'amount_cents', 1) as amount,
    upper(coalesce(nullif(btrim(e.elem ->> 'currency'), ''), g.currency)) as currency,
    left(nullif(btrim(e.elem ->> 'category'), ''), 40) as category,
    left(nullif(e.elem ->> 'notes', ''), 2000) as notes,
    left(nullif(btrim(e.elem ->> 'note'), ''), 500) as note,
    coalesce(jsonb_typeof(e.elem -> 'is_refund') = 'boolean' and (e.elem -> 'is_refund') = 'true'::jsonb, false) as is_refund,
    coalesce(jsonb_typeof(e.elem -> 'fx_rate'), 'null') <> 'null' as rate_given,
    private.import_rate(e.elem ->> 'fx_rate') as rate,
    coalesce(jsonb_typeof(e.elem -> 'fx_rate_confirmed') = 'boolean' and (e.elem -> 'fx_rate_confirmed') = 'true'::jsonb, false) as rate_confirmed,
    private.import_uuid(e.elem ->> 'from_user') as from_user,
    private.import_uuid(e.elem ->> 'to_user') as to_user,
    e.elem -> 'payers' as payers,
    e.elem -> 'splits' as splits,
    gen_random_uuid() as eid
  from (
    select x.elem, x.ord,
           case when jsonb_typeof(x.elem) = 'object' then x.elem ->> 'kind' end as kind
    from jsonb_array_elements(all_rows) with ordinality as x (elem, ord)
  ) e;

  insert into private.import_people (run, ord, role, pos, user_id, cents)
  select v_run, i.ord, 'payer', p.pos,
         case when jsonb_typeof(p.elem) = 'object' then private.import_uuid(p.elem ->> 'user_id') end as user_id,
         case when jsonb_typeof(p.elem) = 'object' then private.import_cents(p.elem -> 'paid_cents', 0) end as cents
  from private.import_input i,
       jsonb_array_elements(case when jsonb_typeof(i.payers) = 'array' then i.payers else '[]'::jsonb end)
         with ordinality as p (elem, pos)
  where i.run = v_run and i.kind = 'expense'
  union all
  select v_run, i.ord, 'share', s.pos,
         case when jsonb_typeof(s.elem) = 'object' then private.import_uuid(s.elem ->> 'user_id') end,
         case when jsonb_typeof(s.elem) = 'object' then private.import_cents(s.elem -> 'share_cents', 0) end
  from private.import_input i,
       jsonb_array_elements(case when jsonb_typeof(i.splits) = 'array' then i.splits else '[]'::jsonb end)
         with ordinality as s (elem, pos)
  where i.run = v_run and i.kind = 'expense';

  -- Whoever paid the most is paid_by (ties: the smaller id), as save_expense sets it.
  insert into private.import_payer (run, ord, user_id)
  select distinct on (p.ord) v_run, p.ord, p.user_id
  from private.import_people p
  where p.run = v_run and p.role = 'payer' and p.cents > 0
  order by p.ord, p.cents desc, p.user_id;

  -- The rate each row is converted at: 1 in the group currency, else the one the row carries,
  -- else the stored rate for its day (one lookup per currency and day).
  insert into private.import_rates (run, currency, day, rate, near, known)
  select v_run, d.currency, d.day,
         private.fx_rate(d.currency::char(3), g.currency, d.day),
         (select n.rate from (
            select f.rate, f.day, 0 as inverse from public.fx_rates f
            where f.base = d.currency and f.quote = g.currency
            union all
            select round(1 / f.rate, 12), f.day, 1 from public.fx_rates f
            where f.base = g.currency and f.quote = d.currency
          ) n order by abs(n.day - d.day), n.day desc, n.inverse limit 1),
         exists (select 1 from public.fx_rates f where f.base = d.currency or f.quote = d.currency)
  from (
    select distinct i.currency, i.day from private.import_input i
    where i.run = v_run and i.currency ~ '^[A-Z]{3}$' and i.currency <> g.currency and i.day is not null
  ) d;

  -- The first row that fails, checked in the order save_expense and settle_up check.
  with
  people as (
    select x.ord, x.role,
           count(*) as n,
           count(*) filter (where x.user_id is null or x.cents is null) as invalid,
           count(distinct x.user_id) as distinct_users,
           coalesce(sum(x.cents), 0) as total,
           count(*) filter (where x.cents > 0) as positive,
           count(*) filter (where x.cents > 0 and not exists (
             select 1 from public.group_members m where m.group_id = gid and m.user_id = x.user_id
           )) as outsiders
    from private.import_people x
    where x.run = v_run
    group by x.ord, x.role
  ),
  checked as (
    select i.*, p.n as payer_n, p.invalid as payer_invalid, p.distinct_users as payer_distinct,
           p.total as paid_total, p.positive as payer_positive, p.outsiders as payer_outsiders,
           s.n as share_n, s.invalid as share_invalid, s.distinct_users as share_distinct,
           s.total as share_total, s.outsiders as share_outsiders,
           r.rate as stored_rate, r.near as near_rate, coalesce(r.known, true) as known,
           case when i.currency = g.currency then 1 when i.rate_given then i.rate else r.rate end as fx
    from private.import_input i
    left join people p on p.ord = i.ord and p.role = 'payer'
    left join people s on s.ord = i.ord and s.role = 'share'
    left join private.import_rates r on r.run = v_run and r.currency = i.currency and r.day = i.day
    where i.run = v_run
  ),
  failures as (
    select ord, 1 as step, 'invalid_import' as code, 'Each row is an expense or a payment' as detail, '22023' as state
    from checked where kind is null or kind not in ('expense', 'payment')
    union all
    select ord, 2, 'invalid_import', 'Every row needs a date', '22023' from checked
    where kind in ('expense', 'payment') and day is null
    union all
    select ord, 3, 'description_required', 'Add a description', '22023' from checked
    where kind = 'expense' and description = ''
    union all
    select ord, 4, 'invalid_amount', 'Enter an amount greater than zero', '22023' from checked
    where kind in ('expense', 'payment') and amount is null
    union all
    select ord, 5, 'invalid_currency', 'Unknown currency code', '22023' from checked
    where kind in ('expense', 'payment') and (currency !~ '^[A-Z]{3}$' or not known)
    union all
    select ord, 6, 'invalid_recipient', 'Say who paid whom', '22023' from checked
    where kind = 'payment' and (from_user is null or to_user is null or from_user = to_user)
    union all
    select ord, 7, 'invalid_payers', 'Who paid is not valid', '22023' from checked
    where kind = 'expense' and (jsonb_typeof(payers) is distinct from 'array' or coalesce(payer_n, 0) = 0
      or payer_n > 100 or payer_invalid > 0 or payer_distinct <> payer_n or payer_positive = 0)
    union all
    select ord, 8, 'payers_sum_mismatch', format('Payers add up to %s but the expense is %s', paid_total, amount), '22023'
    from checked where kind = 'expense' and amount is not null and paid_total <> amount
    union all
    select ord, 9, 'payer_not_in_group', 'The payer is not in this group', '23514' from checked
    where kind = 'expense' and payer_outsiders > 0
    union all
    select ord, 10, 'splits_required', 'Add at least one person to the split', '22023' from checked
    where kind = 'expense' and (jsonb_typeof(splits) is distinct from 'array' or coalesce(share_n, 0) = 0)
    union all
    select ord, 11, 'invalid_splits', 'The split is not valid', '22023' from checked
    where kind = 'expense' and share_invalid > 0
    union all
    select ord, 12, 'duplicate_user', 'A person appears twice in the split', '22023' from checked
    where kind = 'expense' and share_invalid = 0 and share_distinct <> share_n
    union all
    select ord, 13, 'splits_sum_mismatch', format('Splits add up to %s but the expense is %s', share_total, amount), '22023'
    from checked where kind = 'expense' and amount is not null and share_n > 0 and share_total <> amount
    union all
    select ord, 14, 'split_member_not_in_group', 'Everyone in the split must be in the group', '23514' from checked
    where kind = 'expense' and share_outsiders > 0
    union all
    select ord, 15, 'member_not_in_group', 'Both people must be in the group', '23514' from checked
    where kind = 'payment' and from_user is not null and to_user is not null and (
      select count(*) from public.group_members m
      where m.group_id = gid and m.user_id in (checked.from_user, checked.to_user)
    ) <> 2
    union all
    select ord, 16, 'invalid_import', 'The rate is not valid', '22023' from checked
    where kind in ('expense', 'payment') and rate_given and rate is null
    union all
    select ord, 17, 'fx_rate_out_of_range',
      case when near_rate is null
        then format('Potluck has no %s to %s rate to compare %s with', currency, g.currency, rate)
        else format('The rate %s is far from %s, the nearest rate Potluck has', rate, trim_scale(near_rate)) end,
      '23514'
    from checked where kind in ('expense', 'payment') and currency <> g.currency and rate_given
      and rate is not null and not rate_confirmed
      and (near_rate is null or rate < near_rate * 0.2 or rate > near_rate * 5)
    union all
    select ord, 18, 'fx_rate_unavailable', format('No exchange rate from %s to %s yet', currency, g.currency), '23514'
    from checked where kind in ('expense', 'payment') and currency ~ '^[A-Z]{3}$' and currency <> g.currency
      and day is not null and not rate_given and stored_rate is null
    union all
    select ord, 19, 'invalid_amount', format('%s %s is too much in %s', amount, currency, g.currency), '22023'
    from checked where kind in ('expense', 'payment') and amount is not null and fx is not null
      -- As private.convert_minor, without its bigint cast (a wild rate would overflow it).
      and amount * fx * power(10::numeric, private.minor_units(g.currency) - private.minor_units(currency))
        > 100000000000
  )
  select f.ord, f.code, f.detail, f.state into bad from failures f order by f.ord, f.step limit 1;

  if bad.ord is not null then
    raise exception using
      message = bad.code,
      detail = bad.detail,
      hint = format('import_row:%s', bad.ord),
      errcode = bad.state;
  end if;

  perform set_config('potluck.importing', gid::text, true);
  -- The rows below are written one statement per table; the sum checks run at commit.
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check,
    public.expenses_payers_sum_check, public.expense_payers_sum_check deferred;

  insert into public.expenses (
    id, group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
    category, notes, spent_at, created_by, is_refund
  )
  select
    i.eid, gid, i.description, i.amount, i.currency,
    case when i.currency = g.currency then 1 when i.rate_given then i.rate else r.rate end,
    pp.user_id,
    'exact', i.category, i.notes, i.day, uid, i.is_refund
  from private.import_input i
  join private.import_payer pp on pp.run = v_run and pp.ord = i.ord
  left join private.import_rates r on r.run = v_run and r.currency = i.currency and r.day = i.day
  where i.run = v_run and i.kind = 'expense'
  order by i.ord;
  get diagnostics n_expenses = row_count;

  -- The insert wrote paid_by as the only payer (expenses_sync_single_payer); write them all.
  delete from public.expense_payers x
  using private.import_input i
  where i.run = v_run and i.kind = 'expense' and x.expense_id = i.eid;
  insert into public.expense_payers (expense_id, user_id, paid_cents)
  select i.eid, p.user_id, p.cents
  from private.import_input i
  join private.import_people p on p.run = v_run and p.ord = i.ord and p.role = 'payer'
  where i.run = v_run and i.kind = 'expense' and p.cents > 0;
  insert into public.expense_splits (expense_id, user_id, share_cents)
  select i.eid, s.user_id, s.cents
  from private.import_input i
  join private.import_people s on s.run = v_run and s.ord = i.ord and s.role = 'share'
  where i.run = v_run and i.kind = 'expense' and s.cents > 0;

  insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
  select gid, i.from_user, i.to_user, i.amount, i.currency,
         case when i.currency = g.currency then 1 when i.rate_given then i.rate else r.rate end,
         i.note, (i.day + time '12:00') at time zone 'UTC', uid
  from private.import_input i
  left join private.import_rates r on r.run = v_run and r.currency = i.currency and r.day = i.day
  where i.run = v_run and i.kind = 'payment'
  order by i.ord;
  get diagnostics n_payments = row_count;

  perform private.log_activity(gid, uid, 'expenses.imported', null, jsonb_strip_nulls(jsonb_build_object(
    'expenses', n_expenses,
    'payments', n_payments,
    'source', v_source,
    'fingerprint', left(nullif(btrim(import_expenses.fingerprint), ''), 128)
  )));

  if import_expenses.batch_id is not null then
    delete from private.import_batches b where b.id = import_expenses.batch_id;
  end if;
  delete from private.import_input x where x.run = v_run;
  delete from private.import_people x where x.run = v_run;
  delete from private.import_payer x where x.run = v_run;
  delete from private.import_rates x where x.run = v_run;

  return jsonb_build_object('expenses', n_expenses, 'payments', n_payments);
end;
$$;

revoke execute on function public.import_expenses(uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function public.import_expenses(uuid, jsonb, text, uuid, text) to authenticated, service_role;

-- Backup -------------------------------------------------------------------------------------

-- One group as the backup lists it. Called only by export_my_data for the caller's own groups.
create or replace function private.export_group(gid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'emoji', g.emoji,
    'color', g.color,
    'currency', g.currency,
    'is_direct', g.is_direct,
    'simplify_debts', g.simplify_debts,
    'members_can_invite', g.members_can_invite,
    'default_split', g.default_split,
    'created_by', g.created_by,
    'created_at', g.created_at,
    'archived_at', g.archived_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at)
                       order by m.joined_at, m.user_id)
      from public.group_members m where m.group_id = g.id), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'description', e.description,
        'amount_cents', e.amount_cents,
        'currency', e.currency,
        'fx_rate', e.fx_rate::text,
        'is_refund', e.is_refund,
        'split_type', e.split_type,
        'category', e.category,
        'notes', e.notes,
        'spent_at', e.spent_at,
        'tax_cents', e.tax_cents,
        'tip_cents', e.tip_cents,
        'discount_cents', e.discount_cents,
        'event_id', e.event_id,
        'recurring_id', e.recurring_id,
        'receipt_path', e.receipt_path,
        'created_by', e.created_by,
        'created_at', e.created_at,
        'updated_at', e.updated_at,
        'deleted_at', e.deleted_at,
        'payers', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'paid_cents', p.paid_cents)
                           order by p.paid_cents desc, p.user_id)
          from public.expense_payers p where p.expense_id = e.id), '[]'::jsonb),
        'splits', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'share_cents', s.share_cents,
                             'weight', s.weight::text, 'adjustment_cents', s.adjustment_cents)
                           order by s.user_id)
          from public.expense_splits s where s.expense_id = e.id), '[]'::jsonb),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('position', it.position, 'description', it.description,
                             'amount_cents', it.amount_cents, 'user_ids', to_jsonb(it.user_ids))
                           order by it.position)
          from public.expense_items it where it.expense_id = e.id), '[]'::jsonb),
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'body', c.body,
                             'created_at', c.created_at)
                           order by c.created_at, c.id)
          from public.comments c where c.expense_id = e.id and c.deleted_at is null), '[]'::jsonb)
      ) order by e.spent_at, e.created_at, e.id)
      from public.expenses e where e.group_id = g.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'from_user', s.from_user,
        'to_user', s.to_user,
        'amount_cents', s.amount_cents,
        'currency', s.currency,
        'fx_rate', s.fx_rate::text,
        'note', s.note,
        'settled_at', s.settled_at,
        'created_by', s.created_by,
        'created_at', s.created_at,
        'deleted_at', s.deleted_at
      ) order by s.settled_at, s.id)
      from public.settlements s where s.group_id = g.id), '[]'::jsonb),
    'recurring', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'description', x.description,
        'amount_cents', x.amount_cents,
        'currency', x.currency,
        'paid_by', x.paid_by,
        'payers', x.payers,
        'split_type', x.split_type,
        'splits', x.splits,
        'category', x.category,
        'recurrence', x.recurrence,
        'next_run_on', x.next_run_on,
        'active', x.active,
        'created_by', x.created_by,
        'created_at', x.created_at
      ) order by x.created_at, x.id)
      from public.recurring_expenses x where x.group_id = g.id), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'description', ev.description,
        'location', ev.location,
        'emoji', ev.emoji,
        'status', ev.status,
        'timezone', ev.timezone,
        'window_start', ev.window_start,
        'window_end', ev.window_end,
        'day_start_minute', ev.day_start_minute,
        'day_end_minute', ev.day_end_minute,
        'slot_minutes', ev.slot_minutes,
        'duration_minutes', ev.duration_minutes,
        'min_attendees', ev.min_attendees,
        'starts_at', ev.starts_at,
        'ends_at', ev.ends_at,
        'rsvp_deadline', ev.rsvp_deadline,
        'created_by', ev.created_by,
        'created_at', ev.created_at,
        'rsvps', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', rv.user_id, 'status', rv.status, 'updated_at', rv.updated_at)
                           order by rv.user_id)
          from public.event_rsvps rv where rv.event_id = ev.id), '[]'::jsonb),
        'availability', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'slot_start', a.slot_start, 'level', a.level)
                           order by a.user_id, a.slot_start)
          from public.availability a where a.event_id = ev.id), '[]'::jsonb),
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'body', c.body,
                             'created_at', c.created_at)
                           order by c.created_at, c.id)
          from public.comments c where c.event_id = ev.id and c.deleted_at is null), '[]'::jsonb)
      ) order by ev.created_at, ev.id)
      from public.events ev where ev.group_id = g.id), '[]'::jsonb)
  )
  from public.groups g
  where g.id = gid;
$$;

revoke execute on function private.export_group(uuid) from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  gids uuid[];
begin
  select coalesce(array_agg(m.group_id), '{}') into gids
  from public.group_members m where m.user_id = uid;

  return jsonb_build_object(
    'format', 'potluck-backup',
    'version', 1,
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'email', (select u.email from auth.users u where u.id = p.id),
        'avatar_path', p.avatar_path,
        'timezone', p.timezone,
        'default_currency', p.default_currency,
        'locale', p.locale,
        'created_at', p.created_at
      )
      from public.profiles p where p.id = uid
    ),
    -- Everyone the file mentions, so names survive people leaving or closing their account.
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name,
                         'deleted', p.deleted_at is not null) order by p.id)
      from public.profiles p
      where p.id in (
        select m.user_id from public.group_members m where m.group_id = any (gids)
        union select x.user_id from public.expense_payers x
          join public.expenses e on e.id = x.expense_id where e.group_id = any (gids)
        union select x.user_id from public.expense_splits x
          join public.expenses e on e.id = x.expense_id where e.group_id = any (gids)
        union select s.from_user from public.settlements s where s.group_id = any (gids)
        union select s.to_user from public.settlements s where s.group_id = any (gids)
        union select c.author_id from public.comments c where c.group_id = any (gids)
        union select f.friend_id from public.friendships f where f.user_id = uid
        union select uid
      )
    ), '[]'::jsonb),
    'friends', coalesce((
      select jsonb_agg(f.friend_id order by f.friend_id)
      from public.friendships f where f.user_id = uid
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(private.export_group(g.id) order by g.created_at, g.id)
      from public.groups g where g.id = any (gids)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated, service_role;
