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
-- fixes to one expense into a single email, in batches; notify reports each batch
-- back through email_outbox_report (service role only), and unreported or failed
-- batches are retried.
--
-- Unsubscribe links carry an HMAC token signed with a key that never leaves the
-- database (private.signing_keys). public.email_unsubscribe(token, action) is the
-- second anon-callable RPC after invite_preview: the token is the credential. An
-- unsubscribe remembers what it changed so undo restores exactly that.
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

-- Includes types other work adds (payment edits, deletes and restores from settle
-- up, debt.reminder, recurring.upcoming) so they follow the right setting as soon
-- as they exist. member.added has no sender yet: nobody can put someone else in a
-- group today except 1:1 tabs, which are skipped. It is ready for placeholder
-- members.
insert into private.notification_types (type, category) values
  ('expense.created', 'expense_added'),
  ('expense.updated', 'expense_changed'),
  ('expense.deleted', 'expense_changed'),
  ('expense.restored', 'expense_changed'),
  ('settlement.created', 'payments'),
  ('settlement.updated', 'payments'),
  ('settlement.deleted', 'payments'),
  ('settlement.restored', 'payments'),
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

-- Closing an account drops its settings (and any unsubscribe snapshot).
create or replace function private.forget_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notification_prefs p where p.user_id = new.id;
  delete from private.email_unsubscribe_undo u where u.user_id = new.id;
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

  -- A setting changed by hand makes any unsubscribe snapshot stale.
  delete from private.email_unsubscribe_undo u where u.user_id = uid;
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

-- One row per notification routed to email. state:
--   pending  waiting for the hold (or a retry after a failed send)
--   folded   another email for the same subject covered it
--   sending  handed to notify in batch_id, waiting for its report
--   sent     the provider accepted it
--   failed   gave up after 5 attempts
--   dropped  no longer wanted (settings changed, too old, or invalid)
create table private.email_outbox (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Rows with the same subject fold into one email (several changes to one expense).
  subject text not null,
  queued_at timestamptz not null default now(),
  state text not null default 'pending'
    check (state in ('pending', 'folded', 'sending', 'sent', 'failed', 'dropped')),
  attempts int not null default 0,
  batch_id uuid,
  claimed_at timestamptz,
  retry_at timestamptz,
  handled_at timestamptz,
  last_error text
);

create index email_outbox_pending_idx on private.email_outbox (user_id, subject) where state = 'pending';
create index email_outbox_batch_idx on private.email_outbox (batch_id) where state = 'sending';
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

-- What an unsubscribe link changed, so "keep sending them" puts back exactly that.
-- prior maps each category the link covered to its email setting before (true,
-- false or null for the default). Dropped when the person changes a setting
-- themselves, since the snapshot is stale by then.
create table private.email_unsubscribe_undo (
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null,
  prior jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table private.email_unsubscribe_undo enable row level security;
revoke all on table private.email_unsubscribe_undo from public, anon, authenticated;
grant all on table private.email_unsubscribe_undo to service_role;

-- "a***@example.com": enough for someone to recognize their account, not enough to
-- learn an address from a forwarded link.
create or replace function private.mask_email(address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when address is null or position('@' in address) < 2 then null
    else left(address, 1) || '***' || substr(address, position('@' in address))
  end;
$$;

-- Email unsubscribe links, signed in or not; the token is the credential.
-- action:
--   preview      change nothing, say what the link covers
--   unsubscribe  turn email off for the link's category ('all': every category)
--   undo         put back what the last unsubscribe with this link changed
-- Returns { category, email (masked), subscribed (any email in scope still on) }.
create or replace function public.email_unsubscribe(token text, action text default 'unsubscribe')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  parts text[] := string_to_array(coalesce(token, ''), '.');
  uid uuid;
  cat text;
  cats text[];
  saved jsonb;
  active boolean;
  address text;
  subscribed boolean;
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
  if action is null or action not in ('preview', 'unsubscribe', 'undo') then
    raise exception using message = 'invalid_payload', detail = 'action must be preview, unsubscribe or undo', errcode = '22023';
  end if;

  select array_agg(c.category order by c.position) into cats
  from private.notification_categories c
  where c.email_allowed and (cat = 'all' or c.category = cat);

  active := exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is null);

  if active and action = 'unsubscribe' then
    -- Only the first click is remembered: a second one would snapshot "all off".
    insert into private.email_unsubscribe_undo (user_id, scope, prior)
    select uid, cat, jsonb_object_agg(s.c, p.email)
    from unnest(cats) as s (c)
    left join public.notification_prefs p on p.user_id = uid and p.category = s.c
    on conflict (user_id, scope) do nothing;

    insert into public.notification_prefs as p (user_id, category, email)
    select uid, s.c, false from unnest(cats) as s (c)
    on conflict (user_id, category) do update set email = false;
  elsif active and action = 'undo' then
    delete from private.email_unsubscribe_undo u
    where u.user_id = uid and u.scope = cat
    returning u.prior into saved;

    -- With the snapshot: exactly what it held. Without one (already undone, or the
    -- person changed settings since): that category on, or every default for 'all'.
    insert into public.notification_prefs as p (user_id, category, email)
    select uid, s.c,
      case
        when saved is not null then (saved ->> s.c)::boolean
        when cat = 'all' then null
        else true
      end
    from unnest(cats) as s (c)
    on conflict (user_id, category) do update set email = excluded.email;
  end if;

  select bool_or(coalesce(p.email, c.email_default)) into subscribed
  from unnest(cats) as s (c)
  join private.notification_categories c on c.category = s.c
  left join public.notification_prefs p on p.user_id = uid and p.category = s.c;

  if active then
    select u.email into address from auth.users u where u.id = uid;
  end if;

  return jsonb_build_object(
    'category', cat,
    'email', private.mask_email(address),
    'subscribed', active and coalesce(subscribed, false)
  );
end;
$$;

revoke execute on function public.email_unsubscribe(text, text) from public;
grant execute on function public.email_unsubscribe(text, text) to anon, authenticated, service_role;

-- Sending --------------------------------------------------------------------------

-- Hands due emails to the notify edge function, batch_size per call. A subject is
-- due once nothing new was queued for it for `hold`. Per expense, one email:
-- nothing when it was added and deleted inside the hold, the deletion when it is
-- gone, else the earliest change (created beats updated), with current amounts and
-- shares. Settings are checked again, so turning email off inside the hold counts.
--
-- Delivery is at least once, made close to exactly once by the provider: notify
-- answers right away and reports each batch through email_outbox_report. A batch
-- with no report after 10 minutes goes out again under the same batch_id, which
-- notify uses as the provider's idempotency key, so a send that did go out is not
-- repeated. A reported failure retries with a fresh batch after 2, 4, 8, 16 minutes;
-- after 5 attempts the row is failed. Rows not sent within a day are dropped.
-- Returns the number of emails handed over.
create or replace function private.send_email_notifications(
  hold interval default interval '60 seconds',
  batch_size int default 50
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  b record;
  chosen uuid;
  old_batch uuid;
  ex public.expenses;
  item jsonb;
  picked jsonb := '[]'::jsonb;
  batches jsonb;
  handed int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.send_email_notifications')) then
    return 0;
  end if;

  update private.email_outbox o
  set state = 'dropped', handled_at = now(), last_error = coalesce(o.last_error, 'not sent within a day')
  where o.state = 'pending' and o.queued_at < now() - interval '1 day';

  update private.email_outbox o
  set state = case when o.attempts >= 5 then 'failed' else 'pending' end,
      handled_at = case when o.attempts >= 5 then now() end,
      last_error = 'no report from notify'
  where o.state = 'sending' and o.claimed_at < now() - interval '10 minutes';

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
    where o.state = 'pending'
    group by o.user_id, o.subject
    having max(o.queued_at) <= now() - hold
       and max(coalesce(o.retry_at, '-infinity'::timestamptz)) <= now()
    order by min(o.queued_at)
    limit 200
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
    set state = 'folded', handled_at = now()
    where o.notification_id = any (r.ids) and o.notification_id is distinct from chosen;

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
      update private.email_outbox o
      set state = 'dropped', handled_at = now(), last_error = 'no longer wanted'
      where o.notification_id = chosen;
      continue;
    end if;

    select o.batch_id into old_batch from private.email_outbox o where o.notification_id = chosen;
    picked := picked || jsonb_build_array(jsonb_build_object('id', chosen, 'batch', old_batch, 'item', item));
  end loop;

  -- Rows that come back without a report keep their batch (same idempotency key);
  -- the rest are cut into new batches of batch_size.
  with p as (
    select (x.e ->> 'id')::uuid as id, (x.e ->> 'batch')::uuid as old_batch, x.e -> 'item' as item, x.n
    from jsonb_array_elements(picked) with ordinality as x (e, n)
  ),
  fresh as (
    select p.id, (row_number() over (order by p.n) - 1) / greatest(batch_size, 1) as grp
    from p where p.old_batch is null
  ),
  grps as (
    select g.grp, gen_random_uuid() as batch from (select distinct f.grp from fresh f) g
  ),
  assigned as (
    select p.id, p.item, coalesce(p.old_batch, grps.batch) as batch
    from p left join fresh on fresh.id = p.id left join grps on grps.grp = fresh.grp
  ),
  marked as (
    update private.email_outbox o
    set state = 'sending', batch_id = a.batch, attempts = o.attempts + 1, claimed_at = now(),
        retry_at = null
    from assigned a
    where o.notification_id = a.id
    returning o.notification_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('batch', a.batch, 'emails', a.emails)), '[]'::jsonb)
  into batches
  from (select s.batch, jsonb_agg(s.item) as emails from assigned s group by s.batch) a;

  for b in select x.value from jsonb_array_elements(batches) as x loop
    perform private.invoke_edge_function(
      'notify',
      jsonb_build_object('batch', b.value -> 'batch', 'emails', b.value -> 'emails')
    );
    handed := handed + jsonb_array_length(b.value -> 'emails');
  end loop;
  return handed;
end;
$$;

-- notify reports each batch here (service role only). delivered: the provider took
-- the whole batch. rejected: emails notify could not build, dropped for good.
create or replace function public.email_outbox_report(
  batch uuid,
  delivered boolean,
  error text default null,
  rejected uuid[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update private.email_outbox o
  set state = 'dropped', handled_at = now(), last_error = 'rejected by notify'
  where o.batch_id = email_outbox_report.batch and o.state = 'sending'
    and o.notification_id = any (coalesce(email_outbox_report.rejected, '{}'));

  if email_outbox_report.delivered then
    update private.email_outbox o
    set state = 'sent', handled_at = now(), last_error = null
    where o.batch_id = email_outbox_report.batch and o.state = 'sending';
  else
    -- A known failure retries with a fresh batch, so a fresh idempotency key.
    update private.email_outbox o
    set state = case when o.attempts >= 5 then 'failed' else 'pending' end,
        handled_at = case when o.attempts >= 5 then now() end,
        batch_id = case when o.attempts >= 5 then o.batch_id end,
        retry_at = now() + make_interval(mins => power(2, o.attempts)::int),
        last_error = left(coalesce(email_outbox_report.error, 'send failed'), 500)
    where o.batch_id = email_outbox_report.batch and o.state = 'sending';
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.email_outbox_report(uuid, boolean, text, uuid[]) from public, anon, authenticated;
grant execute on function public.email_outbox_report(uuid, boolean, text, uuid[]) to service_role;

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
-- and an email when email is on) for everyone with a non-zero balance who has not
-- turned the summary off. Its setting is the monthly_summary email flag, which
-- covers the card too. Run twice for the same month, it skips people who already
-- have theirs. Returns how many were written.
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
      and coalesce(
        (select np.email from public.notification_prefs np
         where np.user_id = b.user_id and np.category = 'monthly_summary'),
        (select c.email_default from private.notification_categories c where c.category = 'monthly_summary')
      )
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
  private.send_email_notifications(interval, int),
  private.mask_email(text),
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
