-- Notification settings per type, email delivery, the monthly summary, and
-- notifications for deleted or restored expenses and for being added to a group.
-- Design: docs/adr/0011-notification-prefs-and-email.md.
--
-- Settings are per category (the rows people see: "New expenses", "Payments",
-- ...), not per raw type:
--   private.notification_categories  one row per setting, with push and email defaults
--   private.notification_types       notification type -> category. A new type is ONE
--                                    insert here (on conflict do nothing). A type with no
--                                    row is pushed and never emailed.
--   public.notification_prefs        only what someone changed; null = use the default,
--                                    so a changed default reaches everyone who never
--                                    touched that setting.
--
-- Every notification still lands in the inbox. A before insert trigger records
-- where it goes in notifications.channels ('push', 'email'). The push hook calls
-- the notify edge function only for 'push'; 'email' queues the row in
-- private.email_outbox. Email also needs app_config.email_notifications = true
-- (false until a sender is configured), so with the flag off nothing is queued.
-- A cron job hands due emails to notify after a 60 second hold, folding quick
-- fixes to one expense into a single email.
--
-- Unsubscribe links carry an HMAC token signed with a key that never leaves the
-- database (private.signing_keys). public.email_unsubscribe(token) is the second
-- anon-callable RPC after invite_preview: the token is the credential.
--
-- private.push_notification: body as in 20261105160000_edge_function_hooks.sql
-- plus the 'push' channel check.

-- Categories and types ------------------------------------------------------------

create table private.notification_categories (
  category text primary key check (category ~ '^[a-z_]+$'),
  position int not null,
  push_default boolean not null,
  email_default boolean not null,
  push_allowed boolean not null default true,
  email_allowed boolean not null default true
);

comment on table private.notification_categories is
  'One row per notification setting people see, with its defaults. Labels live in packages/i18n (settings.notificationPrefs.categories).';

-- Defaults follow Splitwise: money, comments, groups and reminders push and email;
-- plans push only (they are chatty); the monthly summary is email only.
insert into private.notification_categories
  (category, position, push_default, email_default, push_allowed, email_allowed)
values
  ('expense_added', 10, true, true, true, true),
  ('expense_changed', 20, true, true, true, true),
  ('payments', 30, true, true, true, true),
  ('comments', 40, true, true, true, true),
  ('groups', 50, true, true, true, true),
  ('plans', 60, true, false, true, true),
  ('reminders', 70, true, true, true, true),
  ('monthly_summary', 80, false, true, false, true)
on conflict (category) do nothing;

create table private.notification_types (
  type text primary key,
  category text not null references private.notification_categories (category)
);

create index notification_types_category_idx on private.notification_types (category);

comment on table private.notification_types is
  'Which setting governs each notification type. Add one row per new type.';

-- Includes types other branches add (payment.*, debt.reminder, recurring.upcoming)
-- so they follow the right setting as soon as they exist.
insert into private.notification_types (type, category) values
  ('expense.created', 'expense_added'),
  ('expense.updated', 'expense_changed'),
  ('expense.deleted', 'expense_changed'),
  ('expense.restored', 'expense_changed'),
  ('settlement.created', 'payments'),
  ('settlement.deleted', 'payments'),
  ('payment.created', 'payments'),
  ('payment.updated', 'payments'),
  ('payment.deleted', 'payments'),
  ('payment.restored', 'payments'),
  ('comment.created', 'comments'),
  ('member.added', 'groups'),
  ('member.joined', 'groups'),
  ('event.created', 'plans'),
  ('event.scheduled', 'plans'),
  ('event.cancelled', 'plans'),
  ('availability.requested', 'plans'),
  ('event.reminder', 'reminders'),
  ('rsvp.reminder', 'reminders'),
  ('debt.reminder', 'reminders'),
  ('recurring.upcoming', 'reminders'),
  ('summary.monthly', 'monthly_summary')
on conflict (type) do nothing;

alter table private.notification_categories enable row level security;
alter table private.notification_types enable row level security;
revoke all on table private.notification_categories, private.notification_types from public, anon, authenticated;
grant all on table private.notification_categories, private.notification_types to service_role;

-- Preferences ----------------------------------------------------------------------

create table public.notification_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null references private.notification_categories (category),
  push boolean,
  email boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create index notification_prefs_category_idx on public.notification_prefs (category);

comment on table public.notification_prefs is
  'Notification settings someone changed. Null means the category default. Written through set_notification_pref and email_unsubscribe.';

create trigger notification_prefs_set_updated_at
before update on public.notification_prefs
for each row execute function private.set_updated_at();

alter table public.notification_prefs enable row level security;
revoke all on table public.notification_prefs from anon, authenticated;
grant select on table public.notification_prefs to authenticated;
grant all on table public.notification_prefs to service_role;

create policy "notification_prefs: read own"
on public.notification_prefs for select
to authenticated
using (user_id = (select auth.uid()));

-- Closing an account drops its settings.
create or replace function private.forget_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notification_prefs p where p.user_id = new.id;
  return null;
end;
$$;

revoke execute on function private.forget_notification_prefs() from public, anon, authenticated;

create trigger profiles_forget_notification_prefs
after update of deleted_at on public.profiles
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function private.forget_notification_prefs();

-- Every setting with the caller's effective value, in display order.
create or replace function public.my_notification_prefs()
returns table (category text, push boolean, email boolean, push_allowed boolean, email_allowed boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  return query
  select
    c.category,
    c.push_allowed and coalesce(p.push, c.push_default),
    c.email_allowed and coalesce(p.email, c.email_default),
    c.push_allowed,
    c.email_allowed
  from private.notification_categories c
  left join public.notification_prefs p on p.user_id = uid and p.category = c.category
  order by c.position;
end;
$$;

revoke execute on function public.my_notification_prefs() from public, anon;
grant execute on function public.my_notification_prefs() to authenticated, service_role;

-- Changes one setting. A null channel is left as it is.
create or replace function public.set_notification_pref(
  category text,
  push boolean default null,
  email boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
begin
  if not exists (
    select 1 from private.notification_categories c where c.category = set_notification_pref.category
  ) then
    raise exception using message = 'invalid_notification_category', detail = 'Unknown notification setting', errcode = '22023';
  end if;

  insert into public.notification_prefs as p (user_id, category, push, email)
  values (uid, set_notification_pref.category, set_notification_pref.push, set_notification_pref.email)
  on conflict (user_id, category) do update
    set push = coalesce(excluded.push, p.push),
        email = coalesce(excluded.email, p.email);
end;
$$;

revoke execute on function public.set_notification_pref(text, boolean, boolean) from public, anon;
grant execute on function public.set_notification_pref(text, boolean, boolean) to authenticated, service_role;

-- Routing --------------------------------------------------------------------------

insert into public.app_config (key, value) values ('email_notifications', 'false')
on conflict (key) do nothing;

create or replace function private.email_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.value = 'true'::jsonb from public.app_config c where c.key = 'email_notifications'),
    false
  );
$$;

-- Where a notification of this type goes for this person, besides the inbox.
create or replace function private.notification_channels(uid uuid, kind text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case
      when c.category is null or (c.push_allowed and coalesce(p.push, c.push_default)) then 'push'
    end,
    case
      when c.email_allowed and coalesce(p.email, c.email_default)
        and private.email_enabled()
        and exists (
          select 1 from auth.users u
          where u.id = uid and u.email is not null and u.email_confirmed_at is not null
        )
      then 'email'
    end
  ], null)
  from (select 1) as one
  left join private.notification_types t on t.type = kind
  left join private.notification_categories c on c.category = t.category
  left join public.notification_prefs p on p.user_id = uid and p.category = c.category;
$$;

alter table public.notifications add column channels text[] not null default '{}';

comment on column public.notifications.channels is
  'Where this notification was sent besides the inbox (push, email), decided from notification_prefs when it was created.';

create or replace function private.route_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.channels := private.notification_channels(new.user_id, new.type);
  return new;
end;
$$;

create trigger notifications_route
before insert on public.notifications
for each row execute function private.route_notification();

create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if 'push' = any (new.channels) then
    perform private.invoke_edge_function(
      'notify',
      jsonb_build_object('id', new.id, 'user_id', new.user_id, 'type', new.type, 'data', new.data)
    );
  end if;
  return null;
end;
$$;

-- Email outbox ---------------------------------------------------------------------

create table private.email_outbox (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Rows with the same subject fold into one email (several changes to one expense).
  subject text not null,
  queued_at timestamptz not null default now(),
  handled_at timestamptz,
  outcome text check (outcome in ('sent', 'folded', 'dropped'))
);

create index email_outbox_pending_idx on private.email_outbox (user_id, subject) where handled_at is null;
create index email_outbox_user_id_idx on private.email_outbox (user_id);

alter table private.email_outbox enable row level security;
revoke all on table private.email_outbox from public, anon, authenticated;
grant all on table private.email_outbox to service_role;

create or replace function private.queue_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if 'email' = any (new.channels) then
    insert into private.email_outbox (notification_id, user_id, subject)
    values (
      new.id,
      new.user_id,
      case
        when new.type like 'expense.%' and new.data ? 'expense_id' then 'expense:' || (new.data ->> 'expense_id')
        else new.id::text
      end
    );
  end if;
  return null;
end;
$$;

create trigger notifications_queue_email
after insert on public.notifications
for each row execute function private.queue_email();

-- Unsubscribe tokens ---------------------------------------------------------------

create table private.signing_keys (
  name text primary key,
  secret bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now()
);

alter table private.signing_keys enable row level security;
revoke all on table private.signing_keys from public, anon, authenticated, service_role;

insert into private.signing_keys (name) values ('email_unsubscribe') on conflict (name) do nothing;

-- '<user id>.<category or all>.<signature>', URL safe.
create or replace function private.unsubscribe_token(uid uuid, category text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select uid::text || '.' || category || '.' || left(
    translate(
      encode(extensions.hmac(convert_to(uid::text || '.' || category, 'UTF8'), k.secret, 'sha256'), 'base64'),
      '+/=',
      '-_'
    ),
    32
  )
  from private.signing_keys k
  where k.name = 'email_unsubscribe';
$$;

-- One-click unsubscribe from an email link, signed in or not. Returns the
-- category ('all' for every email). subscribe = true undoes it ('all' goes back
-- to the defaults).
create or replace function public.email_unsubscribe(token text, subscribe boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  parts text[] := string_to_array(coalesce(token, ''), '.');
  uid uuid;
  cat text;
begin
  if cardinality(parts) = 3 then
    uid := private.try_uuid(parts[1]);
    cat := parts[2];
  end if;

  if uid is null
     or not (cat = 'all' or exists (
       select 1 from private.notification_categories c where c.category = cat and c.email_allowed
     ))
     or token is distinct from private.unsubscribe_token(uid, cat) then
    raise exception using message = 'invalid_unsubscribe_link', detail = 'This unsubscribe link is not valid', errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is null) then
    insert into public.notification_prefs as p (user_id, category, email)
    select uid, c.category, case when cat = 'all' and subscribe then null else subscribe end
    from private.notification_categories c
    where c.email_allowed and (cat = 'all' or c.category = cat)
    on conflict (user_id, category) do update set email = excluded.email;
  end if;

  return cat;
end;
$$;

revoke execute on function public.email_unsubscribe(text, boolean) from public;
grant execute on function public.email_unsubscribe(text, boolean) to anon, authenticated, service_role;

-- Sending --------------------------------------------------------------------------

-- Hands due emails to the notify edge function. A subject is due once nothing new
-- was queued for it for `hold`. Per expense, one email: nothing when it was added
-- and deleted inside the hold, the deletion when it is gone, else the earliest
-- change (created beats updated), with current amounts and shares. Settings are
-- checked again, so turning email off inside the hold still counts. Queued rows
-- older than a day are dropped. Returns the number of emails handed over.
create or replace function private.send_email_notifications(hold interval default interval '60 seconds')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  chosen uuid;
  ex public.expenses;
  emails jsonb := '[]'::jsonb;
  item jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.send_email_notifications')) then
    return 0;
  end if;

  update private.email_outbox o set handled_at = now(), outcome = 'dropped'
  where o.handled_at is null and o.queued_at < now() - interval '1 day';

  if not private.email_enabled() then
    return 0;
  end if;

  for r in
    -- Oldest first; within one transaction (same created_at) a creation comes before a change.
    select o.user_id, o.subject,
      array_agg(o.notification_id order by n.created_at, n.type <> 'expense.created', n.id) as ids,
      array_agg(n.type order by n.created_at, n.type <> 'expense.created', n.id) as types
    from private.email_outbox o
    join public.notifications n on n.id = o.notification_id
    where o.handled_at is null
    group by o.user_id, o.subject
    having max(o.queued_at) <= now() - hold
    order by min(o.queued_at)
    limit 100
  loop
    chosen := null;
    ex := null;
    if r.subject like 'expense:%' then
      select * into ex from public.expenses e where e.id = private.try_uuid(substr(r.subject, 9));
      if ex.id is null or ex.deleted_at is not null then
        if not ('expense.created' = any (r.types)) then
          select x.i into chosen from unnest(r.ids, r.types) with ordinality as x (i, ty, ord)
          where x.ty = 'expense.deleted' order by x.ord limit 1;
        end if;
      else
        select x.i into chosen from unnest(r.ids, r.types) with ordinality as x (i, ty, ord)
        where x.ty <> 'expense.deleted' order by x.ord limit 1;
      end if;
    else
      chosen := r.ids[1];
    end if;

    update private.email_outbox o
    set handled_at = now(), outcome = case when o.notification_id = chosen then 'sent' else 'folded' end
    where o.notification_id = any (r.ids);

    if chosen is null then
      continue;
    end if;

    item := null;
    select jsonb_build_object(
      'id', n.id,
      'type', n.type,
      'category', t.category,
      'to', u.email,
      'name', p.display_name,
      'timezone', p.timezone,
      'unsubscribe', private.unsubscribe_token(n.user_id, t.category),
      'unsubscribe_all', private.unsubscribe_token(n.user_id, 'all'),
      'data', n.data
        || jsonb_strip_nulls(jsonb_build_object(
          'group_name', case when g.is_direct then null else g.name end,
          'group_emoji', g.emoji,
          'actor_name', a.display_name
        ))
        || case when ex.id is not null and ex.deleted_at is null then jsonb_strip_nulls(jsonb_build_object(
          'description', ex.description,
          'amount_cents', ex.amount_cents,
          'currency', ex.currency,
          'share_cents', (select s.share_cents from public.expense_splits s
                          where s.expense_id = ex.id and s.user_id = n.user_id)
        )) else '{}'::jsonb end
    )
    into item
    from public.notifications n
    join private.notification_types t on t.type = n.type
    join public.profiles p on p.id = n.user_id and p.deleted_at is null
    join auth.users u on u.id = n.user_id and u.email is not null and u.email_confirmed_at is not null
    left join public.groups g on g.id = private.try_uuid(n.data ->> 'group_id')
    left join public.profiles a on a.id = private.try_uuid(n.data ->> 'actor_id')
    where n.id = chosen
      and 'email' = any (private.notification_channels(n.user_id, n.type));

    if item is null then
      update private.email_outbox o set outcome = 'dropped' where o.notification_id = chosen;
    else
      emails := emails || jsonb_build_array(item);
    end if;
  end loop;

  if jsonb_array_length(emails) > 0 then
    perform private.invoke_edge_function('notify', jsonb_build_object('emails', emails));
  end if;
  return jsonb_array_length(emails);
end;
$$;

-- Monthly summary ------------------------------------------------------------------

-- One person's month: every group where they have a balance or something
-- happened to them that month, biggest balance first. Amounts in group currency.
create or replace function private.monthly_summary(uid uuid, month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', month::timestamp)::date as starts,
           (date_trunc('month', month::timestamp) + interval '1 month')::date as ends
  ),
  mine as (
    select
      g.id,
      case
        when g.is_direct then coalesce((
          select o.display_name from public.group_members m2
          join public.profiles o on o.id = m2.user_id
          where m2.group_id = g.id and m2.user_id <> uid
          limit 1
        ), g.name)
        else g.name
      end as name,
      g.emoji,
      g.is_direct,
      g.currency::text as currency,
      coalesce((select b.net_cents from public.group_balances b where b.group_id = g.id and b.user_id = uid), 0) as net_cents,
      (select count(*) from public.expenses e, bounds
       where e.group_id = g.id and e.deleted_at is null
         and e.created_at >= bounds.starts and e.created_at < bounds.ends
         and (e.paid_by = uid or exists (
           select 1 from public.expense_splits s where s.expense_id = e.id and s.user_id = uid
         )))::int as expenses,
      (select count(*) from public.settlements s, bounds
       where s.group_id = g.id and s.deleted_at is null
         and s.created_at >= bounds.starts and s.created_at < bounds.ends
         and uid in (s.from_user, s.to_user))::int as payments
    from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.user_id = uid
  )
  select jsonb_build_object(
    'month', (select to_char(bounds.starts, 'YYYY-MM-DD') from bounds),
    'groups', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_id', mine.id,
          'name', mine.name,
          'emoji', mine.emoji,
          'is_direct', mine.is_direct,
          'currency', mine.currency,
          'net_cents', mine.net_cents,
          'expenses', mine.expenses,
          'payments', mine.payments
        )
        order by abs(mine.net_cents) desc, mine.name, mine.id
      ) filter (where mine.net_cents <> 0 or mine.expenses > 0 or mine.payments > 0),
      '[]'::jsonb
    )
  )
  from mine;
$$;

-- On the first of the month: one summary.monthly notification (an inbox card,
-- and an email when email is on) for everyone with a non-zero balance. Run twice
-- for the same month, it skips people who already have theirs. Returns how many
-- were written.
create or replace function private.send_monthly_summaries(
  month date default (date_trunc('month', now()) - interval '1 month')::date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  starts date := date_trunc('month', month::timestamp)::date;
  sent int := 0;
begin
  for uid in
    select distinct b.user_id
    from public.group_balances b
    join public.group_members m on m.group_id = b.group_id and m.user_id = b.user_id
    join public.profiles p on p.id = b.user_id and p.deleted_at is null
    where b.net_cents <> 0
      and not exists (
        select 1 from public.notifications n
        where n.user_id = b.user_id and n.type = 'summary.monthly'
          and n.data ->> 'month' = to_char(starts, 'YYYY-MM-DD')
      )
    order by b.user_id
  loop
    perform private.notify(array[uid], 'summary.monthly', private.monthly_summary(uid, starts));
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- New notification types -----------------------------------------------------------

-- expense.deleted and expense.restored go to everyone in the expense.
create or replace function private.expenses_notify_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
  recipients uuid[];
begin
  if old.deleted_at is null and new.deleted_at is not null then
    kind := 'expense.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    kind := 'expense.restored';
  else
    return null;
  end if;

  select array_agg(distinct u) into recipients
  from (
    select s.user_id as u from public.expense_splits s where s.expense_id = new.id
    union
    select new.paid_by
  ) x;

  perform private.notify(
    recipients,
    kind,
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;

create trigger expenses_notify_removal
after update of deleted_at on public.expenses
for each row execute function private.expenses_notify_removal();

-- member.added: someone else put you in a group (not 1:1 tabs, not joining
-- through an invite yourself).
create or replace function private.group_members_notify_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or actor = new.user_id
     or exists (select 1 from public.groups g where g.id = new.group_id and g.is_direct) then
    return null;
  end if;

  perform private.notify(
    array[new.user_id],
    'member.added',
    jsonb_build_object('group_id', new.group_id, 'role', new.role),
    actor
  );
  return null;
end;
$$;

create trigger group_members_notify_added
after insert on public.group_members
for each row execute function private.group_members_notify_added();

revoke execute on function
  private.email_enabled(),
  private.notification_channels(uuid, text),
  private.route_notification(),
  private.queue_email(),
  private.unsubscribe_token(uuid, text),
  private.send_email_notifications(interval),
  private.monthly_summary(uuid, date),
  private.send_monthly_summaries(date),
  private.expenses_notify_removal(),
  private.group_members_notify_added()
from public, anon, authenticated;

-- Jobs -----------------------------------------------------------------------------

select cron.schedule('email-notifications', '* * * * *',
  $$select private.send_email_notifications()$$);
select cron.schedule('monthly-summary', '0 15 1 * *',
  $$select private.send_monthly_summaries()$$);
