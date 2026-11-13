-- Expense entry, Splitwise parity batch 1 (ADR 12):
--   * several payers per expense (`expense_payers`), `expenses.paid_by` kept as whoever paid most;
--   * refunds (`expenses.is_refund`): the payers received the money, signs flip in balances;
--   * the adjustment split (`expense_splits.adjustment_cents`);
--   * by-item bills stored as entered (`expense_items` plus tax, tip and discount on expenses);
--   * a saved default split per group (`groups.default_split`, `set_default_split`);
--   * `create_expense_v2` / `update_expense_v2` take the new keys; v1 ignores them.
--   * the monthly summary and expense.deleted / expense.restored (ADR 11) count every payer.
-- Everything is additive. Every existing expense gets one payer row from `paid_by`.

-- Columns ---------------------------------------------------------------------------------------

alter table public.expenses
  add column is_refund boolean not null default false,
  add column tax_cents bigint check (tax_cents >= 0 and tax_cents <= 100000000000),
  add column tip_cents bigint check (tip_cents >= 0 and tip_cents <= 100000000000),
  add column discount_cents bigint check (discount_cents >= 0 and discount_cents <= 100000000000);

comment on column public.expenses.paid_by is
  'Whoever paid the most (ties: smaller id). Every payer and amount is in expense_payers.';
comment on column public.expenses.is_refund is
  'Money coming back: the payers received amount_cents and the people in the split are credited.';
comment on column public.expenses.tax_cents is 'By-item expenses: tax as entered.';
comment on column public.expenses.tip_cents is 'By-item expenses: tip as entered.';
comment on column public.expenses.discount_cents is 'By-item expenses: discount as entered.';

alter table public.expense_splits add column adjustment_cents bigint
  check (adjustment_cents between -100000000000 and 100000000000);
comment on column public.expense_splits.adjustment_cents is
  'Adjustment splits: the +/- on top of an equal share, for display and re-deriving.';

alter table public.recurring_expenses add column payers jsonb
  check (payers is null or jsonb_typeof(payers) = 'array');
comment on column public.recurring_expenses.payers is
  'Several payers as [{user_id, paid_cents}]; null means paid_by paid it all.';

alter table public.groups add column default_split jsonb
  check (default_split is null or jsonb_typeof(default_split) = 'object');
comment on column public.groups.default_split is
  'Where new expenses start: {split_type, splits: [{user_id, weight}]}. Set with set_default_split.';

-- expense_payers --------------------------------------------------------------------------------

create table public.expense_payers (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  paid_cents bigint not null check (paid_cents > 0 and paid_cents <= 100000000000),
  primary key (expense_id, user_id)
);
comment on table public.expense_payers is
  'Who paid an expense (or received a refund) and how much, in the expense currency. Sums to amount_cents.';
create index expense_payers_user_id_idx on public.expense_payers (user_id);

alter table public.expense_payers enable row level security;
revoke all on public.expense_payers from anon, authenticated;
grant select (expense_id, user_id, paid_cents) on public.expense_payers to authenticated;
grant all on public.expense_payers to service_role;

create policy "expense_payers: members read"
on public.expense_payers for select
to authenticated
using (
  exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and e.group_id = any (array(select private.my_group_ids()))
  )
);

insert into public.expense_payers (expense_id, user_id, paid_cents)
select e.id, e.paid_by, e.amount_cents from public.expenses e;

-- expense_items ---------------------------------------------------------------------------------

create table public.expense_items (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  position smallint not null check (position >= 0 and position < 200),
  description text not null default '' check (char_length(description) <= 80),
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  user_ids uuid[] not null check (cardinality(user_ids) between 1 and 100),
  primary key (expense_id, position)
);
comment on table public.expense_items is
  'Line items of a by-item expense as entered, so editing reopens them. Shares live in expense_splits.';

alter table public.expense_items enable row level security;
revoke all on public.expense_items from anon, authenticated;
grant select (expense_id, position, description, amount_cents, user_ids) on public.expense_items to authenticated;
grant all on public.expense_items to service_role;

create policy "expense_items: members read"
on public.expense_items for select
to authenticated
using (
  exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and e.group_id = any (array(select private.my_group_ids()))
  )
);

-- Payer integrity -------------------------------------------------------------------------------

-- An expense written with one payer (every write that does not send a payers list, and the
-- recurring job) keeps its payer row in step with paid_by and amount_cents. save_expense writes
-- several payers itself, after this has run.
create function private.sync_single_payer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.expense_payers p where p.expense_id = new.id) <= 1 then
    delete from public.expense_payers p where p.expense_id = new.id;
    insert into public.expense_payers (expense_id, user_id, paid_cents)
    values (new.id, new.paid_by, new.amount_cents);
  end if;
  return null;
end;
$$;

create trigger expenses_sync_single_payer
after insert or update of amount_cents, paid_by on public.expenses
for each row execute function private.sync_single_payer();

create function private.check_expense_payers() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  amount bigint;
  total bigint;
begin
  if tg_table_name = 'expenses' then
    eid := new.id;
  elsif tg_op = 'DELETE' then
    eid := old.expense_id;
  else
    eid := new.expense_id;
  end if;

  select e.amount_cents into amount from public.expenses e where e.id = eid;
  if not found then
    return null;
  end if;

  select coalesce(sum(p.paid_cents), 0) into total
  from public.expense_payers p
  where p.expense_id = eid;

  if total <> amount then
    raise exception using
      message = 'payers_sum_mismatch',
      detail = format('Payers add up to %s but the expense is %s', total, amount),
      errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger expense_payers_sum_check
after insert or update or delete on public.expense_payers
deferrable initially deferred
for each row execute function private.check_expense_payers();

create constraint trigger expenses_payers_sum_check
after insert or update of amount_cents on public.expenses
deferrable initially deferred
for each row execute function private.check_expense_payers();

-- Split math ------------------------------------------------------------------------------------

-- Splits with the adjustment column. Adjustment: each person's +/- comes off the top and the
-- rest is split equally, leftover units to the smallest user ids (core `splitAdjustment`).
-- Every other type is `private.compute_splits` unchanged.
create function private.compute_split_rows(amount bigint, kind public.split_type, splits jsonb)
returns table (user_id uuid, share_cents bigint, weight numeric, adjustment_cents bigint)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  uids uuid[];
  adjs bigint[];
  n int;
  rest bigint;
begin
  if kind is distinct from 'adjustment'::public.split_type then
    return query
      select c.user_id, c.share_cents, c.weight, null::bigint
      from private.compute_splits(amount, kind, splits) c;
    return;
  end if;

  if splits is null or jsonb_typeof(splits) <> 'array' or jsonb_array_length(splits) = 0 then
    raise exception using message = 'splits_required', detail = 'Add at least one person to the split', errcode = '22023';
  end if;

  begin
    select
      array_agg((e.elem ->> 'user_id')::uuid order by e.ord),
      array_agg(coalesce((e.elem ->> 'adjustment_cents')::bigint, 0) order by e.ord)
    into uids, adjs
    from jsonb_array_elements(splits) with ordinality as e (elem, ord);
  exception
    when invalid_text_representation or numeric_value_out_of_range or cannot_coerce then
      raise exception using message = 'invalid_splits', detail = 'The split is not valid', errcode = '22023';
  end;

  n := cardinality(uids);
  if array_position(uids, null) is not null then
    raise exception using message = 'invalid_splits', detail = 'Every split needs a person', errcode = '22023';
  end if;
  if (select count(distinct u) from unnest(uids) as u) <> n then
    raise exception using message = 'duplicate_user', detail = 'A person appears twice in the split', errcode = '22023';
  end if;
  if exists (select 1 from unnest(adjs) as a where abs(a) > 100000000000) then
    raise exception using message = 'invalid_splits', detail = 'An adjustment is too large', errcode = '22023';
  end if;

  rest := amount - (select sum(a) from unnest(adjs) as a);
  if rest < 0 then
    raise exception using
      message = 'adjustments_exceed_total',
      detail = format('Adjustments are %s more than the expense', -rest),
      errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select t.a, row_number() over (order by t.u) as rn
      from unnest(uids, adjs) as t (u, a)
    ) r
    where rest / n + case when r.rn <= rest % n then 1 else 0 end + r.a < 0
  ) then
    raise exception using message = 'negative_share', detail = 'An adjustment takes someone below zero', errcode = '22023';
  end if;

  return query
    select r.u, (rest / n + case when r.rn <= rest % n then 1 else 0 end + r.a)::bigint, null::numeric, r.a
    from (
      select t.u, t.a, t.ord, row_number() over (order by t.u) as rn
      from unnest(uids, adjs) with ordinality as t (u, a, ord)
    ) r
    order by r.ord;
end;
$$;

-- A by-item bill: each item is shared equally by its people, then tax and tip (added) and the
-- discount (taken off) follow each person's subtotal. One largest remainder pass over the
-- whole bill, ties by user id (core `splitItemized`). Rows in user id order.
create function private.itemized_splits(items jsonb, tax bigint, tip bigint, discount bigint)
returns table (user_id uuid, share_cents bigint)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  head_lcm numeric := 1;
  k int;
  subtotal bigint;
  total bigint;
  weight_sum numeric;
  people jsonb;
begin
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using message = 'items_required', detail = 'Add at least one item', errcode = '22023';
  end if;
  if jsonb_array_length(items) > 200
     or coalesce(tax, 0) < 0 or coalesce(tip, 0) < 0 or coalesce(discount, 0) < 0
     or exists (
       select 1 from jsonb_array_elements(items) e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e -> 'amount_cents') is distinct from 'number'
          or (e ->> 'amount_cents')::numeric <> trunc((e ->> 'amount_cents')::numeric)
          or (e ->> 'amount_cents')::numeric < 0
          or (e ->> 'amount_cents')::numeric > 100000000000
          or jsonb_typeof(e -> 'user_ids') is distinct from 'array'
          or jsonb_array_length(e -> 'user_ids') = 0
          or jsonb_array_length(e -> 'user_ids') > 100
          or char_length(coalesce(e ->> 'description', '')) > 80
     ) then
    raise exception using message = 'invalid_items', detail = 'An item is not valid', errcode = '22023';
  end if;

  begin
    -- One row per (item, person): the person's exact part of that item, scaled by the lcm of
    -- every item's head count so it stays whole.
    for k in select jsonb_array_length(e -> 'user_ids') from jsonb_array_elements(items) e loop
      head_lcm := lcm(head_lcm, k::numeric);
    end loop;

    if exists (
      select 1 from jsonb_array_elements(items) e
      where (select count(distinct x) from jsonb_array_elements_text(e -> 'user_ids') x)
            <> jsonb_array_length(e -> 'user_ids')
    ) then
      raise exception using message = 'duplicate_user', detail = 'A person appears twice on an item', errcode = '22023';
    end if;

    select jsonb_object_agg(w.u, w.weight) into people
    from (
      select x::uuid as u,
             sum((e ->> 'amount_cents')::numeric * head_lcm / jsonb_array_length(e -> 'user_ids')) as weight
      from jsonb_array_elements(items) e
      cross join lateral jsonb_array_elements_text(e -> 'user_ids') x
      group by x::uuid
    ) w;
  exception
    when invalid_text_representation then
      raise exception using message = 'invalid_items', detail = 'An item is not valid', errcode = '22023';
  end;

  select sum((e ->> 'amount_cents')::bigint) into subtotal from jsonb_array_elements(items) e;
  total := subtotal + coalesce(tax, 0) + coalesce(tip, 0) - coalesce(discount, 0);
  if total < 0 then
    raise exception using message = 'invalid_items', detail = 'The discount is more than the bill', errcode = '22023';
  end if;
  if subtotal = 0 then
    if total > 0 then
      raise exception using message = 'zero_shares', detail = 'At least one person needs a share', errcode = '22023';
    end if;
    return query select j.key::uuid, 0::bigint from jsonb_each(people) j order by j.key::uuid;
    return;
  end if;

  select sum(j.value::numeric) into weight_sum from jsonb_each(people) j;

  return query
  with raw as (
    select j.key::uuid as u,
           div(total::numeric * j.value::numeric, weight_sum)::bigint as base,
           mod(total::numeric * j.value::numeric, weight_sum) as rem
    from jsonb_each(people) j
  ),
  ranked as (
    select r.*, row_number() over (order by r.rem desc, r.u) as rn,
           total - sum(r.base) over () as leftover
    from raw r
  )
  select k2.u, k2.base + case when k2.rn <= k2.leftover then 1 else 0 end
  from ranked k2
  order by k2.u;
end;
$$;

-- Edit history ------------------------------------------------------------------------------------

-- What changed between two versions of an expense row, as {field: {from, to}}, for the
-- `changes` key of an `expense.updated` activity row. The expense page renders each one.
create function private.expense_row_changes(o public.expenses, n public.expenses)
returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.k, jsonb_build_object('from', c.f, 'to', c.t)), '{}'::jsonb)
  from (
    values
      ('description', to_jsonb(o.description), to_jsonb(n.description)),
      ('amount_cents', to_jsonb(o.amount_cents), to_jsonb(n.amount_cents)),
      ('currency', to_jsonb(o.currency), to_jsonb(n.currency)),
      ('spent_at', to_jsonb(o.spent_at), to_jsonb(n.spent_at)),
      ('category', to_jsonb(o.category), to_jsonb(n.category)),
      ('notes', to_jsonb(o.notes), to_jsonb(n.notes)),
      ('is_refund', to_jsonb(o.is_refund), to_jsonb(n.is_refund)),
      ('paid_by', to_jsonb(o.paid_by), to_jsonb(n.paid_by)),
      ('split_type', to_jsonb(o.split_type), to_jsonb(n.split_type)),
      ('receipt', to_jsonb(o.receipt_path is not null), to_jsonb(n.receipt_path is not null)),
      ('event_id', to_jsonb(o.event_id), to_jsonb(n.event_id)),
      ('tax_cents', to_jsonb(o.tax_cents), to_jsonb(n.tax_cents)),
      ('tip_cents', to_jsonb(o.tip_cents), to_jsonb(n.tip_cents)),
      ('discount_cents', to_jsonb(o.discount_cents), to_jsonb(n.discount_cents))
  ) as c (k, f, t)
  where c.f is distinct from c.t;
$$;

-- Saving an expense -----------------------------------------------------------------------------

-- Body as in schema/current.sql plus payers, refunds,
-- the adjustment split and stored items. Keys: `payers` [{user_id, paid_cents}] (else `paid_by`
-- alone, as before), `is_refund`, `items` [{description, amount_cents, user_ids}] with
-- `tax_cents`, `tip_cents`, `discount_cents` (by-item only; the server works out the shares).
create or replace function private.save_expense(eid uuid, payload jsonb)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  my_role public.group_role;
  prev public.expenses;
  g public.groups;
  p jsonb := coalesce(payload, '{}'::jsonb);
  gid uuid;
  v_description text;
  v_amount bigint;
  v_currency text;
  v_fx numeric;
  v_paid_by uuid;
  v_split_type public.split_type;
  v_spent_at date;
  v_receipt text;
  v_event uuid;
  v_recurrence public.recurrence;
  v_refund boolean;
  v_tax bigint;
  v_tip bigint;
  v_discount bigint;
  split_input jsonb;
  rewrite_splits boolean;
  write_items boolean := false;
  computed jsonb;
  result public.expenses;
  recurring uuid;
  old_shares jsonb;
  old_items jsonb;
  new_items jsonb;
  new_shares jsonb;
  old_payers jsonb := '{}'::jsonb;
  new_payers jsonb;
  payers_changed boolean;
  payer_left boolean := false;
  sharer_left boolean := false;
  changes jsonb;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end if;

  if eid is null then
    begin
      gid := (p ->> 'group_id')::uuid;
    exception when invalid_text_representation then
      gid := null;
    end;
    if gid is null then
      raise exception using message = 'group_required', detail = 'Pick a group for this expense', errcode = '22023';
    end if;
    -- Serializes with remove_member and leave_group (group row first, always),
    -- then membership is checked, so a caller removed while waiting is refused.
    perform 1 from public.groups x where x.id = gid for share;
    my_role := private.require_member(gid);
  else
    select e.group_id into gid from public.expenses e where e.id = eid;
    if gid is null then
      raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
    end if;
    perform 1 from public.groups x where x.id = gid for share;
    my_role := private.require_member(gid);

    select * into prev from public.expenses e where e.id = eid for update;
    if prev.id is null then
      raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
    end if;

    select coalesce(jsonb_object_agg(x.user_id, x.paid_cents), '{}'::jsonb) into old_payers
    from public.expense_payers x where x.expense_id = prev.id;

    if my_role = 'member' and uid is distinct from prev.created_by and uid <> prev.paid_by
       and not (old_payers ? uid::text) then
      raise exception using message = 'not_allowed', detail = 'You can only edit your own expenses', errcode = '42501';
    end if;
    if prev.deleted_at is not null then
      raise exception using message = 'expense_deleted', detail = 'Restore this expense before editing it', errcode = '23514';
    end if;
    if p ? 'group_id' and (p ->> 'group_id') is distinct from gid::text then
      raise exception using message = 'invalid_payload', detail = 'An expense cannot move to another group', errcode = '22023';
    end if;

    select jsonb_agg(jsonb_build_object('description', i.description, 'amount_cents', i.amount_cents,
             'user_ids', to_jsonb(i.user_ids)) order by i.position)
    into old_items
    from public.expense_items i where i.expense_id = prev.id;

    select coalesce(jsonb_object_agg(s.user_id, s.share_cents), '{}'::jsonb) into old_shares
    from public.expense_splits s where s.expense_id = prev.id;

    payer_left := exists (
      select 1 from (
        select k::uuid as u from jsonb_object_keys(old_payers) as k
        union
        select prev.paid_by
      ) x
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = x.u)
    );
    sharer_left := exists (
      select 1 from public.expense_splits s
      where s.expense_id = prev.id
        and s.share_cents > 0
        and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
    );
  end if;

  select * into g from public.groups x where x.id = gid;
  if g.archived_at is not null then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;

  -- Merge with the stored row on update.
  v_description := btrim(coalesce(p ->> 'description', prev.description, ''));
  if v_description = '' then
    raise exception using message = 'description_required', detail = 'Add a description', errcode = '22023';
  end if;

  if p ? 'amount_cents' then
    if jsonb_typeof(p -> 'amount_cents') <> 'number'
       or (p ->> 'amount_cents')::numeric <> trunc((p ->> 'amount_cents')::numeric)
       or (p ->> 'amount_cents')::numeric <= 0
       or (p ->> 'amount_cents')::numeric > 100000000000 then
      raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
    end if;
    v_amount := (p ->> 'amount_cents')::bigint;
  else
    v_amount := prev.amount_cents;
  end if;
  if v_amount is null then
    raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
  end if;

  v_currency := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), prev.currency, g.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;

  begin
    v_spent_at := coalesce((p ->> 'spent_at')::date, prev.spent_at, current_date);
    v_paid_by := coalesce((p ->> 'paid_by')::uuid, prev.paid_by, uid);
    v_split_type := coalesce((p ->> 'split_type')::public.split_type, prev.split_type, 'equal');
    v_event := case when p ? 'event_id' then (p ->> 'event_id')::uuid else prev.event_id end;
    v_recurrence := (p ->> 'recurrence')::public.recurrence;
    v_refund := coalesce((p ->> 'is_refund')::boolean, prev.is_refund, false);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end;

  if v_refund and v_recurrence is not null then
    raise exception using message = 'invalid_payload', detail = 'A refund cannot repeat', errcode = '22023';
  end if;

  -- Who paid. A payers list replaces the stored one; `paid_by` alone means one payer, unless it
  -- names the same payer of an unchanged amount, which keeps the stored payers (older clients
  -- always send paid_by). An amount change needs a payers list once several people paid.
  if p ? 'payers' and jsonb_typeof(p -> 'payers') <> 'null' then
    if jsonb_typeof(p -> 'payers') <> 'array'
       or jsonb_array_length(p -> 'payers') > 100
       or exists (
         select 1 from jsonb_array_elements(p -> 'payers') e
         where jsonb_typeof(e) <> 'object'
            or private.try_uuid(e ->> 'user_id') is null
            or jsonb_typeof(e -> 'paid_cents') is distinct from 'number'
            or (e ->> 'paid_cents')::numeric <> trunc((e ->> 'paid_cents')::numeric)
            or (e ->> 'paid_cents')::numeric < 0
            or (e ->> 'paid_cents')::numeric > 100000000000
       )
       or (select count(distinct private.try_uuid(e ->> 'user_id')) from jsonb_array_elements(p -> 'payers') e)
          <> jsonb_array_length(p -> 'payers') then
      raise exception using message = 'invalid_payers', detail = 'Who paid is not valid', errcode = '22023';
    end if;
    select jsonb_object_agg(private.try_uuid(e ->> 'user_id'), (e ->> 'paid_cents')::bigint) into new_payers
    from jsonb_array_elements(p -> 'payers') e
    where (e ->> 'paid_cents')::bigint > 0;
    if new_payers is null then
      raise exception using message = 'invalid_payers', detail = 'Someone has to have paid', errcode = '22023';
    end if;
    if (select sum(j.value::bigint) from jsonb_each(new_payers) j) <> v_amount then
      raise exception using
        message = 'payers_sum_mismatch',
        detail = format('Payers add up to %s but the expense is %s',
          (select sum(j.value::bigint) from jsonb_each(new_payers) j), v_amount),
        errcode = '22023';
    end if;
    select j.key::uuid into v_paid_by from jsonb_each(new_payers) j
    order by j.value::bigint desc, j.key::uuid limit 1;
  elsif prev.id is not null and (select count(*) from jsonb_object_keys(old_payers)) > 1
        and v_paid_by = prev.paid_by then
    if v_amount <> prev.amount_cents then
      raise exception using
        message = 'payers_sum_mismatch',
        detail = 'Several people paid this; say how much each paid of the new amount',
        errcode = '22023';
    end if;
    new_payers := old_payers;
  else
    new_payers := jsonb_build_object(v_paid_by, v_amount);
  end if;
  payers_changed := new_payers is distinct from old_payers;

  if v_currency = g.currency then
    v_fx := 1;
  elsif prev.id is not null and prev.currency = v_currency then
    v_fx := prev.fx_rate;
  else
    v_fx := private.fx_rate(v_currency::char(3), g.currency, v_spent_at);
    if v_fx is null then
      raise exception using
        message = 'fx_rate_unavailable',
        detail = format('No exchange rate from %s to %s yet', v_currency, g.currency),
        errcode = '23514';
    end if;
  end if;

  -- Only a new payer must be a member: an older expense paid by someone who has since left can
  -- still have its details edited.
  if exists (
    select 1 from jsonb_object_keys(new_payers) as k
    where not old_payers ? k
      and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = k::uuid)
  ) then
    raise exception using message = 'payer_not_in_group', detail = 'The payer is not in this group', errcode = '23514';
  end if;

  if v_event is not null and not exists (
    select 1 from public.events ev where ev.id = v_event and ev.group_id = gid
  ) then
    raise exception using message = 'event_not_in_group', detail = 'That event is not in this group', errcode = '22023';
  end if;

  v_receipt := case when p ? 'receipt_path' then nullif(p ->> 'receipt_path', '') else prev.receipt_path end;
  if v_receipt is not null and v_receipt not like gid::text || '/%' then
    raise exception using message = 'invalid_receipt_path', detail = 'Receipts must be stored under the group folder', errcode = '22023';
  end if;

  -- Decide which splits to write.
  if p ? 'items' and jsonb_typeof(p -> 'items') <> 'null' then
    if v_split_type <> 'itemized' then
      raise exception using message = 'invalid_payload', detail = 'Items need a by-item split', errcode = '22023';
    end if;
    begin
      v_tax := nullif((p ->> 'tax_cents')::bigint, 0);
      v_tip := nullif((p ->> 'tip_cents')::bigint, 0);
      v_discount := nullif((p ->> 'discount_cents')::bigint, 0);
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using message = 'invalid_items', detail = 'Tax, tip and discount must be whole amounts', errcode = '22023';
    end;
    select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'share_cents', c.share_cents,
             'weight', null, 'adjustment_cents', null))
    into computed
    from private.itemized_splits(p -> 'items', v_tax, v_tip, v_discount) c
    where c.share_cents > 0;
    if coalesce((select sum((x ->> 'share_cents')::bigint) from jsonb_array_elements(computed) x), 0) <> v_amount then
      raise exception using
        message = 'splits_sum_mismatch',
        detail = 'The items do not add up to the expense',
        errcode = '22023';
    end if;
    rewrite_splits := true;
    write_items := true;
  elsif p ? 'splits' then
    split_input := p -> 'splits';
    rewrite_splits := true;
  elsif prev.id is null then
    raise exception using message = 'splits_required', detail = 'Add at least one person to the split', errcode = '22023';
  elsif v_amount <> prev.amount_cents or v_split_type <> prev.split_type then
    -- Re-derive from the stored people, weights and adjustments.
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'weight', s.weight,
             'adjustment_cents', s.adjustment_cents) order by s.user_id)
    into split_input
    from public.expense_splits s where s.expense_id = prev.id;
    rewrite_splits := true;
  else
    rewrite_splits := false;
  end if;

  if rewrite_splits and not write_items then
    select jsonb_agg(to_jsonb(c)) into computed
    from private.compute_split_rows(v_amount, v_split_type, split_input) c;
  end if;

  if rewrite_splits then
    if exists (
      select 1 from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint)
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
    ) then
      raise exception using message = 'split_member_not_in_group', detail = 'Everyone in the split must be in the group', errcode = '23514';
    end if;

    select coalesce(jsonb_object_agg(s.user_id, s.share_cents), '{}'::jsonb) into new_shares
    from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint);
  end if;

  -- A former member's balance is settled at zero and must stay there: payers are credited and
  -- each person debited, so none of that may change while one of them is out of the group.
  if (payer_left and (payers_changed or v_amount <> prev.amount_cents or v_currency <> prev.currency
                      or v_refund <> prev.is_refund))
     or (sharer_left and (rewrite_splits or v_amount <> prev.amount_cents or v_currency <> prev.currency
                          or v_refund <> prev.is_refund)) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  -- The expense row, its payers and its splits are written one after the other, so the sum
  -- checks must run at commit even if the caller made constraints immediate.
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check,
    public.expenses_payers_sum_check, public.expense_payers_sum_check deferred;

  if prev.id is null then
    if v_recurrence is not null then
      insert into public.recurring_expenses (
        group_id, description, amount_cents, currency, paid_by, payers, split_type, category,
        splits, recurrence, next_run_on, created_by
      ) values (
        gid, v_description, v_amount, v_currency, v_paid_by,
        case when (select count(*) from jsonb_object_keys(new_payers)) > 1 then
          (select jsonb_agg(jsonb_build_object('user_id', j.key, 'paid_cents', j.value::bigint) order by j.key)
           from jsonb_each(new_payers) j)
        end,
        v_split_type, p ->> 'category',
        case when write_items then
          (select jsonb_agg(jsonb_build_object('user_id', x ->> 'user_id', 'share_cents', (x ->> 'share_cents')::bigint))
           from jsonb_array_elements(computed) x)
        else split_input end,
        v_recurrence,
        (v_spent_at + case v_recurrence
          when 'weekly' then interval '1 week'
          when 'monthly' then interval '1 month'
          else interval '1 year' end)::date,
        uid
      )
      returning id into recurring;
    end if;

    insert into public.expenses (
      group_id, event_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
      category, notes, spent_at, receipt_path, recurring_id, created_by, is_refund,
      tax_cents, tip_cents, discount_cents
    ) values (
      gid, v_event, v_description, v_amount, v_currency, v_fx, v_paid_by, v_split_type,
      nullif(btrim(p ->> 'category'), ''), nullif(p ->> 'notes', ''), v_spent_at, v_receipt, recurring, uid,
      v_refund, v_tax, v_tip, v_discount
    )
    returning * into result;
  else
    -- This function logs the edit itself, once, with payers and split (expenses_activity skips it).
    perform set_config('potluck.expense_logged', prev.id::text, true);
    update public.expenses e set
      description = v_description,
      amount_cents = v_amount,
      currency = v_currency,
      fx_rate = v_fx,
      paid_by = v_paid_by,
      split_type = v_split_type,
      category = case when p ? 'category' then nullif(btrim(p ->> 'category'), '') else e.category end,
      notes = case when p ? 'notes' then nullif(p ->> 'notes', '') else e.notes end,
      spent_at = v_spent_at,
      receipt_path = v_receipt,
      event_id = v_event,
      is_refund = v_refund,
      tax_cents = case when write_items then v_tax when rewrite_splits or v_split_type <> 'itemized' then null else e.tax_cents end,
      tip_cents = case when write_items then v_tip when rewrite_splits or v_split_type <> 'itemized' then null else e.tip_cents end,
      discount_cents = case when write_items then v_discount when rewrite_splits or v_split_type <> 'itemized' then null else e.discount_cents end
    where e.id = prev.id
    returning * into result;
  end if;

  -- The insert or update above already wrote paid_by as the only payer (expenses_sync_single_payer);
  -- several payers replace that here.
  if (select count(*) from jsonb_object_keys(new_payers)) > 1 or payers_changed then
    delete from public.expense_payers x where x.expense_id = result.id;
    insert into public.expense_payers (expense_id, user_id, paid_cents)
    select result.id, j.key::uuid, j.value::bigint from jsonb_each(new_payers) j;
  end if;

  if rewrite_splits then
    delete from public.expense_splits s where s.expense_id = result.id;
    insert into public.expense_splits (expense_id, user_id, share_cents, weight, adjustment_cents)
    select result.id, s.user_id, s.share_cents, s.weight, s.adjustment_cents
    from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric, adjustment_cents bigint);
  end if;

  -- Stored line items follow the split: written with it, dropped when the split is rewritten any
  -- other way or stops being by item.
  if write_items then
    delete from public.expense_items i where i.expense_id = result.id;
    insert into public.expense_items (expense_id, position, description, amount_cents, user_ids)
    select result.id, (e.ord - 1)::smallint, btrim(coalesce(e.elem ->> 'description', '')),
           (e.elem ->> 'amount_cents')::bigint,
           array(select distinct x::uuid from jsonb_array_elements_text(e.elem -> 'user_ids') x order by 1)
    from jsonb_array_elements(p -> 'items') with ordinality as e (elem, ord);
  elsif prev.id is not null and (rewrite_splits or v_split_type <> 'itemized') then
    delete from public.expense_items i where i.expense_id = result.id;
  end if;

  -- One history entry per edit, with the old and new value of every field that changed. Payers
  -- and the split are listed when their people changed, or when they changed without the amount
  -- (a new amount alone already rescales them).
  if prev.id is not null then
    changes := private.expense_row_changes(prev, result) - 'paid_by' - 'split_type';
    if payers_changed
       and ((select array_agg(k order by k) from jsonb_object_keys(old_payers) k)
              is distinct from (select array_agg(k order by k) from jsonb_object_keys(new_payers) k)
            or v_amount = prev.amount_cents
            or (select count(*) from jsonb_object_keys(new_payers)) > 1
            or (select count(*) from jsonb_object_keys(old_payers)) > 1) then
      changes := changes || jsonb_build_object('payers', jsonb_build_object('from', old_payers, 'to', new_payers));
    end if;
    if rewrite_splits
       and (prev.split_type <> result.split_type
            or (select array_agg(k order by k) from jsonb_object_keys(old_shares) k)
                 is distinct from (select array_agg(k order by k) from jsonb_object_keys(new_shares) k)
            or (v_amount = prev.amount_cents and new_shares <> old_shares)) then
      changes := changes || jsonb_build_object('split', jsonb_build_object(
        'from', jsonb_build_object('type', prev.split_type, 'shares', old_shares),
        'to', jsonb_build_object('type', result.split_type, 'shares', new_shares)));
    end if;
    -- The bill's lines as entered: renamed, repriced, added or dropped items.
    select jsonb_agg(jsonb_build_object('description', i.description, 'amount_cents', i.amount_cents,
             'user_ids', to_jsonb(i.user_ids)) order by i.position)
    into new_items
    from public.expense_items i where i.expense_id = result.id;
    if new_items is distinct from old_items then
      changes := changes || jsonb_build_object('items', jsonb_build_object('from', old_items, 'to', new_items));
    end if;
    if changes <> '{}'::jsonb then
      perform private.log_activity(gid, uid, 'expense.updated', result.id,
        jsonb_build_object(
          'description', result.description,
          'amount_cents', result.amount_cents,
          'currency', result.currency,
          'paid_by', result.paid_by,
          'is_refund', result.is_refund,
          'changes', changes
        ));
    end if;
    perform set_config('potluck.expense_logged', '', true);
  end if;

  -- The notification triggers only see the expense row. When the edit changed who owes or paid
  -- what and nothing they compare, notify here instead (people dropped from the split or the
  -- payers hear about it too).
  if prev.id is not null
     and ((rewrite_splits and new_shares <> old_shares) or payers_changed) then
    if (result.description, result.amount_cents, result.currency, result.fx_rate, result.paid_by,
        result.split_type, result.spent_at, result.is_refund)
       is not distinct from
       (prev.description, prev.amount_cents, prev.currency, prev.fx_rate, prev.paid_by,
        prev.split_type, prev.spent_at, prev.is_refund) then
      perform private.notify(
        array(
          select k::uuid from jsonb_object_keys(old_shares) as k
          union
          select k::uuid from jsonb_object_keys(coalesce(new_shares, old_shares)) as k
          union
          select k::uuid from jsonb_object_keys(old_payers) as k
          union
          select k::uuid from jsonb_object_keys(new_payers) as k
        ),
        'expense.updated',
        jsonb_build_object(
          'expense_id', result.id,
          'group_id', result.group_id,
          'description', result.description,
          'amount_cents', result.amount_cents,
          'currency', result.currency
        ),
        uid
      );
    end if;
  end if;

  return result;
end;
$$;

-- Public RPCs -----------------------------------------------------------------------------------

-- v1 keeps its contract: the keys it never knew about are ignored, so an old client cannot set
-- them by accident. (`paid_by` on an expense several people paid is handled in save_expense.)
create or replace function public.create_expense(payload jsonb)
returns public.expenses
language sql security definer set search_path = '' as $$
  select * from private.save_expense(
    null,
    coalesce(payload, '{}'::jsonb) - array['payers', 'is_refund', 'items', 'tax_cents', 'tip_cents', 'discount_cents']
  );
$$;

create or replace function public.update_expense(id uuid, payload jsonb)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
begin
  if update_expense.id is null then
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  return private.save_expense(
    update_expense.id,
    coalesce(payload, '{}'::jsonb) - array['payers', 'is_refund', 'items', 'tax_cents', 'tip_cents', 'discount_cents']
  );
end;
$$;

create function public.create_expense_v2(payload jsonb)
returns public.expenses
language sql security definer set search_path = '' as $$
  select * from private.save_expense(null, payload);
$$;
revoke execute on function public.create_expense_v2(jsonb) from public, anon;
grant execute on function public.create_expense_v2(jsonb) to authenticated, service_role;

create function public.update_expense_v2(id uuid, payload jsonb)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
begin
  if update_expense_v2.id is null then
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  return private.save_expense(update_expense_v2.id, payload);
end;
$$;
revoke execute on function public.update_expense_v2(uuid, jsonb) from public, anon;
grant execute on function public.update_expense_v2(uuid, jsonb) to authenticated, service_role;

-- Body as in schema/current.sql plus: any payer may
-- change an expense, like the creator.
create or replace function private.editable_expense(eid uuid)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  e public.expenses;
  my_role public.group_role;
begin
  select * into e from public.expenses x where x.id = eid for update;
  if e.id is null then
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  my_role := private.require_member(e.group_id);
  if my_role = 'member' and uid is distinct from e.created_by and uid <> e.paid_by
     and not exists (select 1 from public.expense_payers p where p.expense_id = e.id and p.user_id = uid) then
    raise exception using message = 'not_allowed', detail = 'You can only change your own expenses', errcode = '42501';
  end if;
  perform private.require_unarchived(e.group_id);
  return e;
end;
$$;

-- Body as in schema/current.sql plus every payer in the departed check.
create or replace function public.delete_expense(id uuid)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := (select x.group_id from public.expenses x where x.id = delete_expense.id);
  e public.expenses;
begin
  if gid is not null then
    perform 1 from public.groups g where g.id = gid for share;
    perform private.require_member(gid);
  end if;
  e := private.editable_expense(delete_expense.id);

  if e.deleted_at is null and exists (
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

  update public.expenses x
  set deleted_at = coalesce(x.deleted_at, now())
  where x.id = e.id
  returning * into e;
  return e;
end;
$$;

-- Body as in schema/current.sql plus every payer in the departed check.
create or replace function public.restore_expense(id uuid)
returns public.expenses
language plpgsql security definer set search_path = '' as $$
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

  update public.expenses x set deleted_at = null where x.id = e.id returning * into e;
  return e;
end;
$$;

-- Body as in schema/current.sql plus payers.
create or replace function private.referenced_in_group(gid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expenses e where e.group_id = gid and e.paid_by = uid)
    or exists (
      select 1 from public.expense_payers p
      join public.expenses e on e.id = p.expense_id
      where e.group_id = gid and p.user_id = uid
    )
    or exists (
      select 1 from public.expense_splits s
      join public.expenses e on e.id = s.expense_id
      where e.group_id = gid and s.user_id = uid
    )
    or exists (
      select 1 from public.settlements st
      where st.group_id = gid and uid in (st.from_user, st.to_user)
    )
    or exists (select 1 from public.comments c where c.group_id = gid and c.author_id = uid)
    or exists (
      select 1 from public.activity a
      where a.group_id = gid
        and a.actor_id = uid
        and a.verb not like 'member.%'
        and a.verb not like 'group.%'
    );
$$;

-- Default split ---------------------------------------------------------------------------------

-- Where new expenses in a group start. Any member may set it (like Splitwise); it never moves a
-- balance. `split` is {split_type: equal | percent | shares, splits: [{user_id, weight}]} for
-- current members, or null to go back to an equal split between everyone.
create function public.set_default_split(group_id uuid, split jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  kind public.split_type;
  normalized jsonb;
begin
  perform private.require_member(set_default_split.group_id);
  perform private.require_group_open(set_default_split.group_id);

  if split is null or jsonb_typeof(split) = 'null' then
    update public.groups g set default_split = null where g.id = set_default_split.group_id;
    perform private.log_activity(set_default_split.group_id, uid, 'group.default_split', set_default_split.group_id,
      jsonb_build_object('split_type', null));
    return null;
  end if;

  if jsonb_typeof(split) <> 'object' or jsonb_typeof(split -> 'splits') is distinct from 'array' then
    raise exception using message = 'invalid_splits', detail = 'The split is not valid', errcode = '22023';
  end if;
  begin
    kind := (split ->> 'split_type')::public.split_type;
  exception when invalid_text_representation then
    kind := null;
  end;
  if kind is null or kind not in ('equal', 'percent', 'shares') then
    raise exception using message = 'invalid_splits', detail = 'A default split is equal, by percent or by shares', errcode = '22023';
  end if;

  -- Same validation as an expense (people, duplicates, weights, percent sum).
  select jsonb_agg(
           jsonb_build_object('user_id', c.user_id, 'weight', case when kind = 'equal' then null else c.weight end)
           order by c.user_id)
  into normalized
  from private.compute_splits(10000, kind, split -> 'splits') c;

  if exists (
    select 1 from jsonb_array_elements(normalized) e
    where not exists (
      select 1 from public.group_members m
      where m.group_id = set_default_split.group_id and m.user_id = (e ->> 'user_id')::uuid
    )
  ) then
    raise exception using message = 'split_member_not_in_group', detail = 'Everyone in the split must be in the group', errcode = '23514';
  end if;

  normalized := jsonb_build_object('split_type', kind, 'splits', normalized);
  update public.groups g set default_split = normalized where g.id = set_default_split.group_id;
  perform private.log_activity(set_default_split.group_id, uid, 'group.default_split', set_default_split.group_id,
    jsonb_build_object('split_type', kind));
  return normalized;
end;
$$;
revoke execute on function public.set_default_split(uuid, jsonb) from public, anon;
grant execute on function public.set_default_split(uuid, jsonb) to authenticated, service_role;

-- Balances --------------------------------------------------------------------------------------

-- Same columns as before. Each expense is converted once; the converted total is spread over
-- the payers by what they paid and over the split by share (largest remainder, ties by user id,
-- as core `expenseEffect`), and a refund flips both signs.
create or replace view public.group_balances with (security_invoker = true) as
with expense_totals as not materialized (
  select e.id, e.group_id,
         case when e.is_refund then -1 else 1 end as sign,
         private.convert_minor(e.amount_cents, e.fx_rate, e.currency::text, g.currency::text) as total
  from public.expenses e
  join public.groups g on g.id = e.group_id
  where e.deleted_at is null
),
split_parts as (
  select t.id, t.group_id, t.total, t.sign, s.user_id,
         div(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as base,
         mod(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as rem
  from expense_totals t
  join public.expense_splits s on s.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
split_shares as (
  select p.group_id, p.user_id, p.sign,
         p.base + case
           when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
                <= p.total - sum(p.base) over (partition by p.group_id, p.id) then 1
           else 0 end as share
  from split_parts p
),
payer_parts as (
  select t.id, t.group_id, t.total, t.sign, x.user_id,
         div(t.total::numeric * x.paid_cents::numeric, sum(x.paid_cents) over w) as base,
         mod(t.total::numeric * x.paid_cents::numeric, sum(x.paid_cents) over w) as rem
  from expense_totals t
  join public.expense_payers x on x.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
payer_shares as (
  select p.group_id, p.user_id, p.sign,
         p.base + case
           when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
                <= p.total - sum(p.base) over (partition by p.group_id, p.id) then 1
           else 0 end as share
  from payer_parts p
),
ledger as (
  select m.group_id, m.user_id, 0::numeric as delta from public.group_members m
  union all
  select x.group_id, x.user_id, x.sign * x.share from payer_shares x
  union all
  select s.group_id, s.user_id, -s.sign * s.share from split_shares s
  union all
  select st.group_id, st.from_user,
         private.convert_minor(st.amount_cents, st.fx_rate, st.currency::text, g.currency::text)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null
  union all
  select st.group_id, st.to_user,
         -private.convert_minor(st.amount_cents, st.fx_rate, st.currency::text, g.currency::text)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null
)
select l.group_id, l.user_id, sum(l.delta)::bigint as net_cents
from ledger l
group by l.group_id, l.user_id;

-- Triggers that name the payer ------------------------------------------------------------------

-- Body as in schema/current.sql plus is_refund and the by-item extras in the compared columns,
-- `changes` (old and new values) on updates, and no row for an edit save_expense logs itself.
create or replace function private.expenses_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  verb text;
  changes jsonb;
begin
  if tg_op = 'UPDATE' and current_setting('potluck.expense_logged', true) = new.id::text
     and (old.deleted_at is null) = (new.deleted_at is null) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    verb := 'expense.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    verb := 'expense.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    verb := 'expense.restored';
  elsif (new.description, new.amount_cents, new.currency, new.fx_rate, new.paid_by, new.split_type,
         new.category, new.notes, new.spent_at, new.receipt_path, new.event_id, new.is_refund,
         new.tax_cents, new.tip_cents, new.discount_cents)
        is distinct from
        (old.description, old.amount_cents, old.currency, old.fx_rate, old.paid_by, old.split_type,
         old.category, old.notes, old.spent_at, old.receipt_path, old.event_id, old.is_refund,
         old.tax_cents, old.tip_cents, old.discount_cents) then
    verb := 'expense.updated';
    changes := private.expense_row_changes(old, new);
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object(
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'paid_by', new.paid_by,
      'is_refund', new.is_refund
    ) || case when changes is null then '{}'::jsonb else jsonb_build_object('changes', changes) end);
  return null;
end;
$$;

-- Body as in schema/current.sql plus every payer as a recipient.
create or replace function private.expenses_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- created_by, not auth.uid(): this runs at commit, after the caller may have changed.
  actor uuid := coalesce(new.created_by, auth.uid());
begin
  if new.deleted_at is not null or not exists (select 1 from public.expenses e where e.id = new.id) then
    return null;
  end if;

  insert into public.notifications (user_id, type, data)
  select
    s.user_id,
    'expense.created',
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'paid_by', new.paid_by,
      'is_refund', new.is_refund,
      'share_cents', s.share_cents,
      'actor_id', actor
    )
  from (
    select x.user_id, x.share_cents from public.expense_splits x where x.expense_id = new.id
    union all
    select y.user_id, 0 from public.expense_payers y
    where y.expense_id = new.id
      and not exists (select 1 from public.expense_splits x where x.expense_id = new.id and x.user_id = y.user_id)
  ) s
  join public.profiles p on p.id = s.user_id
  where p.deleted_at is null
    and s.user_id is distinct from actor;

  return null;
end;
$$;

-- Body as in schema/current.sql plus is_refund and every payer.
create or replace function private.expenses_notify_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  recipients uuid[];
begin
  if new.deleted_at is not null or old.deleted_at is not null
     or (new.description, new.amount_cents, new.currency, new.fx_rate, new.paid_by, new.split_type,
         new.spent_at, new.is_refund)
        is not distinct from
        (old.description, old.amount_cents, old.currency, old.fx_rate, old.paid_by, old.split_type,
         old.spent_at, old.is_refund) then
    return null;
  end if;

  select array_agg(distinct u) into recipients
  from (
    select s.user_id as u from public.expense_splits s where s.expense_id = new.id
    union
    select y.user_id from public.expense_payers y where y.expense_id = new.id
    union
    select new.paid_by
  ) x;

  perform private.notify(
    recipients,
    'expense.updated',
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;

-- Body as in schema/current.sql plus every payer as a recipient.
create or replace function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  recipients uuid[];
begin
  if new.expense_id is not null then
    select array_agg(distinct u) into recipients
    from (
      select s.user_id as u from public.expense_splits s where s.expense_id = new.expense_id
      union
      select y.user_id from public.expense_payers y where y.expense_id = new.expense_id
      union
      select e.paid_by from public.expenses e where e.id = new.expense_id
      union
      select e.created_by from public.expenses e where e.id = new.expense_id
    ) x;
  else
    select array_agg(distinct u) into recipients
    from (
      select r.user_id as u from public.event_rsvps r
      where r.event_id = new.event_id and r.status in ('going', 'maybe')
      union
      select e.created_by from public.events e where e.id = new.event_id
    ) x;
  end if;

  perform private.notify(
    recipients,
    'comment.created',
    jsonb_build_object(
      'comment_id', new.id,
      'group_id', new.group_id,
      'expense_id', new.expense_id,
      'event_id', new.event_id,
      'excerpt', left(new.body, 140)
    ),
    new.author_id
  );
  return null;
end;
$$;

-- Recurring -------------------------------------------------------------------------------------

-- Body as in schema/current.sql plus several payers (`recurring_expenses.payers`), the
-- adjustment split (compute_split_rows) and the payer sum check deferred with the others.
create or replace function private.materialize_recurring_expenses(run_on date default current_date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  due_ids uuid[];
  cand_id uuid;
  r public.recurring_expenses;
  g public.groups;
  fx numeric;
  new_id uuid;
  due date;
  anchor_day int;
  runs int;
  made int := 0;
begin
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check,
    public.expenses_payers_sum_check, public.expense_payers_sum_check deferred;

  select coalesce(array_agg(x.id order by x.next_run_on, x.id), '{}') into due_ids
  from public.recurring_expenses x
  where x.active and x.next_run_on <= run_on;

  perform 1 from public.groups x
  where x.id in (select t.group_id from public.recurring_expenses t where t.id = any(due_ids))
  order by x.id
  for share;

  foreach cand_id in array due_ids loop
    begin
      select * into r from public.recurring_expenses x
      where x.id = cand_id and x.active and x.next_run_on <= run_on
      for update skip locked;
      if not found then
        continue;
      end if;
      select * into g from public.groups x where x.id = r.group_id;

      if g.archived_at is not null
         or exists (
           select 1 from (
             select r.paid_by as u
             union
             select (e ->> 'user_id')::uuid from jsonb_array_elements(coalesce(r.payers, '[]'::jsonb)) e
             union
             select (e ->> 'user_id')::uuid from jsonb_array_elements(r.splits) e
           ) people
           where not exists (
             select 1 from public.group_members m
             where m.group_id = r.group_id and m.user_id = people.u
           )
           or exists (select 1 from public.profiles p where p.id = people.u and p.deleted_at is not null)
         ) then
        update public.recurring_expenses x set active = false where x.id = r.id;
        continue;
      end if;

      due := r.next_run_on;
      anchor_day := private.recurring_anchor_day(r);
      runs := 0;
      while due <= run_on and runs < 12 loop
        fx := private.fx_rate(r.currency, g.currency, due);
        exit when fx is null;

        insert into public.expenses (
          group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
          category, spent_at, recurring_id, created_by
        ) values (
          r.group_id, r.description, r.amount_cents, r.currency, fx, r.paid_by, r.split_type,
          r.category, due, r.id, r.created_by
        )
        returning id into new_id;

        if r.payers is not null then
          delete from public.expense_payers x where x.expense_id = new_id;
          insert into public.expense_payers (expense_id, user_id, paid_cents)
          select new_id, (e ->> 'user_id')::uuid, (e ->> 'paid_cents')::bigint
          from jsonb_array_elements(r.payers) e;
        end if;

        insert into public.expense_splits (expense_id, user_id, share_cents, weight, adjustment_cents)
        select new_id, c.user_id, c.share_cents, c.weight, c.adjustment_cents
        from private.compute_split_rows(r.amount_cents, r.split_type, r.splits) c;

        due := private.recurring_step(due, r.recurrence, anchor_day);
        runs := runs + 1;
        made := made + 1;
      end loop;

      update public.recurring_expenses x set next_run_on = due where x.id = r.id;
    exception
      when others then
        raise warning 'recurring expense % skipped: %', cand_id, sqlerrm;
    end;
  end loop;

  return made;
end;
$$;

-- Notifications from 20261113062656_notification_prefs_and_email.sql ------------------------------

-- Body as in 20261113062656_notification_prefs_and_email.sql plus every payer: an expense
-- someone paid part of counts in their monthly summary.
create or replace function private.monthly_summary(uid uuid, month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', month::timestamp)::date as starts,
           (date_trunc('month', month::timestamp) + interval '1 month')::date as ends
  ),
  mine as (
    select
      g.id,
      case
        when g.is_direct then coalesce((
          select o.display_name from public.group_members m2
          join public.profiles o on o.id = m2.user_id
          where m2.group_id = g.id and m2.user_id <> uid
          limit 1
        ), g.name)
        else g.name
      end as name,
      g.emoji,
      g.is_direct,
      g.currency::text as currency,
      coalesce((select b.net_cents from public.group_balances b where b.group_id = g.id and b.user_id = uid), 0) as net_cents,
      (select count(*) from public.expenses e, bounds
       where e.group_id = g.id and e.deleted_at is null
         and e.created_at >= bounds.starts and e.created_at < bounds.ends
         and (e.paid_by = uid or exists (
           select 1 from public.expense_splits s where s.expense_id = e.id and s.user_id = uid
         ) or exists (
           select 1 from public.expense_payers x where x.expense_id = e.id and x.user_id = uid
         )))::int as expenses,
      (select count(*) from public.settlements s, bounds
       where s.group_id = g.id and s.deleted_at is null
         and s.created_at >= bounds.starts and s.created_at < bounds.ends
         and uid in (s.from_user, s.to_user))::int as payments
    from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.user_id = uid
  )
  select jsonb_build_object(
    'month', (select to_char(bounds.starts, 'YYYY-MM-DD') from bounds),
    'groups', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_id', mine.id,
          'name', mine.name,
          'emoji', mine.emoji,
          'is_direct', mine.is_direct,
          'currency', mine.currency,
          'net_cents', mine.net_cents,
          'expenses', mine.expenses,
          'payments', mine.payments
        )
        order by abs(mine.net_cents) desc, mine.name, mine.id
      ) filter (where mine.net_cents <> 0 or mine.expenses > 0 or mine.payments > 0),
      '[]'::jsonb
    )
  )
  from mine;
$$;

-- Body as in 20261113062656_notification_prefs_and_email.sql plus every payer as a recipient of
-- expense.deleted and expense.restored.
create or replace function private.expenses_notify_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
  recipients uuid[];
begin
  if old.deleted_at is null and new.deleted_at is not null then
    kind := 'expense.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    kind := 'expense.restored';
  else
    return null;
  end if;

  select array_agg(distinct u) into recipients
  from (
    select s.user_id as u from public.expense_splits s where s.expense_id = new.id
    union
    select y.user_id from public.expense_payers y where y.expense_id = new.id
    union
    select new.paid_by
  ) x;

  perform private.notify(
    recipients,
    kind,
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;
