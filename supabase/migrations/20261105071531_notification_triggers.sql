-- In-app notifications. The `notify` edge function fans new rows out to push.
-- Types:
--   expense.created, settlement.created, comment.created, member.joined,
--   event.scheduled, event.rescheduled, event.cancelled,
--   availability.requested (from request_availability),
--   event.reminder, rsvp.reminder (from the hourly cron job)
-- The actor never gets notified about their own action, closed accounts never do.

create or replace function private.notify(recipients uuid[], kind text, payload jsonb, actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, data)
  select p.id, kind, coalesce(payload, '{}'::jsonb) || jsonb_build_object('actor_id', actor)
  from public.profiles p
  where p.id = any (recipients)
    and p.deleted_at is null
    and p.id is distinct from actor;
end;
$$;

-- Deferred so the splits written in the same transaction are visible.
create or replace function private.expenses_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      'share_cents', s.share_cents,
      'actor_id', actor
    )
  from (
    select x.user_id, x.share_cents from public.expense_splits x where x.expense_id = new.id
    union all
    select new.paid_by, 0
    where not exists (select 1 from public.expense_splits x where x.expense_id = new.id and x.user_id = new.paid_by)
  ) s
  join public.profiles p on p.id = s.user_id
  where p.deleted_at is null
    and s.user_id is distinct from actor;

  return null;
end;
$$;

create constraint trigger expenses_notify
after insert on public.expenses
deferrable initially deferred
for each row execute function private.expenses_notify();

create or replace function private.settlements_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify(
    array[new.from_user, new.to_user],
    'settlement.created',
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

create trigger settlements_notify
after insert on public.settlements
for each row execute function private.settlements_notify();

create or replace function private.comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if new.expense_id is not null then
    select array_agg(distinct u) into recipients
    from (
      select s.user_id as u from public.expense_splits s where s.expense_id = new.expense_id
      union
      select e.paid_by from public.expenses e where e.id = new.expense_id
      union
      select e.created_by from public.expenses e where e.id = new.expense_id
    ) x;
  else
    select array_agg(distinct u) into recipients
    from (
      select r.user_id as u from public.event_rsvps r
      where r.event_id = new.event_id and r.status in ('going', 'maybe')
      union
      select e.created_by from public.events e where e.id = new.event_id
    ) x;
  end if;

  perform private.notify(
    recipients,
    'comment.created',
    jsonb_build_object(
      'comment_id', new.id,
      'group_id', new.group_id,
      'expense_id', new.expense_id,
      'event_id', new.event_id,
      'excerpt', left(new.body, 140)
    ),
    new.author_id
  );
  return null;
end;
$$;

create trigger comments_notify
after insert on public.comments
for each row execute function private.comments_notify();

-- Owners and admins hear about new members (not for hidden 1:1 groups).
create or replace function private.group_members_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if exists (select 1 from public.groups g where g.id = new.group_id and g.is_direct) then
    return null;
  end if;

  select array_agg(m.user_id) into recipients
  from public.group_members m
  where m.group_id = new.group_id and m.role in ('owner', 'admin') and m.user_id <> new.user_id;

  perform private.notify(
    recipients,
    'member.joined',
    jsonb_build_object('group_id', new.group_id, 'user_id', new.user_id),
    new.user_id
  );
  return null;
end;
$$;

create trigger group_members_notify
after insert on public.group_members
for each row execute function private.group_members_notify();

create or replace function private.events_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
  recipients uuid[];
begin
  if new.status = 'scheduled' and old.status <> 'scheduled' then
    kind := 'event.scheduled';
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    kind := 'event.rescheduled';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    kind := 'event.cancelled';
  else
    return null;
  end if;

  select array_agg(m.user_id) into recipients
  from public.group_members m
  where m.group_id = new.group_id;

  perform private.notify(
    recipients,
    kind,
    jsonb_build_object(
      'event_id', new.id,
      'group_id', new.group_id,
      'event_title', new.title,
      'starts_at', new.starts_at
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;

create trigger events_notify
after update on public.events
for each row execute function private.events_notify();
