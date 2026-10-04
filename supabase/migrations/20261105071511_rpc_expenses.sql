-- RPCs: expenses.
--
-- Payload (create_expense, update_expense; update only needs the changed keys):
-- {
--   "group_id": uuid,               -- create only
--   "description": text,
--   "amount_cents": int > 0,
--   "currency": "EUR",              -- default: group currency
--   "fx_rate": 1.08,                -- optional; default: latest fx_rates row, 1 for group currency
--   "paid_by": uuid,                -- default: caller
--   "split_type": "equal" | "exact" | "percent" | "shares" | "itemized",
--   "splits": [{ "user_id": uuid, "share_cents": int?, "weight": number? }],
--   "category": text, "notes": text, "spent_at": "2026-01-31",
--   "receipt_path": "<group_id>/...", "event_id": uuid,
--   "recurrence": "weekly" | "monthly" | "yearly"   -- create only, makes a recurring template
-- }
--
-- Split rules: if every split has share_cents they are used as is (and must add
-- up to amount_cents). Otherwise shares are derived: equal splits evenly,
-- percent and shares split by weight. Leftover cents go to the largest
-- fractional remainders, ties broken by array order. exact and itemized always
-- need share_cents.

create or replace function private.compute_splits(amount bigint, kind public.split_type, splits jsonb)
returns table (user_id uuid, share_cents bigint, weight numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  uids uuid[];
  shares bigint[];
  weights numeric[];
  n int;
  explicit_n int;
  total_weight numeric;
  total_shares bigint;
begin
  if splits is null or jsonb_typeof(splits) <> 'array' or jsonb_array_length(splits) = 0 then
    raise exception using message = 'Add at least one person to the split', hint = 'splits_required', errcode = '22023';
  end if;

  begin
    select
      array_agg((e.elem ->> 'user_id')::uuid order by e.ord),
      array_agg((e.elem ->> 'share_cents')::bigint order by e.ord),
      array_agg((e.elem ->> 'weight')::numeric order by e.ord)
    into uids, shares, weights
    from jsonb_array_elements(splits) with ordinality as e (elem, ord);
  exception
    when invalid_text_representation or numeric_value_out_of_range or cannot_coerce then
      raise exception using message = 'The split is not valid', hint = 'invalid_splits', errcode = '22023';
  end;

  n := cardinality(uids);

  if array_position(uids, null) is not null then
    raise exception using message = 'Every split needs a person', hint = 'invalid_splits', errcode = '22023';
  end if;
  if (select count(distinct u) from unnest(uids) as u) <> n then
    raise exception using message = 'A person appears twice in the split', hint = 'duplicate_split_member', errcode = '22023';
  end if;

  select count(s), coalesce(sum(s), 0) into explicit_n, total_shares from unnest(shares) as s;

  if explicit_n = n then
    if exists (select 1 from unnest(shares) as s where s < 0) then
      raise exception using message = 'Shares cannot be negative', hint = 'invalid_splits', errcode = '22023';
    end if;
    if total_shares <> amount then
      raise exception using
        message = format('Splits add up to %s but the expense is %s', total_shares, amount),
        hint = 'splits_must_sum_to_amount',
        errcode = '22023';
    end if;
    return query
      select t.u, t.s, t.w from unnest(uids, shares, weights) with ordinality as t (u, s, w, ord) order by t.ord;
    return;
  end if;

  if kind in ('exact', 'itemized') then
    raise exception using message = 'Enter an amount for each person', hint = 'split_amount_required', errcode = '22023';
  end if;

  if kind = 'equal' then
    weights := array_fill(1::numeric, array[n]);
  else
    if array_position(weights, null) is not null
       or exists (select 1 from unnest(weights) as w where w < 0) then
      raise exception using message = 'Enter a value for each person', hint = 'split_weight_required', errcode = '22023';
    end if;
  end if;

  select sum(w) into total_weight from unnest(weights) as w;

  if kind = 'percent' and total_weight <> 100 then
    raise exception using message = 'Percentages must add up to 100', hint = 'percent_must_total_100', errcode = '22023';
  end if;
  if total_weight <= 0 then
    raise exception using message = 'At least one person needs a share', hint = 'split_weight_required', errcode = '22023';
  end if;

  return query
  with raw as (
    select t.u, t.w, t.ord, amount * t.w / total_weight as exact
    from unnest(uids, weights) with ordinality as t (u, w, ord)
  ),
  floored as (
    select r.*, floor(r.exact)::bigint as base, r.exact - floor(r.exact) as frac from raw r
  ),
  ranked as (
    select f.*, row_number() over (order by f.frac desc, f.ord) as rn,
           amount - sum(f.base) over () as leftover
    from floored f
  )
  select
    k.u,
    k.base + case when k.rn <= k.leftover then 1 else 0 end,
    case when kind = 'equal' then null else k.w end
  from ranked k
  order by k.ord;
end;
$$;

-- Shared create/update path. `eid` null means create.
create or replace function private.save_expense(eid uuid, payload jsonb)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
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
  split_input jsonb;
  rewrite_splits boolean;
  computed jsonb;
  result public.expenses;
  recurring uuid;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception using message = 'The expense is not valid', hint = 'invalid_payload', errcode = '22023';
  end if;

  if eid is null then
    begin
      gid := (p ->> 'group_id')::uuid;
    exception when invalid_text_representation then
      gid := null;
    end;
    if gid is null then
      raise exception using message = 'Pick a group for this expense', hint = 'group_required', errcode = '22023';
    end if;
    my_role := private.require_member(gid);
  else
    select * into prev from public.expenses e where e.id = eid for update;
    if prev.id is null then
      raise exception using message = 'Expense not found', hint = 'expense_not_found', errcode = 'P0002';
    end if;
    gid := prev.group_id;
    my_role := private.require_member(gid);
    if my_role = 'member' and uid is distinct from prev.created_by and uid <> prev.paid_by then
      raise exception using message = 'You can only edit your own expenses', hint = 'not_allowed', errcode = '42501';
    end if;
    if prev.deleted_at is not null then
      raise exception using message = 'Restore this expense before editing it', hint = 'expense_deleted', errcode = '23514';
    end if;
    if p ? 'group_id' and (p ->> 'group_id') is distinct from gid::text then
      raise exception using message = 'An expense cannot move to another group', hint = 'invalid_payload', errcode = '22023';
    end if;
  end if;

  select * into g from public.groups x where x.id = gid;
  if g.archived_at is not null then
    raise exception using message = 'This group is archived', hint = 'group_archived', errcode = '23514';
  end if;

  -- Merge with the stored row on update.
  v_description := btrim(coalesce(p ->> 'description', prev.description, ''));
  if v_description = '' then
    raise exception using message = 'Add a description', hint = 'description_required', errcode = '22023';
  end if;

  if p ? 'amount_cents' then
    if jsonb_typeof(p -> 'amount_cents') <> 'number'
       or (p ->> 'amount_cents')::numeric <> trunc((p ->> 'amount_cents')::numeric)
       or (p ->> 'amount_cents')::numeric <= 0
       or (p ->> 'amount_cents')::numeric > 100000000000 then
      raise exception using message = 'Enter an amount greater than zero', hint = 'invalid_amount', errcode = '22023';
    end if;
    v_amount := (p ->> 'amount_cents')::bigint;
  else
    v_amount := prev.amount_cents;
  end if;
  if v_amount is null then
    raise exception using message = 'Enter an amount greater than zero', hint = 'invalid_amount', errcode = '22023';
  end if;

  v_currency := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), prev.currency, g.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using message = 'Unknown currency code', hint = 'invalid_currency', errcode = '22023';
  end if;

  begin
    v_spent_at := coalesce((p ->> 'spent_at')::date, prev.spent_at, current_date);
    v_paid_by := coalesce((p ->> 'paid_by')::uuid, prev.paid_by, uid);
    v_split_type := coalesce((p ->> 'split_type')::public.split_type, prev.split_type, 'equal');
    v_event := case when p ? 'event_id' then (p ->> 'event_id')::uuid else prev.event_id end;
    v_recurrence := (p ->> 'recurrence')::public.recurrence;
    v_fx := (p ->> 'fx_rate')::numeric;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'The expense is not valid', hint = 'invalid_payload', errcode = '22023';
  end;

  if v_currency = g.currency then
    v_fx := 1;
  elsif v_fx is not null then
    if v_fx <= 0 then
      raise exception using message = 'Exchange rate must be positive', hint = 'invalid_fx_rate', errcode = '22023';
    end if;
  elsif prev.id is not null and prev.currency = v_currency then
    v_fx := prev.fx_rate;
  else
    v_fx := private.fx_rate(v_currency::char(3), g.currency, v_spent_at);
    if v_fx is null then
      raise exception using
        message = format('No exchange rate from %s to %s yet', v_currency, g.currency),
        hint = 'fx_rate_unavailable',
        errcode = '23514';
    end if;
  end if;

  if not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = v_paid_by) then
    raise exception using message = 'The payer is not in this group', hint = 'payer_not_in_group', errcode = '23514';
  end if;

  if v_event is not null and not exists (
    select 1 from public.events ev where ev.id = v_event and ev.group_id = gid
  ) then
    raise exception using message = 'That event is not in this group', hint = 'event_not_in_group', errcode = '22023';
  end if;

  v_receipt := case when p ? 'receipt_path' then nullif(p ->> 'receipt_path', '') else prev.receipt_path end;
  if v_receipt is not null and v_receipt not like gid::text || '/%' then
    raise exception using message = 'Receipts must be stored under the group folder', hint = 'invalid_receipt_path', errcode = '22023';
  end if;

  -- Decide which splits to write.
  if p ? 'splits' then
    split_input := p -> 'splits';
    rewrite_splits := true;
  elsif prev.id is null then
    raise exception using message = 'Add at least one person to the split', hint = 'splits_required', errcode = '22023';
  elsif v_amount <> prev.amount_cents or v_split_type <> prev.split_type then
    -- Re-derive from the stored people and weights.
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'weight', s.weight) order by s.user_id)
    into split_input
    from public.expense_splits s where s.expense_id = prev.id;
    rewrite_splits := true;
  else
    rewrite_splits := false;
  end if;

  if rewrite_splits then
    select jsonb_agg(to_jsonb(c)) into computed
    from private.compute_splits(v_amount, v_split_type, split_input) c;

    if exists (
      select 1 from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric)
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
    ) then
      raise exception using message = 'Everyone in the split must be in the group', hint = 'split_member_not_in_group', errcode = '23514';
    end if;
  end if;

  -- The expense row and its splits are written one after the other, so the
  -- sum check must run at commit even if the caller made constraints immediate.
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check deferred;

  if prev.id is null then
    if v_recurrence is not null then
      insert into public.recurring_expenses (
        group_id, description, amount_cents, currency, paid_by, split_type, category,
        splits, recurrence, next_run_on, created_by
      ) values (
        gid, v_description, v_amount, v_currency, v_paid_by, v_split_type, p ->> 'category',
        split_input, v_recurrence,
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
      category, notes, spent_at, receipt_path, recurring_id, created_by
    ) values (
      gid, v_event, v_description, v_amount, v_currency, v_fx, v_paid_by, v_split_type,
      nullif(btrim(p ->> 'category'), ''), nullif(p ->> 'notes', ''), v_spent_at, v_receipt, recurring, uid
    )
    returning * into result;
  else
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
      event_id = v_event
    where e.id = prev.id
    returning * into result;
  end if;

  if rewrite_splits then
    delete from public.expense_splits s where s.expense_id = result.id;
    insert into public.expense_splits (expense_id, user_id, share_cents, weight)
    select result.id, s.user_id, s.share_cents, s.weight
    from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric);
  end if;

  return result;
end;
$$;

create or replace function public.create_expense(payload jsonb)
returns public.expenses
language sql
security definer
set search_path = ''
as $$
  select * from private.save_expense(null, payload);
$$;

create or replace function public.update_expense(id uuid, payload jsonb)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
begin
  if update_expense.id is null then
    raise exception using message = 'Expense not found', hint = 'expense_not_found', errcode = 'P0002';
  end if;
  return private.save_expense(update_expense.id, payload);
end;
$$;

-- Loads an expense the caller may modify (creator, payer, or group admin).
create or replace function private.editable_expense(eid uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  e public.expenses;
  my_role public.group_role;
begin
  select * into e from public.expenses x where x.id = eid for update;
  if e.id is null then
    raise exception using message = 'Expense not found', hint = 'expense_not_found', errcode = 'P0002';
  end if;
  my_role := private.require_member(e.group_id);
  if my_role = 'member' and uid is distinct from e.created_by and uid <> e.paid_by then
    raise exception using message = 'You can only change your own expenses', hint = 'not_allowed', errcode = '42501';
  end if;
  return e;
end;
$$;

create or replace function public.delete_expense(id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses := private.editable_expense(delete_expense.id);
begin
  update public.expenses x
  set deleted_at = coalesce(x.deleted_at, now())
  where x.id = e.id
  returning * into e;
  return e;
end;
$$;

create or replace function public.restore_expense(id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses := private.editable_expense(restore_expense.id);
begin
  if e.deleted_at is null then
    return e;
  end if;

  if exists (
    select s.user_id from public.expense_splits s where s.expense_id = e.id
    union
    select e.paid_by
    except
    select m.user_id from public.group_members m where m.group_id = e.group_id
  ) then
    raise exception using message = 'Someone in this expense has left the group', hint = 'split_member_not_in_group', errcode = '23514';
  end if;

  update public.expenses x set deleted_at = null where x.id = e.id returning * into e;
  return e;
end;
$$;

revoke execute on function
  private.compute_splits(bigint, public.split_type, jsonb),
  private.save_expense(uuid, jsonb),
  private.editable_expense(uuid)
from public, anon, authenticated;

grant execute on function private.compute_splits(bigint, public.split_type, jsonb) to service_role;

revoke execute on function
  public.create_expense(jsonb),
  public.update_expense(uuid, jsonb),
  public.delete_expense(uuid),
  public.restore_expense(uuid)
from public, anon;

grant execute on function
  public.create_expense(jsonb),
  public.update_expense(uuid, jsonb),
  public.delete_expense(uuid),
  public.restore_expense(uuid)
to authenticated, service_role;
