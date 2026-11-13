-- Several attachments per expense (ADR 21).
--
-- expense_attachments: up to five receipts, photos or PDFs per expense. The files stay in the
-- private `receipts` bucket under `<group_id>/`, so the bucket's member policies and the two-step
-- restrictive policy (20261113100301) cover every one of them; nothing about storage changes.
-- Members of the group read the rows; only set_expense_attachments and the trigger below write.
--
-- expenses.receipt_path stays the first attachment, so older clients keep showing one receipt:
--   * set_expense_attachments writes it along with the list;
--   * an older client that sets or clears receipt_path through create_expense_v2 or
--     update_expense_v2 changes the list the same way: its old file leaves, its new file goes
--     first, the others stay.
-- Every existing receipt becomes the first attachment of its expense.

create table public.expense_attachments (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  position smallint not null check (position >= 0 and position < 5),
  group_id uuid not null references public.groups (id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  content_type text not null check (
    content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf')
  ),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (expense_id, position),
  unique (expense_id, path),
  constraint expense_attachments_in_group_folder check (path like group_id::text || '/%')
);

create index expense_attachments_group_idx on public.expense_attachments (group_id);
create index expense_attachments_uploaded_by_idx on public.expense_attachments (uploaded_by);

comment on table public.expense_attachments is
  'Receipts, photos and PDFs on an expense, in order (files in the receipts bucket). The first is also expenses.receipt_path.';

alter table public.expense_attachments enable row level security;
revoke all on public.expense_attachments from anon, authenticated;
grant select (expense_id, position, group_id, path, content_type, uploaded_by, created_at)
  on public.expense_attachments to authenticated;
grant all on public.expense_attachments to service_role;

create policy "expense_attachments: members read"
on public.expense_attachments for select
to authenticated
using (group_id = any (array(select private.my_group_ids())));

-- Helpers -------------------------------------------------------------------------------------

-- The type a stored receipt was uploaded as, else a guess from its extension.
create function private.receipt_content_type(file_path text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select o.metadata ->> 'mimetype' from storage.objects o
      where o.bucket_id = 'receipts' and o.name = file_path
        and o.metadata ->> 'mimetype' in
          ('image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf')
    ),
    case lower(substring(file_path from '\.([A-Za-z0-9]+)$'))
      when 'pdf' then 'application/pdf'
      when 'png' then 'image/png'
      when 'webp' then 'image/webp'
      when 'heic' then 'image/heic'
      when 'heif' then 'image/heic'
      else 'image/jpeg'
    end
  );
$$;

-- A new list entry for a file: its type, and who uploaded it (the storage owner, else `who`).
create function private.attachment_item(file_path text, who uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'path', file_path,
    'content_type', private.receipt_content_type(file_path),
    'uploaded_by', (
      select p.id from public.profiles p
      where p.id = coalesce(
        (select private.try_uuid(o.owner_id) from storage.objects o
         where o.bucket_id = 'receipts' and o.name = file_path),
        who
      )
    ),
    'created_at', now()
  );
$$;

-- An expense's attachments as a jsonb list, in order.
create function private.attachment_list(eid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'path', a.path, 'content_type', a.content_type,
        'uploaded_by', a.uploaded_by, 'created_at', a.created_at
      )
      order by a.position
    ),
    '[]'::jsonb
  )
  from public.expense_attachments a
  where a.expense_id = eid;
$$;

-- Replaces an expense's attachments with `list` (entries as attachment_item builds them).
create function private.write_attachments(eid uuid, gid uuid, list jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.expense_attachments a where a.expense_id = eid;
  insert into public.expense_attachments
    (expense_id, position, group_id, path, content_type, uploaded_by, created_at)
  select eid, (x.ord - 1)::smallint, gid, x.item ->> 'path', x.item ->> 'content_type',
         (x.item ->> 'uploaded_by')::uuid, coalesce((x.item ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(list, '[]'::jsonb)) with ordinality as x (item, ord);
end;
$$;

revoke execute on function private.receipt_content_type(text) from public;
revoke execute on function private.attachment_item(text, uuid) from public;
revoke execute on function private.attachment_list(uuid) from public;
revoke execute on function private.write_attachments(uuid, uuid, jsonb) from public;

-- Older clients ----------------------------------------------------------------------------------

-- Keeps the list in step with a receipt_path written by an older client. Writes that already
-- agree with the list (set_expense_attachments) pass through untouched.
create function private.sync_receipt_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  list jsonb;
  kept jsonb;
begin
  if tg_op = 'INSERT' then
    if new.receipt_path is not null then
      perform private.write_attachments(new.id, new.group_id,
        jsonb_build_array(private.attachment_item(new.receipt_path, new.created_by)));
    end if;
    return null;
  end if;

  if new.receipt_path is not distinct from old.receipt_path then
    return new;
  end if;
  list := private.attachment_list(new.id);
  if new.receipt_path is not distinct from (list -> 0 ->> 'path') then
    return new;
  end if;

  select coalesce(jsonb_agg(x.item order by x.ord), '[]'::jsonb) into kept
  from jsonb_array_elements(list) with ordinality as x (item, ord)
  where (x.item ->> 'path') is distinct from old.receipt_path
    and (x.item ->> 'path') is distinct from new.receipt_path;
  if new.receipt_path is not null then
    kept := jsonb_build_array(private.attachment_item(new.receipt_path, auth.uid())) || kept;
  end if;
  select coalesce(jsonb_agg(x.item order by x.ord), '[]'::jsonb) into kept
  from jsonb_array_elements(kept) with ordinality as x (item, ord)
  where x.ord <= 5;

  perform private.write_attachments(new.id, new.group_id, kept);
  new.receipt_path := kept -> 0 ->> 'path';
  return new;
end;
$$;

create trigger expenses_receipt_attachment_insert
after insert on public.expenses
for each row execute function private.sync_receipt_attachment();

create trigger expenses_receipt_attachment_update
before update of receipt_path on public.expenses
for each row execute function private.sync_receipt_attachment();

-- Existing receipts --------------------------------------------------------------------------------

insert into public.expense_attachments
  (expense_id, position, group_id, path, content_type, uploaded_by, created_at)
select e.id, 0, e.group_id, e.receipt_path, private.receipt_content_type(e.receipt_path),
       (select p.id from public.profiles p where p.id = e.created_by), e.created_at
from public.expenses e
where e.receipt_path is not null
  and e.receipt_path like e.group_id::text || '/%';

-- The RPC ----------------------------------------------------------------------------------------

-- Sets an expense's attachments, in order: `attachments` is a list of storage paths (or
-- {path} objects) of files already uploaded under the group's folder. Up to five. Who may edit
-- the expense may change them (a member their own expenses, admins any); they are details, so
-- an expense that names someone who left still takes them. Logs one `expense.updated` with an
-- `attachments` change (count before and after). Removing a file from the list does not delete
-- it from storage; the client does that with the bucket's own rules.
create or replace function public.set_expense_attachments(id uuid, attachments jsonb)
returns setof public.expense_attachments
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  eid uuid := set_expense_attachments.id;
  my_role public.group_role;
  gid uuid;
  prev public.expenses;
  old_list jsonb;
  new_list jsonb := '[]'::jsonb;
  entry jsonb;
  item jsonb;
  file_path text;
begin
  if attachments is null or jsonb_typeof(attachments) <> 'array' then
    raise exception using message = 'invalid_payload', detail = 'Attachments must be a list', errcode = '22023';
  end if;

  select e.group_id into gid from public.expenses e where e.id = eid;
  if gid is null then
    raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups g where g.id = gid for share;
  my_role := private.require_member(gid);
  perform private.require_group_open(gid);

  select * into prev from public.expenses e where e.id = eid for update;
  if my_role = 'member' and uid is distinct from prev.created_by and uid <> prev.paid_by
     and not exists (select 1 from public.expense_payers y where y.expense_id = eid and y.user_id = uid) then
    raise exception using message = 'not_allowed', detail = 'You can only edit your own expenses', errcode = '42501';
  end if;
  if prev.deleted_at is not null then
    raise exception using message = 'expense_deleted', detail = 'Restore this expense before editing it', errcode = '23514';
  end if;
  if jsonb_array_length(attachments) > 5 then
    raise exception using message = 'too_many_attachments', detail = 'An expense holds up to five attachments', errcode = '22023';
  end if;

  old_list := private.attachment_list(eid);
  for entry in select x.v from jsonb_array_elements(attachments) as x (v) loop
    file_path := case jsonb_typeof(entry)
      when 'string' then entry #>> '{}'
      when 'object' then entry ->> 'path'
    end;
    if file_path is null or file_path not like gid::text || '/%' or file_path like '%..%'
       or char_length(file_path) > 300
       or exists (select 1 from jsonb_array_elements(new_list) as n (v) where n.v ->> 'path' = file_path) then
      raise exception using message = 'invalid_receipt_path', detail = 'Receipts must be stored under the group folder', errcode = '22023';
    end if;
    -- A file already on the expense keeps who added it and when; a new one must be uploaded.
    select o.v into item from jsonb_array_elements(old_list) as o (v) where o.v ->> 'path' = file_path;
    if item is null then
      if not exists (
        select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = file_path
      ) then
        raise exception using message = 'attachment_not_found', detail = 'That file has not been uploaded', errcode = 'PT404';
      end if;
      item := private.attachment_item(file_path, uid);
    end if;
    new_list := new_list || jsonb_build_array(item);
  end loop;

  if (select coalesce(jsonb_agg(x.v ->> 'path'), '[]'::jsonb) from jsonb_array_elements(new_list) as x (v))
     is distinct from
     (select coalesce(jsonb_agg(x.v ->> 'path'), '[]'::jsonb) from jsonb_array_elements(old_list) as x (v)) then
    perform private.write_attachments(eid, gid, new_list);
    -- The first file is the receipt older clients show. The row is touched even when it stays
    -- the same, so realtime tells everyone looking at the expense. This function logs the edit.
    perform set_config('potluck.expense_logged', eid::text, true);
    update public.expenses e set receipt_path = new_list -> 0 ->> 'path' where e.id = eid;
    perform private.log_activity(gid, uid, 'expense.updated', eid, jsonb_build_object(
      'description', prev.description,
      'amount_cents', prev.amount_cents,
      'currency', prev.currency,
      'paid_by', prev.paid_by,
      'is_refund', prev.is_refund,
      'changes', jsonb_build_object('attachments', jsonb_build_object(
        'from', jsonb_array_length(old_list),
        'to', jsonb_array_length(new_list)
      ))
    ));
  end if;

  return query
  select a.* from public.expense_attachments a where a.expense_id = eid order by a.position;
end;
$$;

revoke execute on function public.set_expense_attachments(uuid, jsonb) from public, anon;
grant execute on function public.set_expense_attachments(uuid, jsonb) to authenticated, service_role;
