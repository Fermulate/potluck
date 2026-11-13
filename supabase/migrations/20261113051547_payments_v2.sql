-- Payments, second version: record a payment in either direction or (owners and admins) between
-- two other members, on any day; edit a payment; restore a deleted one.
--
-- settle_up (v1) stays for older clients (ADR 8): it only records "I paid X" today.
-- A payment dated in the past keeps that day's exchange rate and is stored at noon UTC of that
-- day, so it sorts on the day it was paid. Today's payments keep now() as before.
--
-- settlements_activity: body as in 20261105071528_activity_triggers.sql plus the
-- settlement.restored and settlement.updated verbs.

-- Helpers ----------------------------------------------------------------------------------------

-- Today in UTC, the day the rate tables use.
create or replace function private.utc_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'UTC')::date;
$$;

-- When a payment made on `paid_on` is stored. Today (or no date) is now(); another day is noon
-- UTC of that day so it lands on the same calendar day in every time zone from UTC-11 to UTC+11.
create or replace function private.payment_time(paid_on date) returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when paid_on is null or paid_on = private.utc_today() then now()
    else (paid_on + time '12:00') at time zone 'UTC'
  end;
$$;

-- The checks every payment write shares. Raises the first problem found.
create or replace function private.check_payment(
  gid uuid,
  my_role public.group_role,
  payer uuid,
  payee uuid,
  amount bigint
) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if amount is null or amount <= 0 or amount > 100000000000 then
    raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
  end if;
  if payer is null or payee is null or payer = payee then
    raise exception using message = 'invalid_parties', detail = 'A payment needs two different people', errcode = '22023';
  end if;
  if my_role = 'member' and uid is distinct from payer and uid is distinct from payee then
    raise exception using
      message = 'not_a_party',
      detail = 'Only owners and admins can record a payment between two other people',
      errcode = '42501';
  end if;
  if (
    select count(*) from public.group_members m
    where m.group_id = gid and m.user_id in (payer, payee)
  ) <> 2 then
    raise exception using message = 'member_not_in_group', detail = 'Both people must be in the group', errcode = '23514';
  end if;
end;
$$;

-- Normalized currency code (the group's when empty) or invalid_currency.
create or replace function private.payment_currency(requested text, group_currency text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  cur text := upper(coalesce(nullif(btrim(requested), ''), group_currency));
begin
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;
  return cur;
end;
$$;

-- The rate from `cur` into the group currency on `on_day`, or fx_rate_unavailable.
create or replace function private.payment_fx(cur text, group_currency text, on_day date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  fx numeric := private.fx_rate(cur::char(3), group_currency::char(3), on_day);
begin
  if fx is null then
    raise exception using
      message = 'fx_rate_unavailable',
      detail = format('No exchange rate from %s to %s yet', cur, group_currency),
      errcode = '23514';
  end if;
  return fx;
end;
$$;

-- A note is optional and short.
create or replace function private.payment_note(raw text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  note text := nullif(btrim(raw), '');
begin
  if char_length(note) > 500 then
    raise exception using message = 'note_too_long', detail = 'Keep the note under 500 characters', errcode = '22023';
  end if;
  return note;
end;
$$;

revoke execute on function private.check_payment(uuid, public.group_role, uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function private.payment_fx(text, text, date) from public, anon, authenticated;

-- settle_up_v2 ------------------------------------------------------------------------------------

create or replace function public.settle_up_v2(
  group_id uuid,
  from_user uuid,
  to_user uuid,
  amount_cents bigint,
  currency text default null,
  note text default null,
  settled_on date default null
) returns public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  my_role public.group_role;
  g public.groups;
  cur text;
  fx numeric;
  result public.settlements;
begin
  perform 1 from public.groups x where x.id = settle_up_v2.group_id for share;
  my_role := private.require_member(settle_up_v2.group_id);
  perform private.require_unarchived(settle_up_v2.group_id);
  select * into g from public.groups x where x.id = settle_up_v2.group_id;

  perform private.check_payment(g.id, my_role, settle_up_v2.from_user, settle_up_v2.to_user, settle_up_v2.amount_cents);
  cur := private.payment_currency(settle_up_v2.currency, g.currency);
  fx := private.payment_fx(cur, g.currency, coalesce(settle_up_v2.settled_on, private.utc_today()));

  insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
  values (
    g.id, settle_up_v2.from_user, settle_up_v2.to_user, settle_up_v2.amount_cents, cur, fx,
    private.payment_note(settle_up_v2.note), private.payment_time(settle_up_v2.settled_on), uid
  )
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.settle_up_v2(uuid, uuid, uuid, bigint, text, text, date) from public, anon;
grant execute on function public.settle_up_v2(uuid, uuid, uuid, bigint, text, text, date) to authenticated, service_role;

-- update_settlement ---------------------------------------------------------------------------------

-- Changes the keys present in `payload` (from_user, to_user, amount_cents, currency, note,
-- settled_on). Who may: the payer, the person paid, whoever recorded it, or an owner or admin.
-- A payment naming someone who left keeps its people, amount, currency and rate; the note and a
-- date that does not change the rate stay editable.
create or replace function public.update_settlement(id uuid, payload jsonb)
returns public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  p jsonb := coalesce(payload, '{}'::jsonb);
  my_role public.group_role;
  gid uuid;
  g public.groups;
  prev public.settlements;
  prev_day date;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_currency text;
  v_note text;
  v_on date;
  v_at timestamptz;
  v_fx numeric;
  result public.settlements;
begin
  select x.group_id into gid from public.settlements x where x.id = update_settlement.id;
  if gid is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups x where x.id = gid for share;
  my_role := private.require_member(gid);

  select * into prev from public.settlements x where x.id = update_settlement.id for update;
  if prev.id is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  if my_role = 'member' and uid not in (prev.from_user, prev.to_user) and uid is distinct from prev.created_by then
    raise exception using message = 'not_allowed', detail = 'You can only change payments you were part of', errcode = '42501';
  end if;
  perform private.require_unarchived(gid);
  if prev.deleted_at is not null then
    raise exception using message = 'settlement_deleted', detail = 'Restore this payment before editing it', errcode = '23514';
  end if;
  select * into g from public.groups x where x.id = gid;

  begin
    v_from := coalesce((p ->> 'from_user')::uuid, prev.from_user);
    v_to := coalesce((p ->> 'to_user')::uuid, prev.to_user);
    v_amount := coalesce((p ->> 'amount_cents')::bigint, prev.amount_cents);
    v_on := (p ->> 'settled_on')::date;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
      or numeric_value_out_of_range then
      raise exception using message = 'invalid_payload', detail = 'The payment is not valid', errcode = '22023';
  end;
  v_currency := private.payment_currency(coalesce(nullif(btrim(p ->> 'currency'), ''), prev.currency), g.currency);
  v_note := case when p ? 'note' then private.payment_note(p ->> 'note') else prev.note end;

  -- Keep the stored time unless the day really changes.
  prev_day := (prev.settled_at at time zone 'UTC')::date;
  if v_on is null or v_on = prev_day then
    v_on := prev_day;
    v_at := prev.settled_at;
  else
    v_at := private.payment_time(v_on);
  end if;

  if v_currency = prev.currency and v_on = prev_day then
    v_fx := prev.fx_rate;
  else
    v_fx := private.payment_fx(v_currency, g.currency, v_on);
  end if;

  if (v_from, v_to, v_amount, v_currency, v_fx)
     is distinct from (prev.from_user, prev.to_user, prev.amount_cents, prev.currency::text, prev.fx_rate) then
    -- Nothing may move the balance of someone who left, old pair or new.
    if (
      select count(*) from public.group_members m
      where m.group_id = gid and m.user_id in (prev.from_user, prev.to_user)
    ) <> 2 then
      raise exception using message = 'member_not_in_group', detail = 'Someone in this payment has left the group', errcode = '23514';
    end if;
    perform private.check_payment(gid, my_role, v_from, v_to, v_amount);
  end if;

  update public.settlements x set
    from_user = v_from,
    to_user = v_to,
    amount_cents = v_amount,
    currency = v_currency,
    fx_rate = v_fx,
    note = v_note,
    settled_at = v_at
  where x.id = prev.id
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.update_settlement(uuid, jsonb) from public, anon;
grant execute on function public.update_settlement(uuid, jsonb) to authenticated, service_role;

-- restore_settlement ------------------------------------------------------------------------------

-- Undoes delete_settlement. Same people may do it, and it is refused when someone in the payment
-- has left, because restoring would move their balance.
create or replace function public.restore_settlement(id uuid)
returns public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  my_role public.group_role;
  gid uuid;
  s public.settlements;
begin
  select x.group_id into gid from public.settlements x where x.id = restore_settlement.id;
  if gid is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups g where g.id = gid for share;
  my_role := private.require_member(gid);

  select * into s from public.settlements x where x.id = restore_settlement.id for update;
  if s.id is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  if my_role = 'member' and uid not in (s.from_user, s.to_user) and uid is distinct from s.created_by then
    raise exception using message = 'not_allowed', detail = 'You can only restore payments you were part of', errcode = '42501';
  end if;
  perform private.require_unarchived(gid);

  if s.deleted_at is not null and (
    select count(*) from public.group_members m
    where m.group_id = gid and m.user_id in (s.from_user, s.to_user)
  ) <> 2 then
    raise exception using message = 'member_not_in_group', detail = 'Someone in this payment has left the group', errcode = '23514';
  end if;

  update public.settlements x set deleted_at = null
  where x.id = s.id
  returning * into s;
  return s;
end;
$$;

revoke execute on function public.restore_settlement(uuid) from public, anon;
grant execute on function public.restore_settlement(uuid) to authenticated, service_role;

-- Activity ----------------------------------------------------------------------------------------

create or replace function private.settlements_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'settlement.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    verb := 'settlement.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    verb := 'settlement.restored';
  elsif new.deleted_at is null
    and (new.from_user, new.to_user, new.amount_cents, new.currency, new.fx_rate, new.note, new.settled_at)
        is distinct from
        (old.from_user, old.to_user, old.amount_cents, old.currency, old.fx_rate, old.note, old.settled_at) then
    verb := 'settlement.updated';
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object(
      'from_user', new.from_user,
      'to_user', new.to_user,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ));
  return null;
end;
$$;
