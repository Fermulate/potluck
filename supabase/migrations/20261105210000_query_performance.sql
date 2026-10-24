-- Query performance. Same results, less work. Measured with
-- supabase/snippets/perf_volume.sql, numbers in docs/dogfood/performance.md.
--
-- 1. Money helpers become inlinable. A `set search_path` clause stops Postgres
--    from inlining a SQL function and turns every call into a full function
--    call with a GUC change (about 85 microseconds each). group_balances
--    called convert_minor several times per split row, which made a
--    200-expense group take 700 ms. SQL-standard bodies (`return ...`) are
--    parsed and bound when the function is created, so the search path of the
--    caller cannot change what they resolve to, and the planner inlines them
--    into plain arithmetic. Same-currency conversions skip the minor-unit
--    lookup (power(10, 0) = 1, so the result is unchanged).
-- 2. expense_splits read policy drops a redundant group check. It already
--    requires the parent expense to be visible, and the expense read policy
--    applies inside that subquery (it is RLS-protected for the caller too), so
--    the second my_group_ids() test only repeated it for every split row.
-- 3. Member read policies use `= any (array(select ...))` instead of
--    `in (select ...)`. Both run the helper once per statement, but the array
--    form is an index condition: queries across all my groups (activity feed,
--    past events, balances) read my rows through the group_id indexes instead
--    of filtering every row in the table.
-- 4. simplified_debts reads group_balances once instead of twice.

create or replace function private.minor_units(currency text)
returns int
language sql
immutable
parallel safe
return case upper(currency)
    when 'BIF' then 0 when 'CLP' then 0 when 'DJF' then 0 when 'GNF' then 0
    when 'ISK' then 0 when 'JPY' then 0 when 'KMF' then 0 when 'KRW' then 0
    when 'PYG' then 0 when 'RWF' then 0 when 'UGX' then 0 when 'UYI' then 0
    when 'VND' then 0 when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
    when 'XPF' then 0
    when 'BHD' then 3 when 'IQD' then 3 when 'JOD' then 3 when 'KWD' then 3
    when 'LYD' then 3 when 'OMR' then 3 when 'TND' then 3
    else 2
  end;

create or replace function private.convert_minor(amount bigint, rate numeric, from_currency text, to_currency text)
returns bigint
language sql
immutable
parallel safe
return case
    when from_currency = to_currency then round(amount::numeric * rate::numeric(18, 8))::bigint
    else round(
      amount::numeric * rate::numeric(18, 8)
      * power(10::numeric, private.minor_units(to_currency) - private.minor_units(from_currency))
    )::bigint
  end;

-- Visible splits are the splits of visible expenses.
alter policy "expense_splits: members read" on public.expense_splits
  using (exists (select 1 from public.expenses e where e.id = expense_id));

alter policy "groups: members read" on public.groups
  using (id = any (array(select private.my_group_ids())));

alter policy "group_members: members read" on public.group_members
  using (group_id = any (array(select private.my_group_ids())));

alter policy "expenses: members read" on public.expenses
  using (group_id = any (array(select private.my_group_ids())));

alter policy "recurring_expenses: members read" on public.recurring_expenses
  using (group_id = any (array(select private.my_group_ids())));

alter policy "settlements: members read" on public.settlements
  using (group_id = any (array(select private.my_group_ids())));

alter policy "events: members read" on public.events
  using (group_id = any (array(select private.my_group_ids())));

alter policy "availability: members read" on public.availability
  using (event_id = any (array(select private.my_event_ids())));

alter policy "availability_requests: members read" on public.availability_requests
  using (event_id = any (array(select private.my_event_ids())));

alter policy "event_rsvps: members read" on public.event_rsvps
  using (event_id = any (array(select private.my_event_ids())));

alter policy "activity: members read" on public.activity
  using (group_id = any (array(select private.my_group_ids())));

alter policy "comments: members read" on public.comments
  using (group_id = any (array(select private.my_group_ids())));

create or replace function public.simplified_debts(group_id uuid)
returns table (from_user uuid, to_user uuid, amount_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  creditors uuid[];
  credits bigint[];
  debtors uuid[];
  debts bigint[];
  ci int;
  di int;
  pay bigint;
begin
  perform private.require_member(simplified_debts.group_id);

  select
    coalesce(array_agg(b.user_id order by b.user_id) filter (where b.net_cents > 0), '{}'),
    coalesce(array_agg(b.net_cents order by b.user_id) filter (where b.net_cents > 0), '{}'),
    coalesce(array_agg(b.user_id order by b.user_id) filter (where b.net_cents < 0), '{}'),
    coalesce(array_agg(-b.net_cents order by b.user_id) filter (where b.net_cents < 0), '{}')
  into creditors, credits, debtors, debts
  from public.group_balances b
  where b.group_id = simplified_debts.group_id;

  loop
    -- Largest remaining creditor and debtor; arrays are in user id order, so
    -- strict > keeps the smallest id on ties.
    ci := null;
    for i in 1 .. coalesce(cardinality(credits), 0) loop
      if credits[i] > 0 and (ci is null or credits[i] > credits[ci]) then
        ci := i;
      end if;
    end loop;

    di := null;
    for i in 1 .. coalesce(cardinality(debts), 0) loop
      if debts[i] > 0 and (di is null or debts[i] > debts[di]) then
        di := i;
      end if;
    end loop;

    exit when ci is null or di is null;

    pay := least(credits[ci], debts[di]);
    credits[ci] := credits[ci] - pay;
    debts[di] := debts[di] - pay;

    from_user := debtors[di];
    to_user := creditors[ci];
    amount_cents := pay;
    return next;
  end loop;
end;
$$;
