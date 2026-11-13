-- Comments on payments. A comment now belongs to exactly one of an expense, a plan or a payment.
--
-- comments_set_group: body as in 20261105071441_feed_and_platform.sql plus settlement_id.
-- comments_notify: body as in 20261105071531_notification_triggers.sql plus payments (the payer,
--   the person paid and whoever recorded it hear about it).
-- comments_activity: body as in 20261105071528_activity_triggers.sql plus settlement_id.
-- guard_open_group_write: body as in 20261106000000_review_fixes.sql plus the payment's group.

alter table public.comments
  add column settlement_id uuid references public.settlements (id) on delete cascade;

alter table public.comments drop constraint comments_check;
alter table public.comments
  add constraint comments_one_subject check (num_nonnulls(expense_id, event_id, settlement_id) = 1);

create index comments_settlement_id_idx on public.comments (settlement_id, created_at);

grant insert (settlement_id) on public.comments to authenticated;

create or replace function private.comments_set_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.expense_id is not null then
    select e.group_id into new.group_id from public.expenses e where e.id = new.expense_id;
  elsif new.settlement_id is not null then
    select s.group_id into new.group_id from public.settlements s where s.id = new.settlement_id;
  else
    select ev.group_id into new.group_id from public.events ev where ev.id = new.event_id;
  end if;
  return new;
end;
$$;

create or replace function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
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
  elsif new.settlement_id is not null then
    select array_agg(distinct u) into recipients
    from (
      select s.from_user as u from public.settlements s where s.id = new.settlement_id
      union
      select s.to_user from public.settlements s where s.id = new.settlement_id
      union
      select s.created_by from public.settlements s where s.id = new.settlement_id
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
      'settlement_id', new.settlement_id,
      'excerpt', left(new.body, 140)
    ),
    new.author_id
  );
  return null;
end;
$$;

create or replace function private.comments_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_activity(new.group_id, new.author_id, 'comment.created', new.id,
    jsonb_build_object(
      'expense_id', new.expense_id,
      'event_id', new.event_id,
      'settlement_id', new.settlement_id,
      'excerpt', left(new.body, 140)
    ));
  return null;
end;
$$;

create or replace function private.guard_open_group_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  gid uuid;
  deadline timestamptz;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'event_rsvps' then
    select e.group_id, e.rsvp_deadline into gid, deadline
    from public.events e where e.id = (row ->> 'event_id')::uuid;
  elsif tg_table_name = 'comments' then
    gid := coalesce(
      (select x.group_id from public.expenses x where x.id = (row ->> 'expense_id')::uuid),
      (select e.group_id from public.events e where e.id = (row ->> 'event_id')::uuid),
      (select s.group_id from public.settlements s where s.id = (row ->> 'settlement_id')::uuid),
      (row ->> 'group_id')::uuid
    );
  else
    gid := (row ->> 'group_id')::uuid;
  end if;

  perform private.require_group_open(gid);

  if deadline is not null and deadline <= now() then
    raise exception using message = 'rsvp_closed', detail = 'RSVPs for this plan are closed', errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
