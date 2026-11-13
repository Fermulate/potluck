-- Debts per group on the server, and settling several debts in one step (ADR 15).
--
-- private.pairwise_debts mirrors pairwiseDebts in packages/core (same cases in
-- supabase/tests/20_payments.test.sql, pairwise-debts.test.ts and payers-refunds.test.ts):
-- each expense's effect per person is computed as group_balances does (payers credited, split
-- debited, refunds flipped, largest remainder with ties to the smaller id); inside an expense the
-- people behind pay the people ahead, debtors in id order, each spread over the creditors by what
-- they are still owed; payments pay those debts down, and each pair nets to one transfer.
-- private.group_debts picks the rule the group uses: simplified_debts when simplify_debts is on,
-- pairwise otherwise. The balances tab shows the same set.
--
-- friend_balances: what the viewer and each person they share a group with owe each other, per
-- group. settle_with_friend: records one payment per shared open group, in the group currency,
-- so every debt between the two goes to zero. Locks the groups in id order first.
-- settle_all: records every debt involving the caller in one group.

-- Adds `cents` to what `debtor` owes `creditor` in a map keyed "lo|hi" (positive: lo owes hi).
create or replace function private.add_pair_debt(owed jsonb, debtor uuid, creditor uuid, cents numeric)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
begin
  if debtor = creditor or cents = 0 then
    return owed;
  end if;
  if debtor < creditor then
    k := debtor::text || '|' || creditor::text;
    return jsonb_set(owed, array[k], to_jsonb(coalesce((owed ->> k)::numeric, 0) + cents));
  end if;
  k := creditor::text || '|' || debtor::text;
  return jsonb_set(owed, array[k], to_jsonb(coalesce((owed ->> k)::numeric, 0) - cents));
end;
$$;

create or replace function private.pairwise_debts(gid uuid)
returns table (from_user uuid, to_user uuid, amount_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  owed jsonb := '{}'::jsonb;
  e record;
  st record;
  cred_ids uuid[];
  cred_left numeric[];
  shares numeric[];
  rems numeric[];
  owes numeric;
  wsum numeric;
  leftover numeric;
  i int;
  j int;
begin
  -- Each expense's effect per person, exactly as group_balances: the converted total spread over
  -- the payers (credited) and over the split (debited), largest remainder, ties to the smaller id;
  -- a refund flips both. Expenses whose payers or split weigh nothing are skipped, as in core.
  for e in
    with expense_totals as (
      select x.id, case when x.is_refund then -1 else 1 end as sign,
        private.convert_minor(x.amount_cents, x.fx_rate, x.currency::text, g.currency::text) as total
      from public.expenses x
      join public.groups g on g.id = x.group_id
      where x.group_id = gid and x.deleted_at is null
        and (select sum(s.share_cents) from public.expense_splits s where s.expense_id = x.id) > 0
        and (select sum(y.paid_cents) from public.expense_payers y where y.expense_id = x.id) > 0
    ), split_parts as (
      select t.id, t.total, t.sign, s.user_id,
        div(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as base,
        mod(t.total::numeric * s.share_cents::numeric, sum(s.share_cents) over w) as rem
      from expense_totals t
      join public.expense_splits s on s.expense_id = t.id
      window w as (partition by t.id)
    ), split_shares as (
      select p.id, p.user_id, p.sign,
        p.base + case
          when row_number() over (partition by p.id order by p.rem desc, p.user_id)
               <= p.total::numeric - sum(p.base) over (partition by p.id) then 1
          else 0
        end as share
      from split_parts p
    ), payer_parts as (
      select t.id, t.total, t.sign, y.user_id,
        div(t.total::numeric * y.paid_cents::numeric, sum(y.paid_cents) over w) as base,
        mod(t.total::numeric * y.paid_cents::numeric, sum(y.paid_cents) over w) as rem
      from expense_totals t
      join public.expense_payers y on y.expense_id = t.id
      window w as (partition by t.id)
    ), payer_shares as (
      select p.id, p.user_id, p.sign,
        p.base + case
          when row_number() over (partition by p.id order by p.rem desc, p.user_id)
               <= p.total::numeric - sum(p.base) over (partition by p.id) then 1
          else 0
        end as share
      from payer_parts p
    ), effects as (
      select d.id, d.user_id, sum(d.delta) as eff
      from (
        select x.id, x.user_id, x.sign * x.share as delta from payer_shares x
        union all
        select s.id, s.user_id, -s.sign * s.share from split_shares s
      ) d
      group by d.id, d.user_id
    )
    select f.id, array_agg(f.user_id order by f.user_id) as users, array_agg(f.eff order by f.user_id) as effs
    from effects f
    group by f.id
  loop
    -- Inside one expense the people who came out behind pay the people who came out ahead:
    -- debtors in id order, each spread over the creditors by what they are still owed.
    cred_ids := '{}';
    cred_left := '{}';
    for i in 1 .. cardinality(e.users) loop
      if e.effs[i] > 0 then
        cred_ids := cred_ids || e.users[i];
        cred_left := cred_left || e.effs[i];
      end if;
    end loop;

    for i in 1 .. cardinality(e.users) loop
      continue when e.effs[i] >= 0;
      owes := -e.effs[i];
      wsum := 0;
      for j in 1 .. coalesce(cardinality(cred_ids), 0) loop
        wsum := wsum + greatest(cred_left[j], 0);
      end loop;
      continue when wsum = 0;

      shares := array_fill(0::numeric, array[cardinality(cred_ids)]);
      rems := array_fill(-1::numeric, array[cardinality(cred_ids)]);
      leftover := owes;
      for j in 1 .. cardinality(cred_ids) loop
        if cred_left[j] > 0 then
          shares[j] := div(owes * cred_left[j], wsum);
          rems[j] := mod(owes * cred_left[j], wsum);
          leftover := leftover - shares[j];
        end if;
      end loop;
      -- Largest remainder first; creditors are in id order, so ties go to the smaller id.
      for j in
        select r.k from unnest(rems) with ordinality as r(rem, k)
        where r.rem >= 0
        order by r.rem desc, r.k
      loop
        exit when leftover = 0;
        shares[j] := shares[j] + 1;
        leftover := leftover - 1;
      end loop;

      for j in 1 .. cardinality(cred_ids) loop
        if shares[j] > 0 then
          cred_left[j] := cred_left[j] - shares[j];
          owed := private.add_pair_debt(owed, e.users[i], cred_ids[j], shares[j]);
        end if;
      end loop;
    end loop;
  end loop;

  -- Paying someone reduces what you owe them.
  for st in
    select s.from_user, s.to_user,
      private.convert_minor(s.amount_cents, s.fx_rate, s.currency::text, g.currency::text)::numeric as cents
    from public.settlements s
    join public.groups g on g.id = s.group_id
    where s.group_id = gid and s.deleted_at is null
  loop
    owed := private.add_pair_debt(owed, st.to_user, st.from_user, st.cents);
  end loop;

  return query
    select
      case when p.net > 0 then p.lo else p.hi end,
      case when p.net > 0 then p.hi else p.lo end,
      abs(p.net)::bigint
    from (
      select split_part(o.key, '|', 1)::uuid as lo, split_part(o.key, '|', 2)::uuid as hi,
        o.value::numeric as net
      from jsonb_each_text(owed) o
    ) p
    where p.net <> 0
    order by abs(p.net) desc, 1, 2;
end;
$$;

create or replace function private.group_debts(gid uuid)
returns table (from_user uuid, to_user uuid, amount_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select g.simplify_debts from public.groups g where g.id = gid) then
    return query select d.from_user, d.to_user, d.amount_cents from public.simplified_debts(gid) d;
  else
    return query select d.from_user, d.to_user, d.amount_cents from private.pairwise_debts(gid) d;
  end if;
end;
$$;

revoke execute on function private.pairwise_debts(uuid) from public, anon, authenticated;
revoke execute on function private.group_debts(uuid) from public, anon, authenticated;

-- friend_balances -----------------------------------------------------------------------------------

-- One row per group and person the viewer has a debt with in it. net_cents > 0: they owe the
-- viewer. In the group currency; archived groups are flagged because they cannot be settled.
create or replace function public.friend_balances()
returns table (friend_id uuid, group_id uuid, currency text, net_cents bigint, archived boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  g record;
begin
  for g in
    select x.id, x.currency, x.archived_at
    from public.groups x
    join public.group_members m on m.group_id = x.id and m.user_id = uid
    order by x.id
  loop
    return query
      select
        case when d.from_user = uid then d.to_user else d.from_user end,
        g.id,
        g.currency::text,
        case when d.from_user = uid then -d.amount_cents else d.amount_cents end,
        g.archived_at is not null
      from private.group_debts(g.id) d
      where uid in (d.from_user, d.to_user);
  end loop;
end;
$$;

revoke execute on function public.friend_balances() from public, anon;
grant execute on function public.friend_balances() to authenticated, service_role;

-- settle_with_friend ----------------------------------------------------------------------------------

-- `amounts`: null settles everything between the two in every shared open group. Otherwise an
-- object of group id to amount (minor units, group currency): only those groups, each with that
-- amount, which must be more than zero and no more than what is owed there (partial payments).
create or replace function public.settle_with_friend(
  friend_id uuid,
  settled_on date default null,
  note text default null,
  amounts jsonb default null
) returns setof public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  v_note text := private.payment_note(settle_with_friend.note);
  v_at timestamptz := private.payment_time(settle_with_friend.settled_on);
  picked jsonb := settle_with_friend.amounts;
  gids uuid[];
  gid uuid;
  cur text;
  d record;
  amt bigint;
  matched int := 0;
  paid public.settlements;
begin
  if settle_with_friend.friend_id is null or settle_with_friend.friend_id = uid then
    raise exception using message = 'invalid_parties', detail = 'A payment needs two different people', errcode = '22023';
  end if;
  if picked is not null and (jsonb_typeof(picked) <> 'object' or picked = '{}'::jsonb) then
    raise exception using message = 'invalid_payload', detail = 'Pick at least one group', errcode = '22023';
  end if;

  select coalesce(array_agg(mine.group_id order by mine.group_id), '{}') into gids
  from public.group_members mine
  join public.group_members theirs
    on theirs.group_id = mine.group_id and theirs.user_id = settle_with_friend.friend_id
  where mine.user_id = uid;

  -- Lock order: every group row, in id order, before reading any balance.
  foreach gid in array gids loop
    perform 1 from public.groups g where g.id = gid for share;
  end loop;

  foreach gid in array gids loop
    continue when picked is not null and not (picked ? gid::text);
    select g.currency into cur from public.groups g where g.id = gid and g.archived_at is null;
    -- Archived groups are read only; a member may have left before the lock.
    continue when cur is null;
    continue when (
      select count(*) from public.group_members m
      where m.group_id = gid and m.user_id in (uid, settle_with_friend.friend_id)
    ) <> 2;

    for d in
      select x.from_user, x.to_user, x.amount_cents from private.group_debts(gid) x
      where (x.from_user = uid and x.to_user = settle_with_friend.friend_id)
         or (x.from_user = settle_with_friend.friend_id and x.to_user = uid)
    loop
      amt := d.amount_cents;
      if picked is not null then
        begin
          amt := (picked ->> gid::text)::bigint;
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            raise exception using message = 'invalid_payload', detail = 'The amounts are not valid', errcode = '22023';
        end;
        if amt is null or amt <= 0 or amt > d.amount_cents then
          raise exception using message = 'invalid_amount', detail = 'Pay more than zero and no more than is owed', errcode = '22023';
        end if;
        matched := matched + 1;
      end if;
      insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
      values (gid, d.from_user, d.to_user, amt, cur, 1, v_note, v_at, uid)
      returning * into paid;
      return next paid;
    end loop;
  end loop;

  -- A picked group that is not shared, is archived, or has nothing owed any more.
  if picked is not null and matched <> (select count(*) from jsonb_object_keys(picked)) then
    raise exception using message = 'nothing_owed', detail = 'Nothing is owed in one of those groups any more', errcode = '23514';
  end if;
end;
$$;

revoke execute on function public.settle_with_friend(uuid, date, text, jsonb) from public, anon;
grant execute on function public.settle_with_friend(uuid, date, text, jsonb) to authenticated, service_role;


-- settle_all ------------------------------------------------------------------------------------------

create or replace function public.settle_all(
  group_id uuid,
  settled_on date default null,
  note text default null
) returns setof public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  v_note text := private.payment_note(settle_all.note);
  v_at timestamptz := private.payment_time(settle_all.settled_on);
  cur text;
  d record;
  paid public.settlements;
begin
  perform 1 from public.groups g where g.id = settle_all.group_id for share;
  perform private.require_member(settle_all.group_id);
  perform private.require_unarchived(settle_all.group_id);
  select g.currency into cur from public.groups g where g.id = settle_all.group_id;

  for d in
    select x.from_user, x.to_user, x.amount_cents from private.group_debts(settle_all.group_id) x
    where uid in (x.from_user, x.to_user)
  loop
    -- Nothing may move the balance of someone who left.
    continue when (
      select count(*) from public.group_members m
      where m.group_id = settle_all.group_id and m.user_id in (d.from_user, d.to_user)
    ) <> 2;
    insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
    values (settle_all.group_id, d.from_user, d.to_user, d.amount_cents, cur, 1, v_note, v_at, uid)
    returning * into paid;
    return next paid;
  end loop;
end;
$$;

revoke execute on function public.settle_all(uuid, date, text) from public, anon;
grant execute on function public.settle_all(uuid, date, text) to authenticated, service_role;
