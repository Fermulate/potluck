-- Expenses, splits, recurring templates, settlements and FX rates.
-- Money is integer minor units (cents). fx_rate converts into the group currency
-- and is snapshotted when the row is written.

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_by uuid not null references public.profiles (id) on delete cascade,
  split_type public.split_type not null default 'equal',
  category text check (char_length(category) <= 40),
  splits jsonb not null default '[]'::jsonb check (jsonb_typeof(splits) = 'array'),
  recurrence public.recurrence not null,
  next_run_on date not null,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.recurring_expenses.splits is
  'Array of {user_id, share_cents?, weight?} in the create_expense payload format.';

create index recurring_expenses_group_id_idx on public.recurring_expenses (group_id);
create index recurring_expenses_paid_by_idx on public.recurring_expenses (paid_by);
create index recurring_expenses_created_by_idx on public.recurring_expenses (created_by);
create index recurring_expenses_due_idx on public.recurring_expenses (next_run_on) where active;

create trigger recurring_expenses_set_updated_at
before update on public.recurring_expenses
for each row execute function private.set_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  event_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  paid_by uuid not null references public.profiles (id) on delete restrict,
  split_type public.split_type not null default 'equal',
  category text check (char_length(category) <= 40),
  notes text check (char_length(notes) <= 2000),
  spent_at date not null default current_date,
  receipt_path text,
  recurring_id uuid references public.recurring_expenses (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index expenses_group_id_spent_at_idx on public.expenses (group_id, spent_at desc);
create index expenses_event_id_idx on public.expenses (event_id);
create index expenses_paid_by_idx on public.expenses (paid_by);
create index expenses_recurring_id_idx on public.expenses (recurring_id);
create index expenses_created_by_idx on public.expenses (created_by);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function private.set_updated_at();

create table public.expense_splits (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  share_cents bigint not null check (share_cents >= 0),
  weight numeric check (weight is null or weight >= 0),
  primary key (expense_id, user_id)
);

comment on column public.expense_splits.weight is 'Percent or share count, for display only.';

create index expense_splits_user_id_idx on public.expense_splits (user_id);

-- Splits must add up to the expense amount. Deferred so an expense and its
-- splits can be written in any order inside one transaction.
create or replace function private.check_expense_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  select coalesce(sum(s.share_cents), 0) into total
  from public.expense_splits s
  where s.expense_id = eid;

  if total <> amount then
    raise exception using
      message = 'splits_sum_mismatch',
      detail = format('Splits add up to %s but the expense is %s', total, amount),
      errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger expense_splits_sum_check
after insert or update or delete on public.expense_splits
deferrable initially deferred
for each row execute function private.check_expense_splits();

create constraint trigger expenses_splits_sum_check
after insert or update of amount_cents on public.expenses
deferrable initially deferred
for each row execute function private.check_expense_splits();

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete restrict,
  to_user uuid not null references public.profiles (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  note text check (char_length(note) <= 500),
  settled_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (from_user <> to_user)
);

create index settlements_group_id_idx on public.settlements (group_id, settled_at desc);
create index settlements_from_user_idx on public.settlements (from_user);
create index settlements_to_user_idx on public.settlements (to_user);
create index settlements_created_by_idx on public.settlements (created_by);

create table public.fx_rates (
  base char(3) not null check (base ~ '^[A-Z]{3}$'),
  quote char(3) not null check (quote ~ '^[A-Z]{3}$'),
  day date not null,
  rate numeric(18, 8) not null check (rate > 0),
  primary key (base, quote, day)
);

comment on table public.fx_rates is 'Daily FX rates (1 base = rate quote). Filled by the fx-sync edge function.';

-- Digits after the decimal point (ISO 4217). Amounts are always stored in the
-- currency's minor unit (cents, yen, fils). Same table as packages/core.
create or replace function private.minor_units(currency text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case upper(currency)
    when 'BIF' then 0 when 'CLP' then 0 when 'DJF' then 0 when 'GNF' then 0
    when 'ISK' then 0 when 'JPY' then 0 when 'KMF' then 0 when 'KRW' then 0
    when 'PYG' then 0 when 'RWF' then 0 when 'UGX' then 0 when 'UYI' then 0
    when 'VND' then 0 when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
    when 'XPF' then 0
    when 'BHD' then 3 when 'IQD' then 3 when 'JOD' then 3 when 'KWD' then 3
    when 'LYD' then 3 when 'OMR' then 3 when 'TND' then 3
    else 2
  end;
$$;

-- Converts minor units of one currency into minor units of another at `rate`
-- (units of `to` per unit of `from`), rounding half away from zero.
create or replace function private.convert_minor(amount bigint, rate numeric, from_currency text, to_currency text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round(
    amount::numeric * rate::numeric(18, 8)
    * power(10::numeric, private.minor_units(to_currency) - private.minor_units(from_currency))
  )::bigint;
$$;

grant execute on function private.minor_units(text), private.convert_minor(bigint, numeric, text, text)
  to authenticated, service_role;

-- Latest known rate on or before `on_day`, trying the inverse pair as a fallback.
create or replace function private.fx_rate(from_currency char(3), to_currency char(3), on_day date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result numeric;
begin
  if from_currency = to_currency then
    return 1;
  end if;

  select r.rate into result
  from public.fx_rates r
  where r.base = from_currency and r.quote = to_currency and r.day <= on_day
  order by r.day desc
  limit 1;

  if result is null then
    select round(1 / r.rate, 8) into result
    from public.fx_rates r
    where r.base = to_currency and r.quote = from_currency and r.day <= on_day
    order by r.day desc
    limit 1;
  end if;

  return result;
end;
$$;

-- Changing the group currency would silently reinterpret every snapshotted rate.
create or replace function private.guard_group_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency and (
    exists (select 1 from public.expenses e where e.group_id = new.id)
    or exists (select 1 from public.settlements s where s.group_id = new.id)
  ) then
    raise exception using
      message = 'group_currency_locked',
      detail = 'The currency of a group with expenses cannot be changed',
      errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger groups_guard_currency
before update of currency on public.groups
for each row execute function private.guard_group_currency();

revoke all on table public.recurring_expenses, public.expenses, public.expense_splits,
  public.settlements, public.fx_rates from anon, authenticated;

grant select, delete on table public.recurring_expenses to authenticated;
grant update (description, category, active, next_run_on)
  on table public.recurring_expenses to authenticated;
grant select on table public.expenses, public.expense_splits, public.settlements, public.fx_rates
  to authenticated;

grant all on table public.recurring_expenses, public.expenses, public.expense_splits,
  public.settlements, public.fx_rates to service_role;
