-- Net balance per member in the group currency. Positive = is owed money.
--
-- Same math as computeBalances in packages/core:
--   * each expense is converted once: total = round(amount * fx_rate), with
--     minor unit differences applied (private.convert_minor);
--   * the payer is credited `total`;
--   * `total` is divided across the splits in proportion to share_cents by
--     largest remainder (ties by user id), so every expense nets to exactly
--     zero in group currency;
--   * settlements: from_user goes up, to_user goes down, by the converted amount;
--   * soft-deleted rows are ignored.
-- Every CTE is inlined and every window is partitioned by group_id, so a
-- group_id filter on the view reaches the base tables even when RLS does not
-- apply (security definer callers).
-- Members with no activity appear with 0. Former members with history still
-- appear so their debts are never hidden.

create view public.group_balances
with (security_invoker = true)
as
with expense_totals as not materialized (
  select
    e.id,
    e.group_id,
    e.paid_by,
    private.convert_minor(e.amount_cents, e.fx_rate, e.currency, g.currency) as total
  from public.expenses e
  join public.groups g on g.id = e.group_id
  where e.deleted_at is null
),
split_parts as (
  select
    t.id,
    t.group_id,
    t.total,
    s.user_id,
    div(t.total::numeric * s.share_cents, sum(s.share_cents) over w) as base,
    mod(t.total::numeric * s.share_cents, sum(s.share_cents) over w) as rem
  from expense_totals t
  join public.expense_splits s on s.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
split_shares as (
  select
    p.group_id,
    p.user_id,
    p.base + case
      when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
           <= p.total - sum(p.base) over (partition by p.group_id, p.id)
      then 1 else 0
    end as share
  from split_parts p
),
ledger as (
  select m.group_id, m.user_id, 0::numeric as delta
  from public.group_members m

  union all

  select t.group_id, t.paid_by, t.total::numeric
  from expense_totals t

  union all

  select s.group_id, s.user_id, -s.share
  from split_shares s

  union all

  select st.group_id, st.from_user,
         private.convert_minor(st.amount_cents, st.fx_rate, st.currency, g.currency)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null

  union all

  select st.group_id, st.to_user,
         -private.convert_minor(st.amount_cents, st.fx_rate, st.currency, g.currency)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null
)
select l.group_id, l.user_id, sum(l.delta)::bigint as net_cents
from ledger l
group by l.group_id, l.user_id;

comment on view public.group_balances is 'Net balance per member in group currency (positive = is owed).';

revoke all on table public.group_balances from anon, authenticated;
grant select on table public.group_balances to authenticated;
grant select on table public.group_balances to service_role;
