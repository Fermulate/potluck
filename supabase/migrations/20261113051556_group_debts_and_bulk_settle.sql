-- Debts per group on the server, and settling several debts in one step (ADR 11).
--
-- private.pairwise_debts mirrors pairwiseDebts in packages/core (same cases in
-- supabase/tests/17_payments.test.sql and pairwise-debts.test.ts): every split person owes the
-- payer their converted share (largest remainder, ties to the smaller id, as group_balances),
-- payments pay those debts down, and each pair nets to one transfer.
-- private.group_debts picks the rule the group uses: simplified_debts when simplify_debts is on,
-- pairwise otherwise. The balances tab shows the same set.
--
-- friend_balances: what the viewer and each person they share a group with owe each other, per
-- group. settle_with_friend: records one payment per shared open group, in the group currency,
-- so every debt between the two goes to zero. Locks the groups in id order first.
-- settle_all: records every debt involving the caller in one group.

create or replace function private.pairwise_debts(gid uuid)
returns table (from_user uuid, to_user uuid, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  with expense_totals as (
    select e.id, e.paid_by,
      private.convert_minor(e.amount_cents, e.fx_rate, e.currency::text, g.currency::text) as total
    from public.expenses e
    join public.groups g on g.id = e.group_id
    where e.group_id = gid and e.deleted_at is null
  ), split_parts as (
    select t.id, t.paid_by, t.total, s.user_id,
      div(t.total::numeric * s.share_cents::numeric, nullif(sum(s.share_cents) over w, 0)) as base,
      mod(t.total::numeric * s.share_cents::numeric, nullif(sum(s.share_cents) over w, 0)) as rem
    from expense_totals t
    join public.expense_splits s on s.expense_id = t.id
    window w as (partition by t.id)
  ), split_shares as (
    select p.paid_by, p.user_id,
      p.base + case
        when row_number() over (partition by p.id order by p.rem desc, p.user_id)
             <= p.total::numeric - sum(p.base) over (partition by p.id) then 1
        else 0
      end as share
    from split_parts p
  ), edges as (
    -- debtor, creditor, amount in group currency
    select s.user_id as debtor, s.paid_by as creditor, s.share as cents
    from split_shares s
    where s.user_id <> s.paid_by
    union all
    -- Paying someone reduces what you owe them.
    select st.to_user, st.from_user,
      private.convert_minor(st.amount_cents, st.fx_rate, st.currency::text, g.currency::text)::numeric
    from public.settlements st
    join public.groups g on g.id = st.group_id
    where st.group_id = gid and st.deleted_at is null
  ), pairs as (
    select least(e.debtor, e.creditor) as lo, greatest(e.debtor, e.creditor) as hi,
      sum(case when e.debtor < e.creditor then e.cents else -e.cents end) as net
    from edges e
    group by 1, 2
  )
  select
    case when p.net > 0 then p.lo else p.hi end,
    case when p.net > 0 then p.hi else p.lo end,
    abs(p.net)::bigint
  from pairs p
  where p.net <> 0
  order by abs(p.net) desc, 1, 2;
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

create or replace function public.settle_with_friend(
  friend_id uuid,
  settled_on date default null,
  note text default null
) returns setof public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  v_note text := private.payment_note(settle_with_friend.note);
  v_at timestamptz := private.payment_time(settle_with_friend.settled_on);
  gids uuid[];
  gid uuid;
  cur text;
  d record;
  paid public.settlements;
begin
  if settle_with_friend.friend_id is null or settle_with_friend.friend_id = uid then
    raise exception using message = 'invalid_parties', detail = 'A payment needs two different people', errcode = '22023';
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
      insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
      values (gid, d.from_user, d.to_user, d.amount_cents, cur, 1, v_note, v_at, uid)
      returning * into paid;
      return next paid;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.settle_with_friend(uuid, date, text) from public, anon;
grant execute on function public.settle_with_friend(uuid, date, text) to authenticated, service_role;

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
