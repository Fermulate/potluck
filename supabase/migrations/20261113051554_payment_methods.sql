-- Payment methods: the handles a person can be paid at (PayPal.me, Venmo, Cash App, ...). The
-- settle up screen turns the recipient's handles into pay links with the amount filled in.
-- Potluck never moves money and never learns whether a payment went through (ADR 11).
--
-- Visible to the owner and to people who share a group with them (and have not blocked each
-- other). Handle formats are checked here and in packages/core (paymentMethods) with the same
-- cases.
--
-- forget_closed_account: body as in 20261105170000_account_closure_cleanup.sql plus payment
-- methods.

-- One rule per kind. Handles are stored normalized: no leading @ or $, no URL, no spaces around.
create or replace function private.valid_payment_handle(kind text, handle text) returns boolean
language sql immutable set search_path = '' as $$
  select handle is not null
    and handle = btrim(handle)
    and char_length(handle) between 1 and 256
    and case kind
      when 'paypal' then handle ~ '^[A-Za-z0-9]{1,20}$'
      when 'venmo' then handle ~ '^[A-Za-z0-9_-]{5,30}$'
      when 'cashapp' then handle ~ '^[A-Za-z][A-Za-z0-9_]{0,19}$'
      when 'revolut' then handle ~ '^[A-Za-z0-9]{3,32}$'
      when 'monzo' then handle ~ '^[A-Za-z0-9]{3,32}$'
      when 'upi' then handle ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,50}$'
      when 'interac' then handle ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or handle ~ '^\+?[0-9]{10,15}$'
      when 'bank' then char_length(handle) <= 200
      else false
    end;
$$;

-- The check constraint and trigger run as the writing user, so clients need to call it.
grant execute on function private.valid_payment_handle(text, text) to authenticated, service_role;

create table public.payment_methods (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null,
  handle text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind),
  constraint payment_methods_kind_check
    check (kind in ('paypal', 'venmo', 'cashapp', 'revolut', 'monzo', 'upi', 'interac', 'bank')),
  constraint payment_methods_handle_check check (private.valid_payment_handle(kind, handle))
);

comment on table public.payment_methods is
  'Where a person can be paid. Read by the owner and people who share a group with them.';

-- A readable error instead of the check constraint's, and a fresh updated_at.
create or replace function private.payment_methods_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.valid_payment_handle(new.kind, new.handle) then
    raise exception using
      message = 'invalid_payment_handle',
      detail = 'That does not look like a handle for this app',
      errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_methods_check
before insert or update on public.payment_methods
for each row execute function private.payment_methods_check();

-- Who may read someone's handles.
create or replace function private.can_see_payment_methods(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner = (select auth.uid())
    or (private.shares_group_with(owner) and not private.has_block(owner, (select auth.uid())));
$$;

revoke execute on function private.can_see_payment_methods(uuid) from public, anon;
grant execute on function private.can_see_payment_methods(uuid) to authenticated, service_role;

alter table public.payment_methods enable row level security;

create policy "payment_methods: owner and group mates read" on public.payment_methods
for select to authenticated
using (user_id = (select auth.uid()) or private.can_see_payment_methods(user_id));

create policy "payment_methods: add own" on public.payment_methods
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "payment_methods: change own" on public.payment_methods
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "payment_methods: remove own" on public.payment_methods
for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on public.payment_methods from anon, authenticated;
grant select (user_id, kind, handle, updated_at) on public.payment_methods to authenticated;
grant insert (kind, handle), update (kind, handle) on public.payment_methods to authenticated;
grant delete on public.payment_methods to authenticated;
grant all on public.payment_methods to service_role;

-- A closed account stops sharing where it can be paid.
create or replace function private.forget_closed_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_feed_tokens t where t.user_id = new.id;
  delete from public.payment_methods pm where pm.user_id = new.id;
  return null;
end;
$$;
