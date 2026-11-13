-- Repeating expenses you can change: edit the amount, payers and split of a template (several
-- payers, adjustments and items included), every 2 weeks, make an existing expense repeat, skip
-- one occurrence, and a heads-up the day before one posts. Design: ADR 14.
--
-- A template is a recipe for future expenses only: changing it never touches an expense that
-- already posted. It now keeps a by-item bill as entered (items, tax, tip, discount) so editing
-- reopens it and every posted copy carries the same items, and the day of the month it repeats
-- on (anchor_day), so moving rent from the 1st to the 5th sticks through short months, and its
-- notes, which every posted copy gets.
--
-- Who may change a template follows the expense rules: an admin, or anyone it involves (whoever
-- set it up, a payer, or someone in the split). "Today" for the next date is the caller's own day
-- (profiles.timezone), the same day the app shows them.
--
-- New:
--   public.update_recurring_expense(id, payload)    edit a template, validated like create_expense_v2
--   public.skip_recurring_expense(id)               skip the next occurrence
--   public.make_expense_recurring(expense_id, recurrence)  an existing expense starts repeating
--   private.send_recurring_heads_ups(run_at)        cron 'recurring-heads-up' (:05, :35): recurring.upcoming
--                                                   at 09:00 on each person's local day before it posts
--   private.recurring_heads_ups                     who was told about which occurrence (once each)
--   private.recurring_departed(r) / recurring_blocked(r)  people it names who left or closed their account
--   private.recurring_involves(...)                 policy helper: the caller is in this template
--   private.local_today(uid)                        the calendar day in someone's own time zone
--   private.recurring_next_from(start, kind, anchor, not_before)  same rule as core firstOccurrenceFrom
--   private.normalized_items(items)                 a by-item bill as stored on a template
--   trigger recurring_expenses_require_members      a template naming someone who left cannot resume
--   trigger group_members_pause_recurring           leaving or being removed pauses the templates
--                                                   naming that person (pause_recurring_naming)
--   private.pause_recurring_for_departed(r, gone)   pause, log recurring.paused, tell the creator
--   private.user_time_zone(uid)                     profiles.timezone when valid, otherwise UTC
--   policies "involved or admin" for update and delete, replacing "creator or admin"
--
-- Redefined (bodies as in supabase/schema/current.sql, i.e. 20261113091955_expense_entry.sql and
-- 20261106000000_review_fixes.sql, plus the changes noted):
--   private.recurring_step           plus 'biweekly' (14 days)
--   private.recurring_anchor_day     prefers the stored anchor_day
--   private.recurring_skip_paused    steps biweekly templates 14 days at a time
--   private.save_expense             the template it creates stores items, notes and the anchor day
--                                    and takes its first date from recurring_step (biweekly too)
--   private.route_notification       a notification marked quiet (data.quiet) stays in the inbox
--                                    (body as in 20261113062656_notification_prefs_and_email.sql)
--   private.materialize_recurring_expenses  the people check moved to recurring_blocked, and a
--                                    template it pauses for that (a backstop) goes through
--                                    pause_recurring_for_departed; posted copies carry items, tax,
--                                    tip, discount, notes
--   public.delete_my_account         (20261106010000_integrity_fixes.sql) pauses through
--                                    pause_recurring_naming instead of silently
--
-- Edits go through update_recurring_expense: the direct column grants on description, category
-- and next_run_on are revoked (only active stays, for pause and resume).

-- Template columns -------------------------------------------------------------------------------

alter table public.recurring_expenses
  add column items jsonb
    check (items is null or (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 200)),
  add column tax_cents bigint check (tax_cents >= 0 and tax_cents <= 100000000000),
  add column tip_cents bigint check (tip_cents >= 0 and tip_cents <= 100000000000),
  add column discount_cents bigint check (discount_cents >= 0 and discount_cents <= 100000000000),
  add column anchor_day smallint check (anchor_day between 1 and 31),
  add column notes text check (char_length(notes) <= 2000);

comment on column public.recurring_expenses.items is
  'A by-item bill as entered: [{description, amount_cents, user_ids}], or null. splits then holds the shares worked out from it.';
comment on column public.recurring_expenses.anchor_day is
  'Day of the month monthly and yearly templates repeat on (short months clamp to their last day). Kept when only the interval changes. Null: the day of the first posted expense.';
comment on column public.recurring_expenses.notes is
  'Copied to every posted expense.';

-- One row per person told about one occurrence, so the hourly heads-up job never repeats itself.
create table private.recurring_heads_ups (
  recurring_id uuid not null references public.recurring_expenses (id) on delete cascade,
  posts_on date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (recurring_id, posts_on, user_id)
);
create index recurring_heads_ups_user_id_idx on private.recurring_heads_ups (user_id);
alter table private.recurring_heads_ups enable row level security;
revoke all on table private.recurring_heads_ups from public, anon, authenticated;
grant all on table private.recurring_heads_ups to service_role;

-- Someone's own time zone: profiles.timezone when Postgres knows it, otherwise UTC (the app
-- stores whatever zone the device reports).
create or replace function private.user_time_zone(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.timezone from public.profiles p where p.id = uid and private.is_time_zone(p.timezone)),
    'UTC');
$$;

-- The calendar day it is for someone, in their own zone.
create or replace function private.local_today(uid uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone private.user_time_zone(uid))::date;
$$;

-- Whether someone is in a template: set it up, pays it, or has a place in its split. Used by the
-- update and delete policies and by the RPCs, so the rule matches expenses (ADR 12).
create or replace function private.recurring_involves(
  created_by uuid, paid_by uuid, payers jsonb, splits jsonb, uid uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select uid is not null and (
    uid = created_by
    or uid = paid_by
    or coalesce(payers, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('user_id', uid))
    or coalesce(splits, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('user_id', uid))
  );
$$;

drop policy if exists "recurring_expenses: creator or admin edit" on public.recurring_expenses;
drop policy if exists "recurring_expenses: creator or admin delete" on public.recurring_expenses;

create policy "recurring_expenses: involved or admin edit" on public.recurring_expenses
for update to authenticated
using (
  (select private.is_group_admin(group_id))
  or (group_id = any (array(select private.my_group_ids()))
      and private.recurring_involves(created_by, paid_by, payers, splits, (select auth.uid())))
)
with check (
  ((select private.is_group_admin(group_id))
   or (group_id = any (array(select private.my_group_ids()))
       and private.recurring_involves(created_by, paid_by, payers, splits, (select auth.uid()))))
  and (select private.group_is_open(group_id))
);

create policy "recurring_expenses: involved or admin delete" on public.recurring_expenses
for delete to authenticated
using (
  (select private.is_group_admin(group_id))
  or (group_id = any (array(select private.my_group_ids()))
      and private.recurring_involves(created_by, paid_by, payers, splits, (select auth.uid())))
);

-- Schedule helpers --------------------------------------------------------------------------------

create or replace function private.recurring_step(due date, kind public.recurrence, anchor_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when kind = 'weekly' then due + 7
    when kind = 'biweekly' then due + 14
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

create or replace function private.recurring_anchor_day(r public.recurring_expenses)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.anchor_day, extract(day from coalesce(
    (select min(e.spent_at) from public.expenses e where e.recurring_id = r.id),
    r.next_run_on))::int);
$$;

-- The first occurrence after `start` that falls on or after `not_before`. Same rule and cases as
-- firstOccurrenceFrom in packages/core/src/recurrence.
create or replace function private.recurring_next_from(start date, kind public.recurrence, anchor int, not_before date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  d date := private.recurring_step(start, kind, anchor);
begin
  if kind in ('weekly', 'biweekly') and d < not_before then
    return d + (case kind when 'weekly' then 7 else 14 end)
      * ceil((not_before - d) / (case kind when 'weekly' then 7.0 else 14.0 end))::int;
  end if;
  while d < not_before loop
    d := private.recurring_step(d, kind, anchor);
  end loop;
  return d;
end;
$$;

create or replace function private.recurring_skip_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  step int;
  anchor int;
begin
  if new.next_run_on >= current_date then
    return new;
  end if;
  if new.recurrence in ('weekly', 'biweekly') then
    step := case new.recurrence when 'weekly' then 7 else 14 end;
    new.next_run_on := new.next_run_on + step * ceil((current_date - new.next_run_on) / step::numeric)::int;
    return new;
  end if;
  anchor := private.recurring_anchor_day(new);
  while new.next_run_on < current_date loop
    new.next_run_on := private.recurring_step(new.next_run_on, new.recurrence, anchor);
  end loop;
  return new;
end;
$$;

-- Everyone a template names: payers and the people in the split.
create or replace function private.recurring_people(r public.recurring_expenses)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select r.paid_by
  union
  select private.try_uuid(e ->> 'user_id') from jsonb_array_elements(coalesce(r.payers, '[]'::jsonb)) e
  union
  select private.try_uuid(e ->> 'user_id') from jsonb_array_elements(r.splits) e;
$$;

-- The people a template names who have left the group or closed their account.
create or replace function private.recurring_departed(r public.recurring_expenses)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(people.u order by people.u), '{}')
  from private.recurring_people(r) as people (u)
  where people.u is not null
    and (not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = people.u)
         or exists (select 1 from public.profiles p where p.id = people.u and p.deleted_at is not null));
$$;

-- A template that names someone who has left the group or closed their account (or a malformed
-- person) cannot post: nothing may move a former member's balance.
create or replace function private.recurring_blocked(r public.recurring_expenses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(private.recurring_departed(r)) > 0
    or exists (select 1 from private.recurring_people(r) as people (u) where people.u is null);
$$;

-- Pauses a template that names someone who left, says so in the group's activity and tells
-- whoever set it up (or the owner and admins, if they are gone too) so they can take that person
-- out. `gone` is who left, for the copy.
create or replace function private.pause_recurring_for_departed(r public.recurring_expenses, gone uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recurring_expenses x set active = false where x.id = r.id;
  perform private.log_activity(r.group_id, null, 'recurring.paused', r.id, jsonb_build_object(
    'description', r.description,
    'reason', 'member_left',
    'user_ids', to_jsonb(gone)
  ));
  perform private.notify(
    array(
      select m.user_id from public.group_members m
      join public.profiles p on p.id = m.user_id and p.deleted_at is null
      where m.group_id = r.group_id
        and (m.user_id = r.created_by
             or (m.role in ('owner', 'admin')
                 and not exists (
                   select 1 from public.group_members c
                   join public.profiles cp on cp.id = c.user_id and cp.deleted_at is null
                   where c.group_id = r.group_id and c.user_id = r.created_by)))
    ),
    'recurring.paused',
    jsonb_build_object(
      'recurring_id', r.id,
      'group_id', r.group_id,
      'description', r.description,
      'user_ids', to_jsonb(gone)
    )
  );
end;
$$;

-- Someone left a group (gid) or closed their account (gid null): every running template in an
-- open group that names them pauses now, not on its next due date.
create or replace function private.pause_recurring_naming(uid uuid, gid uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
begin
  for r in
    select x.* from public.recurring_expenses x
    join public.groups g on g.id = x.group_id and g.archived_at is null
    where x.active
      and (gid is null or x.group_id = gid)
      and exists (select 1 from private.recurring_people(x) as people (u) where people.u = uid)
    order by x.group_id, x.id
    for update of x
  loop
    perform private.pause_recurring_for_departed(r, private.recurring_departed(r));
  end loop;
end;
$$;

-- Leaving, being removed and closing an account all delete the membership row.
create or replace function private.group_members_pause_recurring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.pause_recurring_naming(old.user_id, old.group_id);
  return null;
end;
$$;

create trigger group_members_pause_recurring
after delete on public.group_members
for each row
execute function private.group_members_pause_recurring();

-- A by-item bill as a template stores it, in the order entered. Items are validated by
-- private.itemized_splits before this runs.
create or replace function private.normalized_items(items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object(
    'description', btrim(coalesce(e.elem ->> 'description', '')),
    'amount_cents', (e.elem ->> 'amount_cents')::bigint,
    'user_ids', to_jsonb(array(
      select distinct x::uuid from jsonb_array_elements_text(e.elem -> 'user_ids') x order by 1))
  ) order by e.ord)
  from jsonb_array_elements(items) with ordinality as e (elem, ord);
$$;

-- Resuming a template that still names someone who left would only be paused again by the job;
-- say so instead.
create or replace function private.recurring_require_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.recurring_blocked(new) then
    raise exception using
      message = 'split_member_not_in_group',
      detail = 'Someone in this repeating expense has left the group; take them out first',
      errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger recurring_expenses_require_members
before update of active on public.recurring_expenses
for each row
when (old.active is false and new.active is true)
execute function private.recurring_require_members();


-- private.save_expense: body as in 20261113091955_expense_entry.sql; the recurring template insert
-- stores items and the anchor day and takes its first date from recurring_step.

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


-- private.materialize_recurring_expenses: body as in 20261113091955_expense_entry.sql; the people
-- check is private.recurring_blocked (pausing through private.pause_recurring_for_departed) and
-- posted copies carry the template's items.

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


-- public.delete_my_account: body as in 20261106010000_integrity_fixes.sql, except that templates
-- naming the closed account are paused at the end through private.pause_recurring_naming (logged,
-- whoever set them up told) instead of silently up front. Groups it leaves outright are handled by
-- the group_members_pause_recurring trigger.

CREATE OR REPLACE FUNCTION "public"."delete_my_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  perform 1 from public.groups g
  where g.id in (select m.group_id from public.group_members m where m.user_id = uid)
  order by g.id
  for no key update;

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

  perform private.pause_recurring_naming(uid);
end;
$$;


-- Editing a template --------------------------------------------------------------------------------

-- Same payload as create_expense_v2 / update_expense_v2 (description, amount_cents, currency,
-- paid_by, payers, split_type, splits, items, tax_cents, tip_cents, discount_cents, category)
-- plus notes, recurrence and next_run_on. Missing keys keep the stored value. Expenses
-- that already posted never change. An admin or anyone it involves may edit (as for expenses).
create or replace function public.update_recurring_expense(id uuid, payload jsonb)
returns public.recurring_expenses
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Skips the next occurrence: nothing posts for it and the date moves one step on.
create or replace function public.skip_recurring_expense(id uuid)
returns public.recurring_expenses
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  rid uuid := skip_recurring_expense.id;
  my_role public.group_role;
  gid uuid;
  r public.recurring_expenses;
  result public.recurring_expenses;
begin
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

  update public.recurring_expenses x
  set next_run_on = private.recurring_step(r.next_run_on, r.recurrence, private.recurring_anchor_day(r))
  where x.id = r.id
  returning * into result;

  perform private.log_activity(gid, uid, 'recurring.skipped', result.id, jsonb_build_object(
    'description', result.description,
    'amount_cents', result.amount_cents,
    'currency', result.currency,
    'skipped_on', r.next_run_on,
    'next_run_on', result.next_run_on
  ));
  return result;
end;
$$;

-- An expense that already happened starts repeating: a template with the same amount, payers,
-- split and items. The next one is one period after the expense's date, or the first date after
-- that which is not in the past (missed periods are not back-charged). Whoever may edit the
-- expense may do this.
create or replace function public.make_expense_recurring(expense_id uuid, recurrence public.recurrence)
returns public.recurring_expenses
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  eid uuid := make_expense_recurring.expense_id;
  kind public.recurrence := make_expense_recurring.recurrence;
  my_role public.group_role;
  gid uuid;
  e public.expenses;
  v_splits jsonb;
  v_items jsonb;
  v_payers jsonb;
  result public.recurring_expenses;
begin
  if kind is null then
    raise exception using message = 'invalid_payload', detail = 'Pick how often it repeats', errcode = '22023';
  end if;
  select x.group_id into gid from public.expenses x where x.id = eid;
  if gid is null then
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups x where x.id = gid for share;
  my_role := private.require_member(gid);
  perform private.require_unarchived(gid);

  select * into e from public.expenses x where x.id = eid for update;
  if my_role = 'member' and uid is distinct from e.created_by and uid is distinct from e.paid_by
     and not exists (select 1 from public.expense_payers x where x.expense_id = e.id and x.user_id = uid) then
    raise exception using message = 'not_allowed', detail = 'You can only edit your own expenses', errcode = '42501';
  end if;
  if e.deleted_at is not null then
    raise exception using message = 'expense_deleted', detail = 'Restore this expense before editing it', errcode = '23514';
  end if;
  if e.recurring_id is not null then
    raise exception using message = 'already_recurring', detail = 'This expense already repeats', errcode = '23514';
  end if;
  if e.is_refund then
    raise exception using message = 'invalid_payload', detail = 'A refund cannot repeat', errcode = '22023';
  end if;
  if exists (
    select 1 from (
      select x.user_id from public.expense_payers x where x.expense_id = e.id
      union
      select x.user_id from public.expense_splits x where x.expense_id = e.id and x.share_cents > 0
    ) people
    where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = people.user_id)
       or exists (select 1 from public.profiles p where p.id = people.user_id and p.deleted_at is not null)
  ) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  -- The split in the create_expense payload format, from the stored rows.
  select jsonb_agg(case
      when e.split_type = 'equal' then jsonb_build_object('user_id', s.user_id)
      when e.split_type in ('percent', 'shares') then jsonb_build_object('user_id', s.user_id, 'weight', s.weight)
      when e.split_type = 'adjustment' then
        jsonb_build_object('user_id', s.user_id, 'adjustment_cents', coalesce(s.adjustment_cents, 0))
      else jsonb_build_object('user_id', s.user_id, 'share_cents', s.share_cents)
    end order by s.user_id)
  into v_splits
  from public.expense_splits s
  where s.expense_id = e.id
    and (e.split_type not in ('exact', 'itemized') or s.share_cents > 0);

  if e.split_type = 'itemized' then
    select jsonb_agg(jsonb_build_object('description', i.description, 'amount_cents', i.amount_cents,
             'user_ids', to_jsonb(i.user_ids)) order by i.position)
    into v_items
    from public.expense_items i where i.expense_id = e.id;
  end if;

  select case when count(*) > 1 then
      jsonb_agg(jsonb_build_object('user_id', x.user_id, 'paid_cents', x.paid_cents) order by x.user_id)
    end
  into v_payers
  from public.expense_payers x where x.expense_id = e.id;

  insert into public.recurring_expenses (
    group_id, description, amount_cents, currency, paid_by, payers, split_type, category,
    splits, items, tax_cents, tip_cents, discount_cents, recurrence, next_run_on, anchor_day,
    notes, created_by
  ) values (
    gid, e.description, e.amount_cents, e.currency, e.paid_by, v_payers, e.split_type, e.category,
    v_splits, v_items,
    case when v_items is not null then e.tax_cents end,
    case when v_items is not null then e.tip_cents end,
    case when v_items is not null then e.discount_cents end,
    kind,
    -- Not before the caller's own today, the day the app previews.
    private.recurring_next_from(e.spent_at, kind, extract(day from e.spent_at)::int, private.local_today(uid)),
    extract(day from e.spent_at)::smallint,
    e.notes,
    uid
  )
  returning * into result;

  update public.expenses x set recurring_id = result.id where x.id = e.id;

  perform private.log_activity(gid, uid, 'recurring.created', result.id, jsonb_build_object(
    'description', result.description,
    'amount_cents', result.amount_cents,
    'currency', result.currency,
    'recurrence', result.recurrence,
    'next_run_on', result.next_run_on,
    'expense_id', e.id
  ));
  return result;
end;
$$;

-- Heads-up -------------------------------------------------------------------------------------

-- Before a template posts, everyone it names (payers and people with a share) gets one
-- recurring.upcoming notification with their own share. It is due at 09:00 on that person's
-- local day before the posting date (private.user_time_zone), or, when that moment
-- has passed (the template was set up or moved late), on the next run, but never once the
-- copy has posted (00:10 UTC on the posting date). The payload carries the posting date, that
-- deadline and the person's zone, so every channel can say both in their own time. A late one
-- that would land between 22:00 and 07:00 their time is marked quiet: inbox only, no push or
-- email (private.route_notification).
-- private.recurring_heads_ups remembers who heard about which date, so the job never repeats
-- itself. Paused templates, archived groups and templates naming someone who left are skipped.
-- Each person turns heads-ups off with their own Reminders setting. Runs from cron 'recurring-heads-up' (:05 and :35 every hour).
create or replace function private.send_recurring_heads_ups(run_at timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
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
      if run_at >= deadline or private.recurring_blocked(r) then
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

-- recurring.upcoming already maps to 'reminders' (20261113062656_notification_prefs_and_email.sql);
-- kept here so this migration stands on its own. recurring.paused (the job paused one because
-- someone in it left) follows the "edits and deletions" setting.
insert into private.notification_types (type, category) values
  ('recurring.upcoming', 'reminders'),
  ('recurring.paused', 'expense_changed')
on conflict (type) do nothing;

-- private.route_notification: body as in 20261113062656_notification_prefs_and_email.sql plus
-- quiet notifications (data.quiet = true): inbox only, never pushed or emailed.
create or replace function private.route_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.channels := case
    when new.data ->> 'quiet' = 'true' then '{}'::text[]
    else private.notification_channels(new.user_id, new.type)
  end;
  return new;
end;
$$;

-- Grants ------------------------------------------------------------------------------------------

revoke execute on function public.update_recurring_expense(uuid, jsonb) from public, anon;
grant execute on function public.update_recurring_expense(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.skip_recurring_expense(uuid) from public, anon;
grant execute on function public.skip_recurring_expense(uuid) to authenticated, service_role;
revoke execute on function public.make_expense_recurring(uuid, public.recurrence) from public, anon;
grant execute on function public.make_expense_recurring(uuid, public.recurrence) to authenticated, service_role;

revoke execute on function
  private.recurring_step(date, public.recurrence, int),
  private.recurring_anchor_day(public.recurring_expenses),
  private.recurring_next_from(date, public.recurrence, int, date),
  private.recurring_skip_paused(),
  private.recurring_people(public.recurring_expenses),
  private.recurring_departed(public.recurring_expenses),
  private.recurring_blocked(public.recurring_expenses),
  private.local_today(uuid),
  private.user_time_zone(uuid),
  private.pause_recurring_for_departed(public.recurring_expenses, uuid[]),
  private.pause_recurring_naming(uuid, uuid),
  private.group_members_pause_recurring(),
  private.normalized_items(jsonb),
  private.recurring_require_members(),
  private.send_recurring_heads_ups(timestamptz),
  private.materialize_recurring_expenses(date),
  private.save_expense(uuid, jsonb)
from public, anon, authenticated;

-- Edits go through update_recurring_expense; pause and resume stay a direct update of active.
revoke update (description, category, next_run_on) on public.recurring_expenses from authenticated;

-- The update and delete policies call this one.
revoke execute on function private.recurring_involves(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function private.recurring_involves(uuid, uuid, jsonb, jsonb, uuid) to authenticated, service_role;

-- Jobs ----------------------------------------------------------------------------------------------

-- At :05 and :35, so 09:00 local lands at about 09:05 in whole-hour and half-hour zones alike,
-- and the 00:05 UTC run is a last chance before expenses post at 00:10 UTC
-- (materialize-recurring-expenses).
select cron.schedule('recurring-heads-up', '5,35 * * * *',
  $$select private.send_recurring_heads_ups()$$);
