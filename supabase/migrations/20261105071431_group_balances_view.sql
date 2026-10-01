-- Net balance per member in the group currency. Positive = is owed money.
--
-- Each split is converted with its expense's fx_rate and rounded on its own; the
-- payer is credited with the sum of the converted splits, so every group's
-- balances always add up to exactly zero.
-- Members with no activity appear with 0. Former members with history still
-- appear so their debts are never hidden.

create view public.group_balances
with (security_invoker = true)
as
with ledger as (
  select m.group_id, m.user_id, 0::bigint as delta
  from public.group_members m

  union all

  select e.group_id, s.user_id, -round(s.share_cents * e.fx_rate)::bigint
  from public.expenses e
  join public.expense_splits s on s.expense_id = e.id
  where e.deleted_at is null

  union all

  select e.group_id, e.paid_by, sum(round(s.share_cents * e.fx_rate))::bigint
  from public.expenses e
  join public.expense_splits s on s.expense_id = e.id
  where e.deleted_at is null
  group by e.id, e.group_id, e.paid_by

  union all

  select st.group_id, st.from_user, round(st.amount_cents * st.fx_rate)::bigint
  from public.settlements st
  where st.deleted_at is null

  union all

  select st.group_id, st.to_user, -round(st.amount_cents * st.fx_rate)::bigint
  from public.settlements st
  where st.deleted_at is null
)
select l.group_id, l.user_id, sum(l.delta)::bigint as net_cents
from ledger l
group by l.group_id, l.user_id;

comment on view public.group_balances is 'Net balance per member in group currency (positive = is owed).';

revoke all on table public.group_balances from anon, authenticated;
grant select on table public.group_balances to authenticated;
grant select on table public.group_balances to service_role;
