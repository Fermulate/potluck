-- Tell the two people in a payment when someone else edits, deletes or restores it:
-- settlement.updated, settlement.deleted, settlement.restored. The actor is not notified.
-- Kept apart from the payment RPCs so per-type notification preferences can build on it.

create or replace function private.settlements_notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  kind text;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    kind := 'settlement.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    kind := 'settlement.restored';
  elsif new.deleted_at is null
    and (new.from_user, new.to_user, new.amount_cents, new.currency, new.settled_at)
        is distinct from
        (old.from_user, old.to_user, old.amount_cents, old.currency, old.settled_at) then
    kind := 'settlement.updated';
  else
    return null;
  end if;

  perform private.notify(
    array[old.from_user, old.to_user, new.from_user, new.to_user],
    kind,
    jsonb_build_object(
      'settlement_id', new.id,
      'group_id', new.group_id,
      'from_user', new.from_user,
      'to_user', new.to_user,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;

create trigger settlements_notify_change
after update on public.settlements
for each row execute function private.settlements_notify_change();
