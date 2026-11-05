-- RLS: money. All writes to expenses, splits and settlements go through RPCs
-- (they span several rows and need validation), so clients only get reads.

alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.settlements enable row level security;
alter table public.fx_rates enable row level security;

-- Soft-deleted rows stay visible so the app can offer "restore".
create policy "expenses: members read"
on public.expenses for select
to authenticated
using (group_id in (select private.my_group_ids()));

create policy "expense_splits: members read"
on public.expense_splits for select
to authenticated
using (
  exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and e.group_id in (select private.my_group_ids())
  )
);

create policy "recurring_expenses: members read"
on public.recurring_expenses for select
to authenticated
using (group_id in (select private.my_group_ids()));

create policy "recurring_expenses: creator or admin edit"
on public.recurring_expenses for update
to authenticated
using (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
)
with check (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
);

create policy "recurring_expenses: creator or admin delete"
on public.recurring_expenses for delete
to authenticated
using (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
);

create policy "settlements: members read"
on public.settlements for select
to authenticated
using (group_id in (select private.my_group_ids()));

create policy "fx_rates: signed in users read"
on public.fx_rates for select
to authenticated
using (true);
