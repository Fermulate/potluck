-- RPCs: settling up and debt simplification.

-- Records a payment from `from_user` (default: caller) to `to_user`. Anyone can
-- record a payment they made or received; admins can record any payment.
create or replace function public.settle_up(
  group_id uuid,
  to_user uuid,
  amount_cents bigint,
  currency text default null,
  note text default null,
  from_user uuid default null,
  settled_at timestamptz default null
)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(settle_up.group_id);
  uid uuid := auth.uid();
  payer uuid := coalesce(settle_up.from_user, uid);
  g public.groups;
  cur text;
  fx numeric;
  result public.settlements;
begin
  select * into g from public.groups x where x.id = settle_up.group_id;

  if settle_up.amount_cents is null or settle_up.amount_cents <= 0 or settle_up.amount_cents > 100000000000 then
    raise exception using message = 'Enter an amount greater than zero', hint = 'invalid_amount', errcode = '22023';
  end if;
  if settle_up.to_user is null or settle_up.to_user = payer then
    raise exception using message = 'Pick who you paid', hint = 'invalid_recipient', errcode = '22023';
  end if;
  if my_role = 'member' and uid <> payer and uid <> settle_up.to_user then
    raise exception using message = 'You can only record payments you made or received', hint = 'not_allowed', errcode = '42501';
  end if;
  if (
    select count(*) from public.group_members m
    where m.group_id = settle_up.group_id and m.user_id in (payer, settle_up.to_user)
  ) <> 2 then
    raise exception using message = 'Both people must be in the group', hint = 'member_not_found', errcode = 'P0002';
  end if;

  cur := upper(coalesce(nullif(btrim(settle_up.currency), ''), g.currency));
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'Unknown currency code', hint = 'invalid_currency', errcode = '22023';
  end if;
  fx := private.fx_rate(cur::char(3), g.currency, coalesce(settle_up.settled_at, now())::date);
  if fx is null then
    raise exception using
      message = format('No exchange rate from %s to %s yet', cur, g.currency),
      hint = 'fx_rate_unavailable',
      errcode = '23514';
  end if;

  insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
  values (
    settle_up.group_id, payer, settle_up.to_user, settle_up.amount_cents, cur, fx,
    nullif(btrim(settle_up.note), ''), coalesce(settle_up.settled_at, now()), uid
  )
  returning * into result;

  return result;
end;
$$;

-- Soft delete; the payer, the recipient, whoever recorded it, or an admin.
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
    raise exception using message = 'Payment not found', hint = 'settlement_not_found', errcode = 'P0002';
  end if;
  my_role := private.require_member(s.group_id);
  if my_role = 'member' and uid not in (s.from_user, s.to_user) and uid is distinct from s.created_by then
    raise exception using message = 'You can only remove payments you were part of', hint = 'not_allowed', errcode = '42501';
  end if;

  update public.settlements x set deleted_at = coalesce(x.deleted_at, now())
  where x.id = s.id
  returning * into s;
  return s;
end;
$$;

-- Minimal-ish set of payments that clears every balance in the group.
-- Greedy: repeatedly match the largest creditor with the largest debtor.
-- Ties are broken by user id so the result is deterministic.
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

  select coalesce(array_agg(b.user_id order by b.user_id), '{}'), coalesce(array_agg(b.net_cents order by b.user_id), '{}')
  into creditors, credits
  from public.group_balances b
  where b.group_id = simplified_debts.group_id and b.net_cents > 0;

  select coalesce(array_agg(b.user_id order by b.user_id), '{}'), coalesce(array_agg(-b.net_cents order by b.user_id), '{}')
  into debtors, debts
  from public.group_balances b
  where b.group_id = simplified_debts.group_id and b.net_cents < 0;

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

revoke execute on function
  public.settle_up(uuid, uuid, bigint, text, text, uuid, timestamptz),
  public.delete_settlement(uuid),
  public.simplified_debts(uuid)
from public, anon;

grant execute on function
  public.settle_up(uuid, uuid, bigint, text, text, uuid, timestamptz),
  public.delete_settlement(uuid),
  public.simplified_debts(uuid)
to authenticated, service_role;
