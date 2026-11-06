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

revoke execute on function
  private.recurring_step(date, public.recurrence, int),
  private.recurring_anchor_day(public.recurring_expenses),
  private.recurring_skip_paused(),
  private.guard_group_delete(),
  private.require_unarchived(uuid)
from public, anon, authenticated;
