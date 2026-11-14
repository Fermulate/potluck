-- Settling up works across a block, for both people. ADR 19 froze a 1:1 tab for the blocked side,
-- payments included; payments are now left out of that freeze, so either of them can record,
-- edit, delete or restore a payment, in a tab as in a shared group, and the two can square up.
-- Expenses, repeating expenses and comments in the tab stay frozen for the blocked side, and no
-- new expense names both of them anywhere (20261114154849_block_shared_expenses.sql).
-- Restoring a deleted expense that names two people with a block between them is refused like
-- creating one: `blocked_person` in a group, `not_a_friend` in a 1:1 tab.
--
-- Redefined (each body copied from schema/current.sql, as noted above it):
--   private.freeze_blocked_direct_money, public.import_expenses, public.restore_expense.

-- Body as in 20261113201107_friends_and_blocks.sql (live copy in schema/current.sql) plus: payments
-- (settlements) are no longer frozen for the blocked side of a 1:1 tab.
CREATE OR REPLACE FUNCTION "private"."freeze_blocked_direct_money"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  uid uuid := auth.uid();
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  gid uuid;
begin
  -- Payments are how the two square up, so they always go through.
  if uid is null or private.claiming() or tg_table_name = 'settlements' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'comments' then
    gid := coalesce(
      (select x.group_id from public.expenses x where x.id = (row ->> 'expense_id')::uuid),
      (select e.group_id from public.events e where e.id = (row ->> 'event_id')::uuid),
      (select s.group_id from public.settlements s where s.id = (row ->> 'settlement_id')::uuid),
      (row ->> 'group_id')::uuid
    );
  else
    gid := (row ->> 'group_id')::uuid;
  end if;
  if tg_table_name = 'recurring_expenses' and tg_op = 'UPDATE'
     and (to_jsonb(old) ->> 'active')::boolean and not (to_jsonb(new) ->> 'active')::boolean then
    return new;
  end if;
  if exists (select 1 from public.groups g where g.id = gid and g.is_direct)
     and exists (
       select 1 from public.blocks b
       join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
       where b.blocked_id = uid
     ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Body as in 20261114154849_block_shared_expenses.sql (live copy in schema/current.sql) plus: the
-- blocked side of a 1:1 tab is refused only when the import has an expense row; payments import.
CREATE OR REPLACE FUNCTION "public"."import_expenses"("group_id" "uuid", "rows" "jsonb", "source" "text" DEFAULT 'csv'::"text", "batch_id" "uuid" DEFAULT NULL::"uuid", "fingerprint" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "enable_nestloop" TO 'off'
    AS $_$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid := import_expenses.group_id;
  v_source text := lower(coalesce(nullif(btrim(import_expenses.source), ''), 'csv'));
  g public.groups;
  my_role public.group_role;
  all_rows jsonb := '[]'::jsonb;
  total integer;
  bad record;
  pay record;
  err_detail text;
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
  my_role := private.require_member(gid);
  perform private.require_unarchived(gid);
  select * into g from public.groups x where x.id = gid;

  -- A 1:1 tab across a block is frozen for the blocked side (ADR 19), payments aside: said once
  -- here, before any row is read, with the answer private.freeze_blocked_direct_money gives every
  -- expense it stops. An import of payments alone goes through.
  if g.is_direct and exists (
    select 1 from public.blocks b
    join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
    where b.blocked_id = uid
  ) and exists (
    select 1 from jsonb_array_elements(all_rows) x
    where jsonb_typeof(x) <> 'object' or (x ->> 'kind') is distinct from 'payment'
  ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;

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
  -- Expense rows naming two people (payers or shares, money on each) with a block between them.
  blocked_rows as (
    select distinct a.ord
    from private.import_people a
    join public.blocks k on k.blocker_id = a.user_id
    join private.import_people b on b.run = a.run and b.ord = a.ord and b.user_id = k.blocked_id
    where a.run = v_run and a.cents > 0 and b.cents > 0
  ),
  failures as (
    select ord, 1.0 as step, 'invalid_import' as code, 'Each row is an expense or a payment' as detail, '22023' as state
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
    -- Payments: private.check_payment's checks, in its order (amount above, members at 15).
    select ord, 6, 'invalid_parties', 'A payment needs two different people', '22023' from checked
    where kind = 'payment' and (from_user is null or to_user is null or from_user = to_user)
    union all
    select ord, 6.5, 'not_a_party', 'Only owners and admins can record a payment between two other people', '42501'
    from checked
    where kind = 'payment' and my_role = 'member' and from_user is not null and to_user is not null
      and uid is distinct from from_user and uid is distinct from to_user
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
    -- As private.require_no_blocked_pair, which save_expense calls next.
    select ord, 14.5,
      case when g.is_direct then 'not_a_friend' else 'blocked_person' end,
      case when g.is_direct then 'You can only split with friends'
        else 'Some people in this expense cannot share one; take one of them out' end,
      case when g.is_direct then '42501' else '23514' end
    from checked where kind = 'expense' and ord in (select x.ord from blocked_rows x)
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

  for pay in
    select i.ord, i.from_user, i.to_user, i.amount from private.import_input i
    where i.run = v_run and i.kind = 'payment' order by i.ord
  loop
    begin
      perform private.check_payment(gid, my_role, pay.from_user, pay.to_user, pay.amount);
    exception when others then
      get stacked diagnostics err_detail = pg_exception_detail;
      raise exception using
        message = sqlerrm, detail = err_detail, hint = format('import_row:%s', pay.ord), errcode = sqlstate;
    end;
  end loop;

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
         i.note, private.payment_time(i.day), uid
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
$_$;

-- Body as in 20261113091955_expense_entry.sql (live copy in schema/current.sql) plus the blocked
-- pair check: a restored expense is a new one as far as a block goes.
CREATE OR REPLACE FUNCTION "public"."restore_expense"("id" "uuid") RETURNS "public"."expenses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  gid uuid := (select x.group_id from public.expenses x where x.id = restore_expense.id);
  e public.expenses;
begin
  if gid is not null then
    perform 1 from public.groups g where g.id = gid for share;
    perform private.require_member(gid);
  end if;
  e := private.editable_expense(restore_expense.id);

  if e.deleted_at is null then
    return e;
  end if;

  if exists (
    select s.user_id from public.expense_splits s where s.expense_id = e.id and s.share_cents > 0
    union
    select p.user_id from public.expense_payers p where p.expense_id = e.id
    union
    select e.paid_by
    except
    select m.user_id from public.group_members m where m.group_id = e.group_id
  ) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  -- Back on the books is new as far as a block goes: no two people in it may have one between them.
  perform private.require_no_blocked_pair(e.group_id, array(
    select s.user_id from public.expense_splits s where s.expense_id = e.id and s.share_cents > 0
    union
    select p.user_id from public.expense_payers p where p.expense_id = e.id and p.paid_cents > 0
  ));

  update public.expenses x set deleted_at = null where x.id = e.id returning * into e;
  return e;
end;
$$;
