-- Placeholder members (ADR 19): people added to a group by name before they have an
-- account. They are profiles without an auth user, ordinary members for money, and are
-- claimed by a real account through their claim link or by verifying the same email.
--
-- Redefined here, bodies as in supabase/schema/current.sql plus the change noted at each:
-- private.group_members_activity, private.group_members_notify, private.befriend_group_members,
-- private.expenses_activity, private.expenses_notify_update, private.guard_open_group_write,
-- private.set_updated_at, private.notification_channels, private.send_email_notifications,
-- public.accept_invite, public.leave_group, public.delete_my_account,
-- public.request_availability, public.best_slots.

-- Profiles without an auth user -------------------------------------------------

alter table public.profiles
  add column is_placeholder boolean not null default false;

comment on column public.profiles.is_placeholder is
  'Someone added to a group by name who has no account yet (ADR 19). Never signs in, never gets push.';
comment on table public.profiles is
  'One row per auth user, plus placeholders (is_placeholder, no auth user). Tombstoned (not deleted) when an account is closed.';

create index profiles_placeholder_idx on public.profiles (id) where is_placeholder;

-- The foreign key to auth.users cannot hold a placeholder. Two triggers keep its meaning
-- for real people: a real profile needs an auth user, and deleting the auth user deletes it.
alter table public.profiles drop constraint profiles_id_fkey;

create or replace function private.profile_needs_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_placeholder and not exists (select 1 from auth.users u where u.id = new.id) then
    raise exception using
      message = 'profile_without_account',
      detail = 'A profile needs an account unless it is a placeholder',
      errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.profile_needs_account() from public, anon, authenticated;

create trigger profiles_need_account
before insert or update of id, is_placeholder on public.profiles
for each row execute function private.profile_needs_account();

create or replace function private.forget_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles p where p.id = old.id and not p.is_placeholder;
  return null;
end;
$$;

revoke execute on function private.forget_deleted_auth_user() from public, anon, authenticated;

create trigger on_auth_user_deleted
after delete on auth.users
for each row execute function private.forget_deleted_auth_user();

-- True while private.claim_placeholder rewrites ids, so triggers do not read it as edits.
create or replace function private.claiming()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('potluck.claiming', true), '') = 'on';
$$;

revoke execute on function private.claiming() from public, anon, authenticated;

-- Placeholder details ------------------------------------------------------------

create table public.placeholders (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  email text check (
    email is null
    or (email ~ '^[^@\s]+@[^@\s]+$' and char_length(email) <= 254 and email = lower(email))
  ),
  email_hint text generated always as (private.mask_email(email)) stored,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  invited_at timestamptz,
  invites_sent smallint not null default 0 check (invites_sent >= 0),
  reminded_at timestamptz
);

comment on table public.placeholders is
  'One row per placeholder profile: its group, the email its invite goes to (members see only email_hint), invite and reminder times.';

create index placeholders_group_idx on public.placeholders (group_id);
create index placeholders_created_by_idx on public.placeholders (created_by);
create index placeholders_email_idx on public.placeholders (email) where email is not null;
create unique index placeholders_group_email_key on public.placeholders (group_id, email)
  where email is not null;

alter table public.placeholders enable row level security;
revoke all on table public.placeholders from anon, authenticated;
grant select (profile_id, group_id, email_hint, created_by, created_at, invited_at, reminded_at)
  on table public.placeholders to authenticated;
grant all on table public.placeholders to service_role;

create policy "placeholders: members read" on public.placeholders
for select to authenticated
using (group_id = any (array(select private.my_group_ids())));

-- The claim link is a group invite that names the placeholder it hands over.
alter table public.group_invites
  add column placeholder_id uuid references public.profiles (id) on delete set null;

comment on column public.group_invites.placeholder_id is
  'Claim link: accepting it hands this placeholder (and its history) to the account (ADR 19).';

create index group_invites_placeholder_idx on public.group_invites (placeholder_id);

-- A placeholder stays a plain member of its own group.
create or replace function private.guard_placeholder_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder)
     and not private.claiming()
     and (
       new.role <> 'member'
       or not exists (
         select 1 from public.placeholders x
         where x.profile_id = new.user_id and x.group_id = new.group_id
       )
     ) then
    raise exception using
      message = 'placeholder_member',
      detail = 'Someone who is not on Potluck yet can only be a member of the group they were added to',
      errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_placeholder_member() from public, anon, authenticated;

create trigger group_members_placeholder_guard
before insert or update on public.group_members
for each row execute function private.guard_placeholder_member();

-- Removing a placeholder kills its claim link; one nothing in the group names is deleted.
create or replace function private.forget_removed_placeholder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = old.user_id and p.is_placeholder)
     or not exists (select 1 from public.groups g where g.id = old.group_id) then
    return null;
  end if;

  update public.group_invites i set revoked_at = coalesce(i.revoked_at, now())
  where i.placeholder_id = old.user_id;

  if not private.referenced_in_group(old.group_id, old.user_id) then
    delete from public.profiles p where p.id = old.user_id and p.is_placeholder;
  end if;
  return null;
end;
$$;

revoke execute on function private.forget_removed_placeholder() from public, anon, authenticated;

create trigger group_members_forget_placeholder
after delete on public.group_members
for each row execute function private.forget_removed_placeholder();

-- A deleted group takes its placeholders along. Deferred to commit: the group's expenses,
-- which name them, are deleted by cascades that may still be pending when the group's own
-- placeholders row goes.
create or replace function private.forget_orphan_placeholder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles p
  where p.id = old.profile_id
    and p.is_placeholder
    and not exists (select 1 from public.placeholders x where x.profile_id = p.id);
  return null;
end;
$$;

revoke execute on function private.forget_orphan_placeholder() from public, anon, authenticated;

create constraint trigger placeholders_forget_profile
after delete on public.placeholders
deferrable initially deferred
for each row execute function private.forget_orphan_placeholder();

-- Notifications: placeholders only ever get their invite ---------------------------

create or replace function private.skip_placeholder_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'member.added'
     and exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function private.skip_placeholder_notification() from public, anon, authenticated;

create trigger notifications_skip_placeholders
before insert on public.notifications
for each row execute function private.skip_placeholder_notification();

-- Body as in schema/current.sql plus: never push to a placeholder, and email a placeholder
-- at the address saved for it.
create or replace function private.notification_channels(uid uuid, kind text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case
      when not coalesce(me.is_placeholder, false)
        and (c.category is null or (c.push_allowed and coalesce(p.push, c.push_default))) then 'push'
    end,
    case
      when c.email_allowed and coalesce(p.email, c.email_default)
        and private.email_enabled()
        and (
          exists (
            select 1 from auth.users u
            where u.id = uid and u.email is not null and u.email_confirmed_at is not null
          )
          or exists (
            select 1 from public.placeholders x where x.profile_id = uid and x.email is not null
          )
        )
      then 'email'
    end
  ], null)
  from (select 1) as one
  left join public.profiles me on me.id = uid
  left join private.notification_types t on t.type = kind
  left join private.notification_categories c on c.category = t.category
  left join public.notification_prefs p on p.user_id = uid and p.category = c.category;
$$;

-- Body as in schema/current.sql plus: a placeholder's address comes from placeholders, and
-- its email carries the claim link code.
create or replace function private.send_email_notifications(hold interval default '00:01:00'::interval, batch_size integer default 50)
returns integer
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
      'to', coalesce(u.email, ph.email),
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
        || case when ph.profile_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'placeholder', true,
          'claim_code', (
            select i.code from public.group_invites i
            where i.placeholder_id = ph.profile_id and i.revoked_at is null
            order by i.created_at desc
            limit 1
          )
        )) else '{}'::jsonb end
        || case when ex.id is not null and ex.deleted_at is null then jsonb_strip_nulls(jsonb_build_object(
          'description', ex.description,
          'amount_cents', ex.amount_cents,
          'currency', ex.currency
        )) || jsonb_build_object(
          'share_cents', coalesce((select s.share_cents from public.expense_splits s
                                   where s.expense_id = ex.id and s.user_id = n.user_id), 0)
        ) else '{}'::jsonb end
    )
    into item
    from public.notifications n
    join private.notification_types t on t.type = n.type
    join public.profiles p on p.id = n.user_id and p.deleted_at is null
    left join auth.users u on u.id = n.user_id and u.email is not null and u.email_confirmed_at is not null
    left join public.placeholders ph on ph.profile_id = n.user_id and ph.email is not null and p.is_placeholder
    left join public.groups g on g.id = private.try_uuid(n.data ->> 'group_id')
    left join public.profiles a on a.id = private.try_uuid(n.data ->> 'actor_id')
    where n.id = chosen
      and (u.id is not null or ph.profile_id is not null)
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

  -- Rows that come back without a report keep their batch (same idempotency key),
  -- but only when every row of that batch is being sent again: a different set of
  -- emails under the same key would be refused by the provider. Everything else is
  -- cut into new batches of batch_size.
  with p0 as (
    select (x.e ->> 'id')::uuid as id, (x.e ->> 'batch')::uuid as old_batch, x.e -> 'item' as item, x.n
    from jsonb_array_elements(picked) with ordinality as x (e, n)
  ),
  intact as (
    select p0.old_batch from p0
    where p0.old_batch is not null
    group by p0.old_batch
    having count(*) = (select count(*) from private.email_outbox o where o.batch_id = p0.old_batch)
  ),
  p as (
    select p0.id, case when p0.old_batch in (select i.old_batch from intact i) then p0.old_batch end as old_batch,
      p0.item, p0.n
    from p0
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

-- Membership triggers --------------------------------------------------------------

-- Body as in schema/current.sql plus: a placeholder is "added" by whoever added it (not
-- "joined"), and the id rewrite of a claim is not a change.
create or replace function private.group_members_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.claiming() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder) then
      perform private.log_activity(new.group_id, auth.uid(), 'member.added', new.user_id,
        jsonb_build_object('user_id', new.user_id, 'role', new.role, 'placeholder', true));
    else
      perform private.log_activity(new.group_id, new.user_id, 'member.joined', new.user_id,
        jsonb_build_object('user_id', new.user_id, 'role', new.role));
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.log_activity(new.group_id, auth.uid(), 'member.role_changed', new.user_id,
        jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
    end if;
  elsif exists (select 1 from public.profiles p where p.id = old.user_id) then
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

-- Body as in schema/current.sql plus: a placeholder joining is not news for the admins.
create or replace function private.group_members_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if exists (select 1 from public.groups g where g.id = new.group_id and g.is_direct)
     or exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder) then
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

-- Body as in schema/current.sql plus: placeholders make no friends.
create or replace function private.befriend_group_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder) then
    return null;
  end if;

  insert into public.friendships (user_id, friend_id)
  select pair.a, pair.b
  from public.group_members m
  join public.profiles mp on mp.id = m.user_id and not mp.is_placeholder
  cross join lateral (
    values (new.user_id, m.user_id), (m.user_id, new.user_id)
  ) as pair (a, b)
  where m.group_id = new.group_id
    and m.user_id <> new.user_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = new.user_id and b.blocked_id = m.user_id)
         or (b.blocker_id = m.user_id and b.blocked_id = new.user_id)
    )
  on conflict do nothing;

  return null;
end;
$$;

-- Triggers that must not read a claim as an edit -----------------------------------

-- Body as in schema/current.sql plus the claiming check.
create or replace function private.expenses_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verb text;
  changes jsonb;
begin
  if private.claiming() then
    return null;
  end if;
  if tg_op = 'UPDATE' and current_setting('potluck.expense_logged', true) = new.id::text
     and (old.deleted_at is null) = (new.deleted_at is null) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    verb := 'expense.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    verb := 'expense.deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    verb := 'expense.restored';
  elsif (new.description, new.amount_cents, new.currency, new.fx_rate, new.paid_by, new.split_type,
         new.category, new.notes, new.spent_at, new.receipt_path, new.event_id, new.is_refund,
         new.tax_cents, new.tip_cents, new.discount_cents)
        is distinct from
        (old.description, old.amount_cents, old.currency, old.fx_rate, old.paid_by, old.split_type,
         old.category, old.notes, old.spent_at, old.receipt_path, old.event_id, old.is_refund,
         old.tax_cents, old.tip_cents, old.discount_cents) then
    verb := 'expense.updated';
    changes := private.expense_row_changes(old, new);
  else
    return null;
  end if;

  perform private.log_activity(new.group_id, coalesce(auth.uid(), new.created_by), verb, new.id,
    jsonb_build_object(
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'paid_by', new.paid_by,
      'is_refund', new.is_refund
    ) || case when changes is null then '{}'::jsonb else jsonb_build_object('changes', changes) end);
  return null;
end;
$$;

-- Body as in schema/current.sql plus the claiming check. This one is deferred to commit,
-- when the setting is already cleared, so it also recognises a pure payer id swap.
create or replace function private.expenses_notify_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if private.claiming() then
    return null;
  end if;
  if new.deleted_at is not null or old.deleted_at is not null
     or (new.description, new.amount_cents, new.currency, new.fx_rate, new.paid_by, new.split_type,
         new.spent_at, new.is_refund)
        is not distinct from
        (old.description, old.amount_cents, old.currency, old.fx_rate, old.paid_by, old.split_type,
         old.spent_at, old.is_refund) then
    return null;
  end if;
  -- Only the payer changed, from a placeholder to the account that claimed it.
  if (new.description, new.amount_cents, new.currency, new.fx_rate, new.split_type,
      new.spent_at, new.is_refund)
     is not distinct from
     (old.description, old.amount_cents, old.currency, old.fx_rate, old.split_type,
      old.spent_at, old.is_refund)
     and not exists (select 1 from public.profiles p where p.id = old.paid_by) then
    return null;
  end if;

  select array_agg(distinct u) into recipients
  from (
    select s.user_id as u from public.expense_splits s where s.expense_id = new.id
    union
    select y.user_id from public.expense_payers y where y.expense_id = new.id
    union
    select new.paid_by
  ) x;

  perform private.notify(
    recipients,
    'expense.updated',
    jsonb_build_object(
      'expense_id', new.id,
      'group_id', new.group_id,
      'description', new.description,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'is_refund', new.is_refund
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return null;
end;
$$;

-- Body as in schema/current.sql plus the claiming check (claims also run in archived groups).
create or replace function private.guard_open_group_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  gid uuid;
  deadline timestamptz;
begin
  if auth.uid() is null or private.claiming() then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'event_rsvps' then
    select e.group_id, e.rsvp_deadline into gid, deadline
    from public.events e where e.id = (row ->> 'event_id')::uuid;
  elsif tg_table_name = 'comments' then
    gid := coalesce(
      (select x.group_id from public.expenses x where x.id = (row ->> 'expense_id')::uuid),
      (select e.group_id from public.events e where e.id = (row ->> 'event_id')::uuid),
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

-- Body as in schema/current.sql plus: a claim does not count as an edit. Runs as the
-- caller (not security definer), so it reads the setting itself.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('potluck.claiming', true), '') = 'on' then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Claiming -------------------------------------------------------------------------

-- Hands placeholder `ph` and everything that names it to account `acct`. Callers check
-- who may claim (accept_invite: the link, a verified matching email; the auth trigger:
-- a verified matching email). `announce` tells the account it was added (automatic claims).
create or replace function private.claim_placeholder(ph uuid, acct uuid, announce boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
  added_by uuid;
  ph_name text;
  needle text := ph::text;
  fk record;
begin
  select x.group_id, x.created_by into gid, added_by
  from public.placeholders x where x.profile_id = ph;

  if gid is null then
    raise exception using message = 'placeholder_not_found', detail = 'This seat is no longer saved', errcode = 'PT404';
  end if;

  -- Money writes share-lock the group row: none runs while ids are rewritten.
  perform 1 from public.groups g where g.id = gid for no key update;

  if not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = ph) then
    raise exception using message = 'placeholder_not_found', detail = 'This seat is no longer saved', errcode = 'PT404';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = acct and not p.is_placeholder and p.deleted_at is null
  ) then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;
  if exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = acct)
     or exists (select 1 from private.former_members f where f.group_id = gid and f.user_id = acct)
     or private.referenced_in_group(gid, acct) then
    raise exception using
      message = 'placeholder_claim_conflict',
      detail = 'You are already in this group under your own name',
      errcode = '23514';
  end if;
  if private.blocked_in_group(gid, acct) then
    raise exception using message = 'blocked', detail = 'You cannot join this group', errcode = '42501';
  end if;

  select p.display_name into ph_name from public.profiles p where p.id = ph;

  perform set_config('potluck.claiming', 'on', true);

  -- Rows that belong to the placeholder alone, not to its history.
  delete from public.notifications n where n.user_id = ph;
  delete from public.notification_prefs p where p.user_id = ph;
  delete from private.email_unsubscribe_undo u where u.user_id = ph;
  delete from public.friendships f where f.user_id = ph or f.friend_id = ph;
  update public.group_invites i set revoked_at = coalesce(i.revoked_at, now())
  where i.placeholder_id = ph;

  -- Every column with a foreign key to profiles, found in the catalog so tables added
  -- later follow too.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and cardinality(c.conkey) = 1
      and not (c.conrelid = 'public.placeholders'::regclass and a.attname = 'profile_id')
      and not (c.conrelid = 'public.group_invites'::regclass and a.attname = 'placeholder_id')
    order by c.conrelid::regclass::text, a.attname
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using acct, ph;
  end loop;

  -- Ids kept inside jsonb or arrays.
  update public.activity a
  set subject_id = case when a.subject_id = ph then acct else a.subject_id end,
      data = replace(a.data::text, needle, acct::text)::jsonb
  where a.group_id = gid and (a.subject_id = ph or strpos(a.data::text, needle) > 0);

  update public.notifications n
  set data = replace(n.data::text, needle, acct::text)::jsonb
  where n.data ->> 'group_id' = gid::text and strpos(n.data::text, needle) > 0;

  update public.groups g
  set default_split = replace(g.default_split::text, needle, acct::text)::jsonb
  where g.id = gid and strpos(coalesce(g.default_split::text, ''), needle) > 0;

  update public.recurring_expenses r
  set splits = replace(r.splits::text, needle, acct::text)::jsonb,
      payers = replace(r.payers::text, needle, acct::text)::jsonb
  where r.group_id = gid
    and (strpos(r.splits::text, needle) > 0 or strpos(coalesce(r.payers::text, ''), needle) > 0);

  update public.expense_items i
  set user_ids = array_replace(i.user_ids, ph, acct)
  where ph = any (i.user_ids);

  -- What joining would have done.
  insert into public.friendships (user_id, friend_id)
  select pair.a, pair.b
  from public.group_members m
  join public.profiles mp on mp.id = m.user_id and not mp.is_placeholder and mp.deleted_at is null
  cross join lateral (values (acct, m.user_id), (m.user_id, acct)) as pair (a, b)
  where m.group_id = gid
    and m.user_id <> acct
    and not private.has_block(acct, m.user_id)
  on conflict do nothing;

  delete from public.profiles p where p.id = ph and p.is_placeholder;

  perform set_config('potluck.claiming', '', true);

  perform private.log_activity(gid, acct, 'member.claimed', acct,
    jsonb_build_object('user_id', acct, 'name', ph_name));

  perform private.notify(
    array(
      select m.user_id from public.group_members m
      where m.group_id = gid and (m.role in ('owner', 'admin') or m.user_id = added_by)
    ),
    'member.joined',
    jsonb_build_object('group_id', gid, 'user_id', acct),
    acct
  );

  if announce then
    perform private.notify(
      array[acct],
      'member.added',
      jsonb_build_object('group_id', gid, 'role', 'member'),
      added_by
    );
  end if;

  return gid;
end;
$$;

revoke execute on function private.claim_placeholder(uuid, uuid, boolean) from public, anon, authenticated;

-- An account that verifies an email takes over the seats saved for that address.
create or replace function private.claim_placeholders_for_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.email is null or new.email_confirmed_at is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.email_confirmed_at is not null
     and old.email is not distinct from new.email then
    return null;
  end if;

  for r in
    select x.profile_id
    from public.placeholders x
    join public.group_members m on m.user_id = x.profile_id and m.group_id = x.group_id
    where x.email = lower(new.email)
    order by x.created_at, x.profile_id
  loop
    -- Signing up must never fail because of a seat; it stays claimable by link.
    begin
      perform private.claim_placeholder(r.profile_id, new.id, true);
    exception when others then
      raise warning 'placeholder % not claimed: %', r.profile_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke execute on function private.claim_placeholders_for_email() from public, anon, authenticated;

create trigger on_auth_user_verified
after insert or update of email, email_confirmed_at on auth.users
for each row execute function private.claim_placeholders_for_email();

-- RPCs -----------------------------------------------------------------------------

create or replace function private.placeholder_name(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(raw, ''));
begin
  if char_length(clean) not between 1 and 80 then
    raise exception using message = 'invalid_name', detail = 'A name needs 1 to 80 characters', errcode = '22023';
  end if;
  return clean;
end;
$$;

create or replace function private.placeholder_email(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := nullif(lower(btrim(coalesce(raw, ''))), '');
begin
  if clean is not null and (clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(clean) > 254) then
    raise exception using message = 'invalid_email', detail = 'That email address does not look right', errcode = '22023';
  end if;
  return clean;
end;
$$;

revoke execute on function private.placeholder_name(text) from public, anon, authenticated;
revoke execute on function private.placeholder_email(text) from public, anon, authenticated;

-- Who may add, edit or remind placeholders in a group: the same people who may invite.
create or replace function private.require_can_add_people(gid uuid)
returns public.group_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  my_role public.group_role := private.require_member(gid);
  g public.groups;
begin
  select * into g from public.groups x where x.id = gid;
  if g.is_direct then
    raise exception using message = 'direct_group', detail = 'Direct groups cannot have invites', errcode = '23514';
  end if;
  perform private.require_group_open(gid);
  if my_role = 'member' and not g.members_can_invite then
    raise exception using message = 'not_allowed', detail = 'Only admins can add people to this group', errcode = '42501';
  end if;
  return my_role;
end;
$$;

revoke execute on function private.require_can_add_people(uuid) from public, anon, authenticated;

-- At most 20 placeholders with an email per person per day: each one sends an email.
create or replace function private.require_invite_budget(uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.placeholders x
    where x.created_by = uid and x.invited_at > now() - interval '1 day'
  ) >= 20 then
    raise exception using message = 'too_many_invites', detail = 'That is a lot of invites for one day. Try again tomorrow', errcode = '23514';
  end if;
end;
$$;

revoke execute on function private.require_invite_budget(uuid) from public, anon, authenticated;

create or replace function public.add_placeholder_member(group_id uuid, display_name text, email text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid := add_placeholder_member.group_id;
  clean_name text := private.placeholder_name(add_placeholder_member.display_name);
  clean_email text := private.placeholder_email(add_placeholder_member.email);
  ph uuid := gen_random_uuid();
  group_currency char(3);
begin
  perform private.require_can_add_people(gid);

  if clean_email is not null then
    if exists (select 1 from public.placeholders x where x.group_id = gid and x.email = clean_email) then
      raise exception using message = 'placeholder_exists', detail = 'Someone with that email is already waiting to join', errcode = '23514';
    end if;
    perform private.require_invite_budget(uid);
  end if;

  select g.currency into group_currency from public.groups g where g.id = gid;

  insert into public.profiles (id, display_name, is_placeholder, default_currency)
  values (ph, clean_name, true, group_currency);

  insert into public.placeholders (profile_id, group_id, email, created_by, invited_at, invites_sent)
  values (
    ph, gid, clean_email, uid,
    case when clean_email is not null then now() end,
    case when clean_email is not null then 1 else 0 end
  );

  insert into public.group_invites (group_id, role, max_uses, email, created_by, placeholder_id)
  values (gid, 'member', 1, clean_email, uid, ph);

  -- Logs member.added and sends the invite email (group_members_notify_added).
  insert into public.group_members (group_id, user_id, role)
  values (gid, ph, 'member');

  return ph;
end;
$$;

revoke execute on function public.add_placeholder_member(uuid, text, text) from public, anon;
grant execute on function public.add_placeholder_member(uuid, text, text) to authenticated, service_role;

-- Renames a placeholder or changes where its invite goes. Null leaves a field as it is;
-- an empty email removes the address. A new address gets a fresh claim link and invite.
create or replace function public.update_placeholder(user_id uuid, display_name text default null, email text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ph public.placeholders;
  new_email text;
begin
  select * into ph from public.placeholders x where x.profile_id = update_placeholder.user_id;
  if ph.profile_id is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;
  if ph.created_by is distinct from uid then
    perform private.require_can_add_people(ph.group_id);
  else
    perform private.require_member(ph.group_id);
    perform private.require_group_open(ph.group_id);
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = ph.group_id and m.user_id = ph.profile_id) then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;

  if update_placeholder.display_name is not null then
    update public.profiles p
    set display_name = private.placeholder_name(update_placeholder.display_name)
    where p.id = ph.profile_id;
  end if;

  if update_placeholder.email is null then
    return;
  end if;
  new_email := private.placeholder_email(update_placeholder.email);
  if new_email is not distinct from ph.email then
    return;
  end if;

  if new_email is not null then
    if exists (
      select 1 from public.placeholders x
      where x.group_id = ph.group_id and x.email = new_email and x.profile_id <> ph.profile_id
    ) then
      raise exception using message = 'placeholder_exists', detail = 'Someone with that email is already waiting to join', errcode = '23514';
    end if;
    if ph.invites_sent >= 3 then
      raise exception using message = 'too_many_invites', detail = 'This invite has been sent enough times', errcode = '23514';
    end if;
    perform private.require_invite_budget(uid);
  end if;

  update public.group_invites i set revoked_at = coalesce(i.revoked_at, now())
  where i.placeholder_id = ph.profile_id;
  insert into public.group_invites (group_id, role, max_uses, email, created_by, placeholder_id)
  values (ph.group_id, 'member', 1, new_email, uid, ph.profile_id);

  update public.placeholders x
  set email = new_email,
      invited_at = case when new_email is not null then now() end,
      invites_sent = x.invites_sent + case when new_email is not null then 1 else 0 end,
      reminded_at = null
  where x.profile_id = ph.profile_id;

  if new_email is not null then
    perform private.notify(
      array[ph.profile_id],
      'member.added',
      jsonb_build_object('group_id', ph.group_id, 'role', 'member'),
      uid
    );
  end if;
end;
$$;

revoke execute on function public.update_placeholder(uuid, text, text) from public, anon;
grant execute on function public.update_placeholder(uuid, text, text) to authenticated, service_role;

-- The one reminder a placeholder's invite gets.
create or replace function public.remind_placeholder(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ph public.placeholders;
begin
  select * into ph from public.placeholders x where x.profile_id = remind_placeholder.user_id;
  if ph.profile_id is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;
  perform private.require_member(ph.group_id);
  perform private.require_group_open(ph.group_id);
  if not exists (select 1 from public.group_members m where m.group_id = ph.group_id and m.user_id = ph.profile_id) then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;
  if ph.email is null then
    raise exception using message = 'placeholder_no_email', detail = 'Add an email address to send an invite', errcode = '23514';
  end if;
  if ph.reminded_at is not null then
    raise exception using message = 'placeholder_already_reminded', detail = 'A reminder was already sent', errcode = '23514';
  end if;

  update public.placeholders x set reminded_at = now() where x.profile_id = ph.profile_id;

  perform private.notify(
    array[ph.profile_id],
    'member.added',
    jsonb_build_object('group_id', ph.group_id, 'role', 'member', 'reminder', true),
    uid
  );
end;
$$;

revoke execute on function public.remind_placeholder(uuid) from public, anon;
grant execute on function public.remind_placeholder(uuid) to authenticated, service_role;

-- Removes a placeholder whose balance is zero: admins, or whoever added them.
create or replace function public.remove_placeholder(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ph public.placeholders;
  my_role public.group_role;
begin
  select * into ph from public.placeholders x where x.profile_id = remove_placeholder.user_id;
  if ph.profile_id is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;

  perform 1 from public.groups g where g.id = ph.group_id for no key update;
  my_role := private.require_member(ph.group_id);
  perform private.require_group_open(ph.group_id);

  if not exists (select 1 from public.group_members m where m.group_id = ph.group_id and m.user_id = ph.profile_id) then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;
  if my_role = 'member' and ph.created_by is distinct from uid then
    raise exception using message = 'not_allowed', detail = 'Only admins or whoever added them can remove them', errcode = '42501';
  end if;
  if private.member_balance(ph.group_id, ph.profile_id) <> 0 then
    raise exception using message = 'member_has_balance', detail = 'This member still has an unsettled balance', errcode = '23514';
  end if;

  delete from public.group_members m
  where m.group_id = ph.group_id and m.user_id = ph.profile_id;
end;
$$;

revoke execute on function public.remove_placeholder(uuid) from public, anon;
grant execute on function public.remove_placeholder(uuid) to authenticated, service_role;

-- Body as in schema/current.sql plus: a claim link hands its placeholder over (verified
-- email required, archived groups included).
create or replace function public.accept_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  inv public.group_invites;
  my_email text;
  verified boolean;
begin
  select * into inv
  from public.group_invites i
  where i.code = accept_invite.code
  for update;

  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;

  if exists (select 1 from public.group_members m where m.group_id = inv.group_id and m.user_id = uid) then
    return inv.group_id;
  end if;

  if inv.revoked_at is not null then
    raise exception using message = 'invite_revoked', detail = 'This invite has been revoked', errcode = '23514';
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception using message = 'invite_expired', detail = 'This invite has expired', errcode = '23514';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception using message = 'invite_used_up', detail = 'This invite has been used up', errcode = '23514';
  end if;

  select lower(u.email), u.email_confirmed_at is not null into my_email, verified
  from auth.users u where u.id = uid;

  if inv.email is not null and my_email is distinct from inv.email then
    raise exception using message = 'invite_wrong_email', detail = 'This invite was sent to a different email address', errcode = '42501';
  end if;

  if inv.placeholder_id is not null then
    if not coalesce(verified, false) then
      raise exception using message = 'email_not_verified', detail = 'Confirm your email address first', errcode = '42501';
    end if;
    update public.group_invites i set uses = i.uses + 1 where i.id = inv.id;
    return private.claim_placeholder(inv.placeholder_id, uid, false);
  end if;

  if exists (select 1 from public.groups g where g.id = inv.group_id and g.archived_at is not null) then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;
  if private.blocked_in_group(inv.group_id, uid) then
    raise exception using message = 'blocked', detail = 'You cannot join this group', errcode = '42501';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (inv.group_id, uid, inv.role);

  update public.group_invites i set uses = i.uses + 1 where i.id = inv.id;

  return inv.group_id;
end;
$$;

-- invite_preview plus the saved seat a claim link hands over. A member opening a used
-- link sees it as valid, so the page offers to open the group.
create or replace function public.invite_preview_v2(code text)
returns table (
  group_id uuid,
  name text,
  emoji text,
  color text,
  cover_path text,
  member_count integer,
  first_names text[],
  status text,
  is_member boolean,
  placeholder_name text,
  email_hint text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  inv public.group_invites;
  uid uuid := auth.uid();
begin
  select * into inv from public.group_invites i where i.code = invite_preview_v2.code;

  if inv.id is null then
    raise exception using message = 'invite_not_found', detail = 'This invite link is not valid', errcode = 'PT404';
  end if;

  return query
  select
    g.id,
    g.name,
    g.emoji,
    g.color,
    g.cover_path,
    (
      select count(*)::int from public.group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = g.id and not p.is_placeholder
    ),
    array(
      select split_part(p.display_name, ' ', 1)
      from public.group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = g.id and p.deleted_at is null and not p.is_placeholder
      order by (m.role = 'owner') desc, m.joined_at, p.id
      limit 5
    ),
    case
      when x.is_member then 'valid'
      when inv.revoked_at is not null then 'revoked'
      when inv.expires_at is not null and inv.expires_at <= now() then 'expired'
      when inv.max_uses is not null and inv.uses >= inv.max_uses then 'used_up'
      when inv.placeholder_id is not null and not exists (
        select 1 from public.group_members m where m.group_id = g.id and m.user_id = inv.placeholder_id
      ) then 'revoked'
      when g.archived_at is not null and inv.placeholder_id is null then 'archived'
      when uid is not null and private.blocked_in_group(g.id, uid) then 'blocked'
      else 'valid'
    end,
    x.is_member,
    (select split_part(p.display_name, ' ', 1) from public.profiles p where p.id = inv.placeholder_id),
    (select ph.email_hint from public.placeholders ph where ph.profile_id = inv.placeholder_id)
  from public.groups g
  cross join lateral (
    select exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id = uid
    ) as is_member
  ) x
  where g.id = inv.group_id;
end;
$$;

revoke execute on function public.invite_preview_v2(text) from public;
grant execute on function public.invite_preview_v2(text) to anon, authenticated, service_role;

-- Body as in schema/current.sql plus: placeholders cannot take over, so they do not count
-- as someone left behind.
create or replace function public.leave_group(group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role;
  uid uuid := auth.uid();
  others_active int;
begin
  perform 1 from public.groups g where g.id = leave_group.group_id for no key update;
  my_role := private.require_member(leave_group.group_id);

  select count(*) into others_active
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = leave_group.group_id and m.user_id <> uid and p.deleted_at is null
    and not p.is_placeholder;

  if my_role = 'owner' and others_active = 0 then
    if exists (
      select 1 from public.group_balances b
      join public.profiles p on p.id = b.user_id
      where b.group_id = leave_group.group_id
        and b.user_id <> uid
        and p.deleted_at is null
        and b.net_cents <> 0
    ) then
      raise exception using message = 'member_has_balance', detail = 'Someone here still has an unsettled balance', errcode = '23514';
    end if;
    -- Whatever is left is between the owner and closed accounts, which nobody
    -- can settle anymore; the delete guard allows this like closing an account.
    perform set_config('potluck.closing_account', 'on', true);
    delete from public.groups g where g.id = leave_group.group_id;
    perform set_config('potluck.closing_account', '', true);
    return;
  end if;

  if private.member_balance(leave_group.group_id, uid) <> 0 then
    raise exception using message = 'member_has_balance', detail = 'Settle up before leaving this group', errcode = '23514';
  end if;

  if my_role = 'owner' then
    raise exception using message = 'owner_must_transfer', detail = 'Transfer ownership before leaving', errcode = '23514';
  end if;

  delete from public.group_members m
  where m.group_id = leave_group.group_id and m.user_id = uid;
end;
$$;

-- Body as in schema/current.sql plus: a placeholder never inherits a group.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owned record;
  heir uuid;
begin
  if uid is null then
    raise exception using message = 'not_authenticated', detail = 'You need to be signed in', errcode = '42501';
  end if;

  if exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is not null) then
    return;
  end if;

  perform 1 from public.groups g
  where g.id in (select m.group_id from public.group_members m where m.user_id = uid)
  order by g.id
  for no key update;

  for owned in
    select m.group_id from public.group_members m where m.user_id = uid and m.role = 'owner'
  loop
    select m.user_id into heir
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = owned.group_id and m.user_id <> uid and p.deleted_at is null
      and not p.is_placeholder
    order by (m.role = 'admin') desc, m.joined_at, m.user_id
    limit 1;

    if heir is null then
      perform set_config('potluck.closing_account', 'on', true);
      delete from public.groups g where g.id = owned.group_id;
      perform set_config('potluck.closing_account', '', true);
    else
      update public.group_members m set role = 'member'
      where m.group_id = owned.group_id and m.user_id = uid;
      update public.group_members m set role = 'owner'
      where m.group_id = owned.group_id and m.user_id = heir;
    end if;
  end loop;

  update public.recurring_expenses r set active = false
  where r.active
    and private.group_is_open(r.group_id)
    and (r.paid_by = uid or r.splits @> jsonb_build_array(jsonb_build_object('user_id', uid)));

  delete from public.group_members m
  where m.user_id = uid
    and private.member_balance(m.group_id, uid) = 0;

  delete from public.push_tokens t where t.user_id = uid;
  delete from public.calendar_connections c where c.user_id = uid;
  delete from public.busy_blocks b where b.user_id = uid;
  delete from public.notifications n where n.user_id = uid;
  delete from public.availability a where a.user_id = uid;
  delete from public.availability_requests r where r.user_id = uid;
  delete from public.event_rsvps r where r.user_id = uid;
  delete from public.friendships f where f.user_id = uid or f.friend_id = uid;
  delete from public.blocks b where b.blocker_id = uid or b.blocked_id = uid;

  update public.group_invites i set revoked_at = now()
  where i.created_by = uid and i.revoked_at is null;

  update public.profiles p set
    display_name = 'Former member',
    avatar_path = null,
    timezone = 'UTC',
    locale = 'en',
    deleted_at = now()
  where p.id = uid;
end;
$$;

-- Body as in schema/current.sql plus: placeholders cannot answer, so they are never asked.
create or replace function public.request_availability(event_id uuid, user_ids uuid[] default null::uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ev public.events := private.member_event(request_availability.event_id);
  targets uuid[];
begin
  perform private.require_group_open(ev.group_id);
  if ev.status <> 'polling' then
    raise exception using message = 'event_not_polling', detail = 'This event is no longer collecting availability', errcode = '23514';
  end if;

  if user_ids is null or cardinality(user_ids) = 0 then
    select coalesce(array_agg(m.user_id order by m.user_id), '{}') into targets
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = ev.group_id
      and m.user_id <> uid
      and p.deleted_at is null
      and not p.is_placeholder
      and not exists (select 1 from public.availability a where a.event_id = ev.id and a.user_id = m.user_id);
  else
    if exists (
      select 1 from unnest(user_ids) as t (id)
      where not exists (select 1 from public.group_members m where m.group_id = ev.group_id and m.user_id = t.id)
    ) then
      raise exception using message = 'member_not_found', detail = 'Everyone asked must be in the group', errcode = 'PT404';
    end if;
    select coalesce(array_agg(distinct t.id), '{}') into targets
    from unnest(user_ids) as t (id)
    join public.profiles p on p.id = t.id
    where t.id <> uid
      and p.deleted_at is null
      and not p.is_placeholder;
  end if;

  insert into public.availability_requests (event_id, user_id, requested_by, requested_at, responded_at)
  select ev.id, t.id, uid, now(), null
  from unnest(targets) as t (id)
  on conflict (event_id, user_id) do update
    set requested_by = excluded.requested_by,
        requested_at = excluded.requested_at,
        responded_at = null;

  insert into public.notifications (user_id, type, data)
  select t.id, 'availability.requested', jsonb_build_object(
    'event_id', ev.id,
    'group_id', ev.group_id,
    'event_title', ev.title,
    'actor_id', uid
  )
  from unnest(targets) as t (id);

  if cardinality(targets) > 0 then
    perform private.log_activity(ev.group_id, uid, 'availability.requested', ev.id,
      jsonb_build_object('title', ev.title, 'user_ids', to_jsonb(targets)));
  end if;

  return cardinality(targets);
end;
$$;

-- Body as in schema/current.sql plus: placeholders never paint times, so they are not
-- counted as missing.
create or replace function public.best_slots(event_id uuid, "limit" integer default 5)
returns table (starts_at timestamptz, ends_at timestamptz, yes_count integer, maybe_count integer, score numeric, missing uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $_$
#variable_conflict use_column
declare
  ev public.events := private.member_event($1);
  cells int := ceil(ev.duration_minutes::numeric / ev.slot_minutes)::int;
  max_rows int := least(greatest(coalesce($2, 5), 0), 100);
begin
  return query
  with members as (
    select m.user_id from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = ev.group_id and not p.is_placeholder
  ),
  candidates as (
    select distinct a.slot_start as slot
    from public.availability a
    join members mb on mb.user_id = a.user_id
    where a.event_id = ev.id
  ),
  per_person as (
    select
      c.slot,
      mb.user_id,
      count(a.slot_start) as covered,
      coalesce(bool_and(a.level = 'yes'), false) as all_yes
    from candidates c
    cross join members mb
    cross join generate_series(0, cells - 1) as k (i)
    left join public.availability a
      on a.event_id = ev.id
     and a.user_id = mb.user_id
     and a.slot_start = c.slot + make_interval(mins => k.i * ev.slot_minutes)
    group by c.slot, mb.user_id
  ),
  scored as (
    select
      p.slot,
      (count(*) filter (where p.covered = cells and p.all_yes))::int as yes_n,
      (count(*) filter (where p.covered = cells and not p.all_yes))::int as maybe_n,
      coalesce(array_agg(p.user_id order by p.user_id) filter (where p.covered < cells), '{}') as missing_ids
    from per_person p
    group by p.slot
  )
  select
    s.slot,
    s.slot + make_interval(mins => ev.duration_minutes),
    s.yes_n,
    s.maybe_n,
    (s.yes_n + 0.5 * s.maybe_n)::numeric,
    s.missing_ids
  from scored s
  where s.yes_n + s.maybe_n >= ev.min_attendees
  order by (s.yes_n + 0.5 * s.maybe_n) desc, s.slot asc
  limit max_rows;
end;
$_$;
