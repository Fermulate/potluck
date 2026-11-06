-- Fixes from the code review. Every function keeps its signature and grants.
--
--   * Archived groups are read only for money: delete_expense, restore_expense,
--     settle_up and delete_settlement raise group_archived like save_expense.
--   * A group with open balances cannot be deleted (group_has_balances), by
--     any role. delete_my_account may still remove a group nobody active is
--     left in.
--   * Resuming a paused recurring expense moves next_run_on to the next
--     occurrence on or after today, so paused periods are never charged.
--   * Recurring templates stop when their payer or anyone in the split has
--     closed their account.
--   * Editing an expense paid by someone who has left the group works as long
--     as the payer stays the same (the split already kept stored shares when
--     it is not resent).

-- Recurrence steps --------------------------------------------------------------------------

-- The run after `due`. Monthly and yearly runs keep `anchor_day`, clamped to
-- the month end (Jan 31, Feb 28, Mar 31), like nextOccurrence in packages/core.
create or replace function private.recurring_step(due date, kind public.recurrence, anchor_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when kind = 'weekly' then due + 7
    else (
      select least(s.start + (anchor_day - 1), (s.start + interval '1 month')::date - 1)
      from (
        select (date_trunc('month', due::timestamp) + case kind
          when 'monthly' then interval '1 month'
          else interval '1 year' end)::date as start
      ) s
    )
  end;
$$;

-- The day of month a monthly or yearly series runs on: that of its first
-- expense, else of its next run.
create or replace function private.recurring_anchor_day(r public.recurring_expenses)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select extract(day from coalesce(
    (select min(e.spent_at) from public.expenses e where e.recurring_id = r.id),
    r.next_run_on))::int;
$$;

-- Resuming never back-charges: when a template goes from paused to active with
-- a next run in the past, skip ahead to the first occurrence on or after today.
create or replace function private.recurring_skip_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  anchor int;
begin
  if new.next_run_on >= current_date then
    return new;
  end if;
  if new.recurrence = 'weekly' then
    new.next_run_on := new.next_run_on + 7 * ceil((current_date - new.next_run_on) / 7.0)::int;
    return new;
  end if;
  anchor := private.recurring_anchor_day(new);
  while new.next_run_on < current_date loop
    new.next_run_on := private.recurring_step(new.next_run_on, new.recurrence, anchor);
  end loop;
  return new;
end;
$$;

create trigger recurring_expenses_skip_paused
before update of active on public.recurring_expenses
for each row
when (old.active is false and new.active is true)
execute function private.recurring_skip_paused();

-- Recurring job: closed accounts ------------------------------------------------------------

create or replace function private.materialize_recurring_expenses(run_on date default current_date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
  g public.groups;
  fx numeric;
  new_id uuid;
  due date;
  anchor_day int;
  runs int;
  made int := 0;
begin
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check deferred;

  for r in
    select * from public.recurring_expenses x
    where x.active and x.next_run_on <= run_on
    order by x.next_run_on, x.id
    for update skip locked
  loop
    begin
      select * into g from public.groups x where x.id = r.group_id;

      if g.archived_at is not null
         or not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = r.paid_by)
         or exists (
           select 1 from jsonb_array_elements(r.splits) e
           where not exists (
             select 1 from public.group_members m
             where m.group_id = r.group_id and m.user_id = (e ->> 'user_id')::uuid
           )
         )
         or exists (
           select 1 from public.profiles p
           where p.deleted_at is not null
             and (p.id = r.paid_by
                  or p.id in (select (e ->> 'user_id')::uuid from jsonb_array_elements(r.splits) e))
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

        insert into public.expense_splits (expense_id, user_id, share_cents, weight)
        select new_id, c.user_id, c.share_cents, c.weight
        from private.compute_splits(r.amount_cents, r.split_type, r.splits) c;

        due := private.recurring_step(due, r.recurrence, anchor_day);
        runs := runs + 1;
        made := made + 1;
      end loop;

      update public.recurring_expenses x set next_run_on = due where x.id = r.id;
    exception
      when others then
        raise warning 'recurring expense % skipped: %', r.id, sqlerrm;
    end;
  end loop;

  return made;
end;
$$;

-- Deleting groups with open balances --------------------------------------------------------

create or replace function private.guard_group_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('potluck.closing_account', true) is distinct from 'on'
     and exists (
       select 1 from public.group_balances b
       where b.group_id = old.id and b.net_cents <> 0
     ) then
    raise exception using
      message = 'group_has_balances',
      detail = 'Settle every balance before deleting this group',
      errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger groups_guard_delete
before delete on public.groups
for each row
execute function private.guard_group_delete();

-- Closing an account: same as before, plus recurring templates the user pays
-- or splits are paused, and an owned group with nobody active left is removed
-- even if former members still have balances there.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owned record;
  heir uuid;
begin
  if uid is null then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;

  if exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is not null) then
    return;
  end if;

  for owned in
    select m.group_id from public.group_members m where m.user_id = uid and m.role = 'owner'
  loop
    select m.user_id into heir
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = owned.group_id and m.user_id <> uid and p.deleted_at is null
    order by (m.role = 'admin') desc, m.joined_at, m.user_id
    limit 1;

    if heir is null then
      perform set_config('potluck.closing_account', 'on', true);
      delete from public.groups g where g.id = owned.group_id;
      perform set_config('potluck.closing_account', '', true);
    else
      update public.group_members m set role = 'member'
      where m.group_id = owned.group_id and m.user_id = uid;
      update public.group_members m set role = 'owner'
      where m.group_id = owned.group_id and m.user_id = heir;
    end if;
  end loop;

  update public.recurring_expenses r set active = false
  where r.active
    and (r.paid_by = uid or r.splits @> jsonb_build_array(jsonb_build_object('user_id', uid)));

  delete from public.group_members m
  where m.user_id = uid
    and private.member_balance(m.group_id, uid) = 0;

  delete from public.push_tokens t where t.user_id = uid;
  delete from public.calendar_connections c where c.user_id = uid;
  delete from public.busy_blocks b where b.user_id = uid;
  delete from public.notifications n where n.user_id = uid;
  delete from public.availability a where a.user_id = uid;
  delete from public.availability_requests r where r.user_id = uid;
  delete from public.event_rsvps r where r.user_id = uid;
  delete from public.friendships f where f.user_id = uid or f.friend_id = uid;
  delete from public.blocks b where b.blocker_id = uid or b.blocked_id = uid;

  update public.group_invites i set revoked_at = now()
  where i.created_by = uid and i.revoked_at is null;

  update public.profiles p set
    display_name = 'Former member',
    avatar_path = null,
    timezone = 'UTC',
    locale = 'en',
    deleted_at = now()
  where p.id = uid;
end;
$$;

-- Archived groups ---------------------------------------------------------------------------

create or replace function private.require_unarchived(gid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.groups g where g.id = gid and g.archived_at is not null) then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;
end;
$$;

-- Used by delete_expense and restore_expense.
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
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  my_role := private.require_member(e.group_id);
  if my_role = 'member' and uid is distinct from e.created_by and uid <> e.paid_by then
    raise exception using message = 'not_allowed', detail = 'You can only change your own expenses', errcode = '42501';
  end if;
  perform private.require_unarchived(e.group_id);
  return e;
end;
$$;

create or replace function public.settle_up(
  group_id uuid,
  to_user uuid,
  amount_cents bigint,
  currency text default null,
  note text default null
)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  payer uuid := uid;
  g public.groups;
  cur text;
  fx numeric;
  result public.settlements;
begin
  perform private.require_member(settle_up.group_id);
  perform private.require_unarchived(settle_up.group_id);
  select * into g from public.groups x where x.id = settle_up.group_id;

  if settle_up.amount_cents is null or settle_up.amount_cents <= 0 or settle_up.amount_cents > 100000000000 then
    raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
  end if;
  if settle_up.to_user is null or settle_up.to_user = payer then
    raise exception using message = 'invalid_recipient', detail = 'Pick who you paid', errcode = '22023';
  end if;
  if (
    select count(*) from public.group_members m
    where m.group_id = settle_up.group_id and m.user_id in (payer, settle_up.to_user)
  ) <> 2 then
    raise exception using message = 'member_not_found', detail = 'Both people must be in the group', errcode = 'PT404';
  end if;

  cur := upper(coalesce(nullif(btrim(settle_up.currency), ''), g.currency));
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;
  fx := private.fx_rate(cur::char(3), g.currency, current_date);
  if fx is null then
    raise exception using
      message = 'fx_rate_unavailable',
      detail = format('No exchange rate from %s to %s yet', cur, g.currency),
      errcode = '23514';
  end if;

  insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
  values (
    settle_up.group_id, payer, settle_up.to_user, settle_up.amount_cents, cur, fx,
    nullif(btrim(settle_up.note), ''), now(), uid
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.delete_settlement(id uuid)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.settlements;
  my_role public.group_role;
  uid uuid := private.require_user();
begin
  select * into s from public.settlements x where x.id = delete_settlement.id for update;
  if s.id is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  my_role := private.require_member(s.group_id);
  if my_role = 'member' and uid not in (s.from_user, s.to_user) and uid is distinct from s.created_by then
    raise exception using message = 'not_allowed', detail = 'You can only remove payments you were part of', errcode = '42501';
  end if;
  perform private.require_unarchived(s.group_id);

  update public.settlements x set deleted_at = coalesce(x.deleted_at, now())
  where x.id = s.id
  returning * into s;
  return s;
end;
$$;

-- Expenses paid by former members ---------------------------------------------------------

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
    my_role := private.require_member(gid);
  else
    select * into prev from public.expenses e where e.id = eid for update;
    if prev.id is null then
      raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
    end if;
    gid := prev.group_id;
    my_role := private.require_member(gid);
    if my_role = 'member' and uid is distinct from prev.created_by and uid <> prev.paid_by then
      raise exception using message = 'not_allowed', detail = 'You can only edit your own expenses', errcode = '42501';
    end if;
    if prev.deleted_at is not null then
      raise exception using message = 'expense_deleted', detail = 'Restore this expense before editing it', errcode = '23514';
    end if;
    if p ? 'group_id' and (p ->> 'group_id') is distinct from gid::text then
      raise exception using message = 'invalid_payload', detail = 'An expense cannot move to another group', errcode = '22023';
    end if;
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
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end;

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
  if v_paid_by is distinct from prev.paid_by
     and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = v_paid_by) then
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
  if p ? 'splits' then
    split_input := p -> 'splits';
    rewrite_splits := true;
  elsif prev.id is null then
    raise exception using message = 'splits_required', detail = 'Add at least one person to the split', errcode = '22023';
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
      raise exception using message = 'split_member_not_in_group', detail = 'Everyone in the split must be in the group', errcode = '23514';
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

revoke execute on function
  private.recurring_step(date, public.recurrence, int),
  private.recurring_anchor_day(public.recurring_expenses),
  private.recurring_skip_paused(),
  private.guard_group_delete(),
  private.require_unarchived(uuid)
from public, anon, authenticated;
