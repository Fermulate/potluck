-- Closing an account also kills its calendar feed. delete_my_account() sets
-- profiles.deleted_at; this trigger drops the feed token at that moment so an
-- old feed URL stops working even if the profile keeps open balances.

create or replace function private.forget_closed_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_feed_tokens t where t.user_id = new.id;
  return null;
end;
$$;

revoke execute on function private.forget_closed_account() from public, anon, authenticated;

create trigger profiles_forget_closed_account
after update of deleted_at on public.profiles
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function private.forget_closed_account();
