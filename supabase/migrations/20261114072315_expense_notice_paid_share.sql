-- A new expense's notification says what it means for each person ("You owe $12.00",
-- "You get back $30.00"), like Splitwise. Each recipient's row already carried their share of
-- the split; with several payers it also needs what they paid, so it now carries `paid_cents`
-- too (0 for someone who paid nothing). The app and the push text work out the line from
-- share, paid and `is_refund`, the same way balances do.
--
-- Body as in 20261113091955_expense_entry plus `paid_cents`, one row per recipient.
create or replace function private.expenses_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- created_by, not auth.uid(): this runs at commit, after the caller may have changed.
  actor uuid := coalesce(new.created_by, auth.uid());
begin
  if new.deleted_at is not null or not exists (select 1 from public.expenses e where e.id = new.id) then
    return null;
  end if;

  insert into public.notifications (user_id, type, data)
  select
    s.user_id,
    'expense.created',
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'paid_by', new.paid_by,
      'is_refund', new.is_refund,
      'share_cents', s.share_cents,
      'paid_cents', s.paid_cents,
      'actor_id', actor
    )
  from (
    select u.user_id, sum(u.share_cents)::bigint as share_cents, sum(u.paid_cents)::bigint as paid_cents
    from (
      select x.user_id, x.share_cents, 0::bigint as paid_cents
      from public.expense_splits x where x.expense_id = new.id
      union all
      select y.user_id, 0::bigint, y.paid_cents
      from public.expense_payers y where y.expense_id = new.id
    ) u
    group by u.user_id
  ) s
  join public.profiles p on p.id = s.user_id
  where p.deleted_at is null
    and s.user_id is distinct from actor;

  return null;
end;
$$;
