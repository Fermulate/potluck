-- A block reaches every expense. Once either person has blocked the other, no new expense may
-- name both of them, as payers or with a share, in any group, an existing 1:1 tab included.
-- Payments and settling up are untouched, so the two can still square up. Expenses from before
-- the block keep working: an edit is refused only when it brings in someone who has a block
-- with someone else in it, so details, amount and split stay editable. The answer never says
-- who blocked whom: a 1:1 tab says `not_a_friend` (as private.freeze_blocked_direct_money and
-- get_or_create_direct_group already do there, ADR 19), any other group `blocked_person`.
--
-- New: private.blocked_pair, private.require_no_blocked_pair, private.recurring_has_blocked_pair.
-- Redefined (each body copied from schema/current.sql, as noted above it):
--   private.save_expense (create_expense_v2, create_expense_with_attachments, update_expense_v2),
--   public.update_recurring_expense, public.import_expenses,
--   private.materialize_recurring_expenses (a template naming a blocked pair is skipped, not
--   failed), private.send_recurring_heads_ups, public.can_split_with.

-- Whether two of `people` have a block between them, either way, with at least one of the two
-- in `fresh` (null: any two). A block is one row per direction, so both ends in the list
-- covers both directions.
create or replace function private.blocked_pair(people uuid[], fresh uuid[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where b.blocker_id = any (people)
      and b.blocked_id = any (people)
      and (fresh is null or b.blocker_id = any (fresh) or b.blocked_id = any (fresh))
  );
$$;

-- Refuses a write that would put two people with a block between them on one expense, without
-- saying who they are or who blocked whom.
create or replace function private.require_no_blocked_pair(gid uuid, people uuid[], fresh uuid[] default null)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.blocked_pair(people, fresh) then
    return;
  end if;
  if exists (select 1 from public.groups g where g.id = gid and g.is_direct) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;
  raise exception using
    message = 'blocked_person',
    detail = 'Some people in this expense cannot share one; take one of them out',
    errcode = '23514';
end;
$$;

-- Whether the next copy of a repeating expense would name a blocked pair: its payers and
-- everyone with a share.
create or replace function private.recurring_has_blocked_pair(r public.recurring_expenses)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.blocked_pair(array(
    select r.paid_by
    union
    select private.try_uuid(e ->> 'user_id') from jsonb_array_elements(coalesce(r.payers, '[]'::jsonb)) e
    union
    select c.user_id from private.compute_split_rows(r.amount_cents, r.split_type, r.splits) c
    where c.share_cents > 0
  ));
$$;

revoke all on function private.blocked_pair(uuid[], uuid[]) from public;
revoke all on function private.require_no_blocked_pair(uuid, uuid[], uuid[]) from public;
revoke all on function private.recurring_has_blocked_pair(public.recurring_expenses) from public;

-- Body as in 20261113091955_expense_entry.sql (live copy in schema/current.sql) plus the blocked
-- pair check once the payers and the split are known.
CREATE OR REPLACE FUNCTION "private"."save_expense"("eid" "uuid", "payload" "jsonb") RETURNS "public"."expenses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
  old_split_inputs jsonb;
  new_split_inputs jsonb;
  old_items jsonb;
  new_items jsonb;
  new_shares jsonb;
  old_payers jsonb := '{}'::jsonb;
  new_payers jsonb;
  payers_changed boolean;
  payer_left boolean := false;
  sharer_left boolean := false;
  changes jsonb;
  in_it uuid[];
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

    select coalesce(jsonb_object_agg(s.user_id, jsonb_build_array(s.weight, s.adjustment_cents,
             case when prev.split_type in ('exact', 'itemized') then s.share_cents end)), '{}'::jsonb)
    into old_split_inputs
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

  -- A block either way keeps two people off one new expense, as payers or with a share. An edit
  -- is refused only when it brings in someone with a block with someone else in it, so an
  -- expense from before the block keeps its details, amount and split editable.
  in_it := array(
    select k::uuid from jsonb_object_keys(new_payers) as k
    union
    select j.key::uuid
    from jsonb_each(coalesce(case when rewrite_splits then new_shares else old_shares end, '{}'::jsonb)) j
    where j.value::bigint > 0
  );
  perform private.require_no_blocked_pair(gid, in_it, array(
    select u from unnest(in_it) as u
    where not old_payers ? u::text
      and coalesce((old_shares ->> u::text)::bigint, 0) <= 0
  ));

  -- The expense row, its payers and its splits are written one after the other, so the sum
  -- checks must run at commit even if the caller made constraints immediate.
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check,
    public.expenses_payers_sum_check, public.expense_payers_sum_check deferred;

  if prev.id is null then
    if v_recurrence is not null then
      insert into public.recurring_expenses (
        group_id, description, amount_cents, currency, paid_by, payers, split_type, category,
        splits, items, tax_cents, tip_cents, discount_cents, recurrence, next_run_on, anchor_day,
        notes, created_by
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
        case when write_items then private.normalized_items(p -> 'items') end,
        case when write_items then v_tax end,
        case when write_items then v_tip end,
        case when write_items then v_discount end,
        v_recurrence,
        private.recurring_step(v_spent_at, v_recurrence, extract(day from v_spent_at)::int),
        extract(day from v_spent_at)::int,
        nullif(p ->> 'notes', ''),
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
  -- and the split are listed when their people changed, when they changed without the amount
  -- (a new amount alone already rescales them), or when the caller sent new weights, adjustments
  -- or exact shares.
  if prev.id is not null then
    changes := private.expense_row_changes(prev, result) - 'paid_by' - 'split_type';
    select coalesce(jsonb_object_agg(s.user_id, jsonb_build_array(s.weight, s.adjustment_cents,
             case when result.split_type in ('exact', 'itemized') then s.share_cents end)), '{}'::jsonb)
    into new_split_inputs
    from public.expense_splits s where s.expense_id = result.id;
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
            or (v_amount = prev.amount_cents and new_shares <> old_shares)
            or ((p ? 'splits' or write_items) and new_split_inputs <> old_split_inputs)) then
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
          'currency', result.currency,
          'is_refund', result.is_refund
        ),
        uid
      );
    end if;
  end if;

  return result;
end;
$_$;

-- Body as in 20261113153242_recurring_editing.sql (live copy in schema/current.sql) plus the
-- blocked pair check for people the edit brings in.
CREATE OR REPLACE FUNCTION "public"."update_recurring_expense"("id" "uuid", "payload" "jsonb") RETURNS "public"."recurring_expenses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  rid uuid := update_recurring_expense.id;
  p jsonb := coalesce(payload, '{}'::jsonb);
  my_role public.group_role;
  gid uuid;
  r public.recurring_expenses;
  g public.groups;
  v_description text;
  v_amount bigint;
  v_currency text;
  v_paid_by uuid;
  v_split_type public.split_type;
  v_recurrence public.recurrence;
  v_next date;
  v_refund boolean;
  v_category text;
  v_notes text;
  v_items jsonb;
  v_tax bigint;
  v_tip bigint;
  v_discount bigint;
  v_splits jsonb;
  computed jsonb;
  old_payers jsonb;
  new_payers jsonb;
  result public.recurring_expenses;
  in_it uuid[];
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end if;

  select x.group_id into gid from public.recurring_expenses x where x.id = rid;
  if gid is null then
    raise exception using message = 'recurring_not_found', detail = 'Repeating expense not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups x where x.id = gid for share;
  my_role := private.require_member(gid);
  perform private.require_unarchived(gid);

  select * into r from public.recurring_expenses x where x.id = rid for update;
  if r.id is null then
    raise exception using message = 'recurring_not_found', detail = 'Repeating expense not found', errcode = 'PT404';
  end if;
  if my_role = 'member' and not private.recurring_involves(r.created_by, r.paid_by, r.payers, r.splits, uid) then
    raise exception using message = 'not_allowed', detail = 'Only the people in it or an admin can change it', errcode = '42501';
  end if;
  select * into g from public.groups x where x.id = gid;

  begin
    v_paid_by := coalesce((p ->> 'paid_by')::uuid, r.paid_by);
    v_split_type := coalesce((p ->> 'split_type')::public.split_type, r.split_type);
    v_recurrence := coalesce((p ->> 'recurrence')::public.recurrence, r.recurrence);
    v_next := coalesce((p ->> 'next_run_on')::date, r.next_run_on);
    v_refund := coalesce((p ->> 'is_refund')::boolean, false);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end;
  if v_refund then
    raise exception using message = 'invalid_payload', detail = 'A refund cannot repeat', errcode = '22023';
  end if;

  v_description := btrim(coalesce(p ->> 'description', r.description));
  if v_description = '' then
    raise exception using message = 'description_required', detail = 'Add a description', errcode = '22023';
  end if;
  v_category := case when p ? 'category' then nullif(btrim(p ->> 'category'), '') else r.category end;
  v_notes := case when p ? 'notes' then nullif(p ->> 'notes', '') else r.notes end;

  if p ? 'amount_cents' then
    if jsonb_typeof(p -> 'amount_cents') <> 'number'
       or (p ->> 'amount_cents')::numeric <> trunc((p ->> 'amount_cents')::numeric)
       or (p ->> 'amount_cents')::numeric <= 0
       or (p ->> 'amount_cents')::numeric > 100000000000 then
      raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
    end if;
    v_amount := (p ->> 'amount_cents')::bigint;
  else
    v_amount := r.amount_cents;
  end if;

  v_currency := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), r.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;
  if v_currency <> g.currency and v_currency <> r.currency
     and private.fx_rate(v_currency::char(3), g.currency, current_date) is null then
    raise exception using
      message = 'fx_rate_unavailable',
      detail = format('No exchange rate from %s to %s yet', v_currency, g.currency),
      errcode = '23514';
  end if;

  -- Today is the caller's own day, the one the app shows them.
  if v_next is distinct from r.next_run_on and v_next < private.local_today(uid) then
    raise exception using message = 'invalid_next_run', detail = 'The next one can be today or later', errcode = '22023';
  end if;

  -- Who pays: the same rules as private.save_expense.
  old_payers := coalesce(
    (select jsonb_object_agg(e ->> 'user_id', (e ->> 'paid_cents')::bigint) from jsonb_array_elements(r.payers) e),
    jsonb_build_object(r.paid_by, r.amount_cents));
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
  elsif p ? 'paid_by' or r.payers is null then
    new_payers := jsonb_build_object(v_paid_by, v_amount);
  else
    if v_amount <> r.amount_cents then
      raise exception using
        message = 'payers_sum_mismatch',
        detail = 'Several people pay this; say how much each pays of the new amount',
        errcode = '22023';
    end if;
    new_payers := old_payers;
  end if;

  -- The split: items, a new split, or the stored one (rescaled to a new amount where it can be).
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
    select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'share_cents', c.share_cents) order by c.user_id)
    into v_splits
    from private.itemized_splits(p -> 'items', v_tax, v_tip, v_discount) c
    where c.share_cents > 0;
    if coalesce((select sum((x ->> 'share_cents')::bigint) from jsonb_array_elements(v_splits) x), 0) <> v_amount then
      raise exception using message = 'splits_sum_mismatch', detail = 'The items do not add up to the expense', errcode = '22023';
    end if;
    v_items := private.normalized_items(p -> 'items');
  elsif p ? 'splits' then
    v_splits := p -> 'splits';
  elsif v_split_type = r.split_type and r.items is not null then
    v_splits := r.splits;
    v_items := r.items;
    v_tax := r.tax_cents;
    v_tip := r.tip_cents;
    v_discount := r.discount_cents;
  else
    v_splits := r.splits;
  end if;

  -- Validates the people and amounts (exact shares must add up to the new amount).
  select jsonb_agg(to_jsonb(c)) into computed
  from private.compute_split_rows(v_amount, v_split_type, v_splits) c;

  -- Details of a template that names someone who left stay editable; its money does not, unless
  -- the change takes them out.
  if new_payers is distinct from old_payers or v_splits is distinct from r.splits
     or v_amount <> r.amount_cents or v_currency <> r.currency or v_split_type <> r.split_type then
    if exists (
      select 1 from jsonb_object_keys(new_payers) as k
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = k::uuid)
         or exists (select 1 from public.profiles x where x.id = k::uuid and x.deleted_at is not null)
    ) then
      raise exception using message = 'payer_not_in_group', detail = 'The payer is not in this group', errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint)
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
         or exists (select 1 from public.profiles x where x.id = s.user_id and x.deleted_at is not null)
    ) then
      raise exception using message = 'split_member_not_in_group', detail = 'Everyone in the split must be in the group', errcode = '23514';
    end if;
  end if;

  -- As private.save_expense: nobody the edit brings in may have a block with someone else in it.
  in_it := array(
    select k::uuid from jsonb_object_keys(new_payers) as k
    union
    select s.user_id from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint)
    where s.share_cents > 0
  );
  perform private.require_no_blocked_pair(gid, in_it, array(
    select u from unnest(in_it) as u
    where not exists (select 1 from private.recurring_people(r) as was (w) where was.w = u)
  ));

  update public.recurring_expenses x set
    description = v_description,
    amount_cents = v_amount,
    currency = v_currency,
    paid_by = v_paid_by,
    payers = case when (select count(*) from jsonb_object_keys(new_payers)) > 1 then
      (select jsonb_agg(jsonb_build_object('user_id', j.key, 'paid_cents', j.value::bigint) order by j.key)
       from jsonb_each(new_payers) j)
    end,
    split_type = v_split_type,
    category = v_category,
    splits = v_splits,
    items = v_items,
    tax_cents = case when v_items is not null then v_tax end,
    tip_cents = case when v_items is not null then v_tip end,
    discount_cents = case when v_items is not null then v_discount end,
    recurrence = v_recurrence,
    next_run_on = v_next,
    -- A date picked here becomes the day it repeats on. Changing only the interval keeps the
    -- day a monthly or yearly series already had, so a 31st stays the 31st after a short month.
    anchor_day = case
      when v_next is distinct from r.next_run_on then extract(day from v_next)::smallint
      when v_recurrence is distinct from r.recurrence and r.recurrence in ('weekly', 'biweekly')
        then extract(day from v_next)::smallint
      else private.recurring_anchor_day(r)::smallint
    end,
    notes = v_notes
  where x.id = r.id
  returning * into result;

  if to_jsonb(result) - 'updated_at' <> to_jsonb(r) - 'updated_at' then
    perform private.log_activity(gid, uid, 'recurring.updated', result.id, jsonb_build_object(
      'description', result.description,
      'amount_cents', result.amount_cents,
      'currency', result.currency,
      'recurrence', result.recurrence,
      'next_run_on', result.next_run_on,
      'from_amount_cents', r.amount_cents
    ));
  end if;

  return result;
end;
$_$;

-- Body as in 20261113204239_export_and_import.sql (live copy in schema/current.sql) plus failure
-- step 14.5: an expense row naming two people with a block between them.
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

  -- A 1:1 tab across a block is frozen for the blocked side (ADR 19): said once here, before any
  -- row is read, with the answer private.freeze_blocked_direct_money gives every row it stops.
  if g.is_direct and exists (
    select 1 from public.blocks b
    join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
    where b.blocked_id = uid
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

-- Body as in 20261113091955_expense_entry.sql (live copy in schema/current.sql) plus: a template
-- naming two people with a block between them posts nothing and moves on to its next date.
CREATE OR REPLACE FUNCTION "private"."materialize_recurring_expenses"("run_on" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

      if g.archived_at is not null then
        update public.recurring_expenses x set active = false where x.id = r.id;
        continue;
      end if;

      -- Someone in it left and it was not paused then (a backstop): pause it now.
      if private.recurring_blocked(r) then
        perform private.pause_recurring_for_departed(r, private.recurring_departed(r));
        continue;
      end if;

      due := r.next_run_on;
      anchor_day := private.recurring_anchor_day(r);

      -- Two people in it have a block between them: nothing posts while it stands. The dates
      -- that came due are skipped (lifting the block brings no backlog) and the run goes on.
      if private.recurring_has_blocked_pair(r) then
        while due <= run_on loop
          due := private.recurring_step(due, r.recurrence, anchor_day);
        end loop;
        update public.recurring_expenses x set next_run_on = due where x.id = r.id;
        continue;
      end if;

      runs := 0;
      while due <= run_on and runs < 12 loop
        fx := private.fx_rate(r.currency, g.currency, due);
        exit when fx is null;

        insert into public.expenses (
          group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
          category, spent_at, recurring_id, created_by, tax_cents, tip_cents, discount_cents, notes
        ) values (
          r.group_id, r.description, r.amount_cents, r.currency, fx, r.paid_by, r.split_type,
          r.category, due, r.id, r.created_by,
          case when r.items is not null then r.tax_cents end,
          case when r.items is not null then r.tip_cents end,
          case when r.items is not null then r.discount_cents end,
          r.notes
        )
        returning id into new_id;

        if r.items is not null then
          insert into public.expense_items (expense_id, position, description, amount_cents, user_ids)
          select new_id, (e.ord - 1)::smallint, coalesce(e.elem ->> 'description', ''),
                 (e.elem ->> 'amount_cents')::bigint,
                 array(select x::uuid from jsonb_array_elements_text(e.elem -> 'user_ids') x)
          from jsonb_array_elements(r.items) with ordinality as e (elem, ord);
        end if;

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

-- Body as in 20261113153242_recurring_editing.sql (live copy in schema/current.sql) plus no
-- heads-up for a template that will not post because of a block.
CREATE OR REPLACE FUNCTION "private"."send_recurring_heads_ups"("run_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  r public.recurring_expenses;
  person record;
  sent int := 0;
  today date := (run_at at time zone 'UTC')::date;
  deadline timestamptz;
begin
  for r in
    select x.* from public.recurring_expenses x
    join public.groups g on g.id = x.group_id
    where x.active
      -- UTC+14 is 38 hours ahead of the post at the earliest; nothing earlier can be due.
      and x.next_run_on between today and today + 2
      and g.archived_at is null
    order by x.next_run_on, x.id
    for update of x skip locked
  loop
    begin
      deadline := (r.next_run_on::timestamp + interval '10 minutes') at time zone 'UTC';
      if run_at >= deadline or private.recurring_blocked(r) or private.recurring_has_blocked_pair(r) then
        continue;
      end if;
      for person in
        with shares as (
          select c.user_id, c.share_cents
          from private.compute_split_rows(r.amount_cents, r.split_type, r.splits) c
        ),
        paid as (
          select private.try_uuid(e ->> 'user_id') as user_id, (e ->> 'paid_cents')::bigint as paid_cents
          from jsonb_array_elements(coalesce(r.payers,
            jsonb_build_array(jsonb_build_object('user_id', r.paid_by, 'paid_cents', r.amount_cents)))) e
        )
        select u.user_id, coalesce(s.share_cents, 0) as share_cents, coalesce(pd.paid_cents, 0) as paid_cents, z.tz
        from (select x.user_id from shares x where x.share_cents > 0 union select y.user_id from paid y) u
        join public.profiles p on p.id = u.user_id and p.deleted_at is null
        cross join lateral (select private.user_time_zone(u.user_id) as tz) z
        left join shares s on s.user_id = u.user_id
        left join paid pd on pd.user_id = u.user_id
        where ((r.next_run_on - 1)::timestamp + interval '9 hours') at time zone z.tz <= run_at
          and not exists (
            select 1 from private.recurring_heads_ups h
            where h.recurring_id = r.id and h.posts_on = r.next_run_on and h.user_id = u.user_id
          )
      loop
        perform private.notify(array[person.user_id], 'recurring.upcoming', jsonb_build_object(
          'recurring_id', r.id,
          'group_id', r.group_id,
          'description', r.description,
          'amount_cents', r.amount_cents,
          'currency', r.currency,
          'posts_on', r.next_run_on,
          'deadline', deadline,
          'timezone', person.tz,
          'recurrence', r.recurrence,
          'share_cents', person.share_cents,
          'paid_cents', person.paid_cents,
          -- Late and at night where they are: let them sleep.
          'quiet', (run_at at time zone person.tz)::time not between '07:00' and '21:59:59.999999'
        ));
        insert into private.recurring_heads_ups (recurring_id, posts_on, user_id)
        values (r.id, r.next_run_on, person.user_id)
        on conflict do nothing;
        sent := sent + 1;
      end loop;
    exception
      when others then
        raise warning 'recurring heads-up % skipped: %', r.id, sqlerrm;
    end;
  end loop;
  return sent;
end;
$$;

-- Body as in 20261114060521_can_split_with.sql plus: in a 1:1 tab that already exists, a block
-- either way is a no too (it was a no only for the blocked side). Still a plain no.
create or replace function public.can_split_with(person uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if person is null or person = uid then
    return false;
  end if;

  if exists (
    select 1 from public.groups g
    where g.is_direct
      and g.deleted_at is null
      and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
      and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = person)
  ) then
    return not private.has_block(uid, person);
  end if;

  return exists (
      select 1 from public.profiles p
      where p.id = person
        and p.deleted_at is null
        and not p.is_placeholder
        and p.id in (select private.my_contact_ids())
    )
    and not private.has_block(uid, person);
end;
$$;

revoke execute on function public.can_split_with(uuid) from public, anon;
grant execute on function public.can_split_with(uuid) to authenticated, service_role;
