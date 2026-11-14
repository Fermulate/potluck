-- Request keys: a save whose reply was lost can be tried again without saving twice.
--
-- The expense form and the payment form make one random id per draft and send it with the save
-- (`request_id` in the create_expense_v2 / create_expense_with_attachments payload, and the new
-- settle_up_v3 argument). The first call that carries a key stores it next to the row it made;
-- a later call with the same key from the same person gets that row back instead of a second
-- one. Calls without a key behave as before, so older clients keep working (ADR 8).
--
-- Redefined (bodies copied from schema/current.sql, as noted above each):
--   public.create_expense_v2, public.create_expense_with_attachments.
-- New: private.request_keys, private.claim_request, private.finish_request, public.settle_up_v3.

create table private.request_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('expense', 'payment')),
  request_id uuid not null,
  expense_id uuid references public.expenses (id) on delete cascade,
  settlement_id uuid references public.settlements (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One row per key per person: the unique constraint is what turns a retry into a lookup.
  primary key (user_id, kind, request_id)
);
create index request_keys_expense_id_idx on private.request_keys (expense_id);
create index request_keys_settlement_id_idx on private.request_keys (settlement_id);
alter table private.request_keys enable row level security;
revoke all on table private.request_keys from public, anon, authenticated;
grant all on table private.request_keys to service_role;

comment on table private.request_keys is
  'Client request ids of saved expenses and payments, so a retried save returns the first row (ADR 8 note on request keys).';

-- Claims `rid` for the caller. Returns null when this call is the first with the key (or has no
-- key), and the id of the row already saved under it otherwise. A second call with the same key
-- while the first is still running waits on the unique key, then sees what the first saved.
create or replace function private.claim_request(kind text, rid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  saved uuid;
begin
  if rid is null then
    return null;
  end if;
  uid := private.require_user();
  insert into private.request_keys (user_id, kind, request_id)
  values (uid, claim_request.kind, rid)
  on conflict do nothing;
  if found then
    return null;
  end if;
  select coalesce(r.expense_id, r.settlement_id) into saved
  from private.request_keys r
  where r.user_id = uid and r.kind = claim_request.kind and r.request_id = rid;
  return saved;
end;
$$;
revoke execute on function private.claim_request(text, uuid) from public, anon, authenticated;

-- Records the row a claimed key made.
create or replace function private.finish_request(kind text, rid uuid, row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if rid is null then
    return;
  end if;
  update private.request_keys r
  set expense_id = case when finish_request.kind = 'expense' then row_id end,
      settlement_id = case when finish_request.kind = 'payment' then row_id end
  where r.user_id = (select auth.uid()) and r.kind = finish_request.kind and r.request_id = rid;
end;
$$;
revoke execute on function private.finish_request(text, uuid, uuid) from public, anon, authenticated;

-- Body as in 20261113091955_expense_entry.sql (live copy in schema/current.sql) plus: a
-- `request_id` in the payload already used by the caller returns the expense it made.
create or replace function public.create_expense_v2(payload jsonb)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := private.try_uuid(payload ->> 'request_id');
  saved uuid := private.claim_request('expense', rid);
  created public.expenses;
begin
  if saved is not null then
    select * into created from public.expenses e
    where e.id = saved and e.group_id = any (array(select private.my_group_ids()));
    if found then
      return created;
    end if;
  end if;
  select * into created from private.save_expense(null, payload);
  perform private.finish_request('expense', rid, created.id);
  return created;
end;
$$;

-- Body as in 20261114015104_expense_attachments.sql (live copy in schema/current.sql) plus: a
-- `request_id` in the payload already used by the caller returns the expense it made, files and all.
create or replace function public.create_expense_with_attachments(payload jsonb, attachments jsonb)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := private.try_uuid(payload ->> 'request_id');
  saved uuid := private.claim_request('expense', rid);
  created public.expenses;
begin
  if saved is not null then
    select * into created from public.expenses e
    where e.id = saved and e.group_id = any (array(select private.my_group_ids()));
    if found then
      return created;
    end if;
  end if;
  select * into created from private.save_expense(null, payload);
  perform private.apply_attachments(created.id, attachments, false);
  select * into created from public.expenses e where e.id = created.id;
  perform private.finish_request('expense', rid, created.id);
  return created;
end;
$$;

-- settle_up_v2 with a request key. Same arguments, checks and errors (it calls settle_up_v2), so
-- the group row lock and every rule stay in one place.
create or replace function public.settle_up_v3(
  group_id uuid,
  from_user uuid,
  to_user uuid,
  amount_cents bigint,
  currency text default null,
  note text default null,
  settled_on date default null,
  request_id uuid default null
)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid := private.claim_request('payment', settle_up_v3.request_id);
  result public.settlements;
begin
  if saved is not null then
    select * into result from public.settlements s
    where s.id = saved and s.group_id = any (array(select private.my_group_ids()));
    if found then
      return result;
    end if;
  end if;
  select * into result from public.settle_up_v2(
    settle_up_v3.group_id, settle_up_v3.from_user, settle_up_v3.to_user, settle_up_v3.amount_cents,
    settle_up_v3.currency, settle_up_v3.note, settle_up_v3.settled_on
  );
  perform private.finish_request('payment', settle_up_v3.request_id, result.id);
  return result;
end;
$$;
revoke execute on function public.settle_up_v3(uuid, uuid, uuid, bigint, text, text, date, uuid) from public, anon;
grant execute on function public.settle_up_v3(uuid, uuid, uuid, bigint, text, text, date, uuid) to authenticated, service_role;
