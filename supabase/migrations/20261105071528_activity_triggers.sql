-- Activity feed, written by triggers so every client (and cron) produces the
-- same entries. Verbs:
--   group.created, group.updated
--   member.joined, member.left, member.removed, member.role_changed
--   expense.created, expense.updated, expense.deleted, expense.restored
--   settlement.created, settlement.deleted
--   event.created, event.scheduled, event.rescheduled, event.cancelled
--   comment.created

create or replace function private.log_activity(
  gid uuid,
  actor uuid,
  verb text,
  subject uuid,
  data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rows removed by a cascading group delete have nothing to log against.
  if not exists (select 1 from public.groups g where g.id = gid) then
    return;
  end if;
  insert into public.activity (group_id, actor_id, verb, subject_id, data)
  values (gid, actor, verb, subject, coalesce(data, '{}'::jsonb));
end;
$$;

create or replace function private.groups_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.id, coalesce(auth.uid(), new.created_by), 'group.created', new.id,
      jsonb_build_object('name', new.name));
  elsif (new.name, new.emoji, new.color, new.cover_path, new.currency, new.simplify_debts,
         new.members_can_invite, new.archived_at)
        is distinct from
        (old.name, old.emoji, old.color, old.cover_path, old.currency, old.simplify_debts,
         old.members_can_invite, old.archived_at) then
    perform private.log_activity(new.id, auth.uid(), 'group.updated', new.id,
      jsonb_build_object('name', new.name, 'archived', new.archived_at is not null));
  end if;
  return null;
end;
$$;

create trigger groups_activity
after insert or update on public.groups
for each row execute function private.groups_activity();

create or replace function private.group_members_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.group_id, new.user_id, 'member.joined', new.user_id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.log_activity(new.group_id, auth.uid(), 'member.role_changed', new.user_id,
        jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
    end if;
  else
    perform private.log_activity(
      old.group_id,
      coalesce(auth.uid(), old.user_id),
      case when auth.uid() is null or auth.uid() = old.user_id then 'member.left' else 'member.removed' end,
      old.user_id,
      jsonb_build_object('user_id', old.user_id)
    );
  end if;
  return null;
end;
$$;

create trigger group_members_activity
after insert or update or delete on public.group_members
for each row execute function private.group_members_activity();

create or replace function private.expenses_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'expense.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    verb := 'expense.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    verb := 'expense.restored';
  elsif (new.description, new.amount_cents, new.currency, new.fx_rate, new.paid_by, new.split_type,
         new.category, new.notes, new.spent_at, new.receipt_path, new.event_id)
        is distinct from
        (old.description, old.amount_cents, old.currency, old.fx_rate, old.paid_by, old.split_type,
         old.category, old.notes, old.spent_at, old.receipt_path, old.event_id) then
    verb := 'expense.updated';
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object(
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'paid_by', new.paid_by
    ));
  return null;
end;
$$;

create trigger expenses_activity
after insert or update on public.expenses
for each row execute function private.expenses_activity();

create or replace function private.settlements_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'settlement.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    verb := 'settlement.deleted';
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object(
      'from_user', new.from_user,
      'to_user', new.to_user,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ));
  return null;
end;
$$;

create trigger settlements_activity
after insert or update on public.settlements
for each row execute function private.settlements_activity();

create or replace function private.events_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'event.created';
  elsif new.status = 'scheduled' and old.status <> 'scheduled' then
    verb := 'event.scheduled';
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    verb := 'event.rescheduled';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    verb := 'event.cancelled';
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object('title', new.title, 'emoji', new.emoji, 'starts_at', new.starts_at));
  return null;
end;
$$;

create trigger events_activity
after insert or update on public.events
for each row execute function private.events_activity();

create or replace function private.comments_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(new.group_id, new.author_id, 'comment.created', new.id,
    jsonb_build_object(
      'expense_id', new.expense_id,
      'event_id', new.event_id,
      'excerpt', left(new.body, 140)
    ));
  return null;
end;
$$;

create trigger comments_activity
after insert on public.comments
for each row execute function private.comments_activity();
