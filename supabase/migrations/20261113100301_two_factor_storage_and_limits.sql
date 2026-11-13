-- Two-step sign in, continued (ADR 13):
--
-- 1. Storage: a session that still owes its two-step code reads, uploads, replaces and deletes
--    nothing in any bucket. One restrictive policy on storage.objects sits on top of every
--    bucket's own policies (avatars, group-covers, receipts, and any bucket added later).
-- 2. Recovery attempts: the mfa-recover edge function records each try and stops after five in
--    fifteen minutes per account.
-- 3. Turning two-step sign in off clears the recovery codes: clear_mfa_recovery_codes().
-- 4. A recovery tells the account: Supabase sends no "factor removed" email when the admin API
--    removes a factor, so mfa-recover files an account.mfa_removed notification (inbox, push,
--    and email once email is on) through notify_mfa_recovered().
-- 5. Its `security` category is required: no setting, no unsubscribe link, stored settings
--    ignored. Redefines notification_channels, my_notification_prefs, set_notification_pref and
--    email_unsubscribe (bodies as in 20261113062656_notification_prefs_and_email.sql plus the
--    `required` checks); set_notification_pref raises notification_setting_required.

-- Storage -----------------------------------------------------------------------------------

create policy "two-step sign in done"
on storage.objects
as restrictive
for all
to authenticated
using ((select private.mfa_satisfied()))
with check ((select private.mfa_satisfied()));

-- Recovery attempts -------------------------------------------------------------------------

create table private.mfa_recover_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index mfa_recover_attempts_user_time_idx
  on private.mfa_recover_attempts (user_id, attempted_at);

comment on table private.mfa_recover_attempts is
  'One row per recovery code tried, kept a day, for the five per fifteen minutes limit.';

revoke all on table private.mfa_recover_attempts from public, anon, authenticated;

-- Service role only (mfa-recover): may `target` try a recovery code now? Records the try when
-- it may. Tries are serialized per account, so parallel requests cannot slip past the limit.
create or replace function public.record_mfa_recover_attempt(target uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('mfa_recover:' || target::text, 0));
  delete from private.mfa_recover_attempts a
  where a.user_id = target and a.attempted_at < now() - interval '1 day';
  select count(*) into recent from private.mfa_recover_attempts a
  where a.user_id = target and a.attempted_at > now() - interval '15 minutes';
  if recent >= 5 then
    return false;
  end if;
  insert into private.mfa_recover_attempts (user_id) values (target);
  return true;
end;
$$;

revoke execute on function public.record_mfa_recover_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.record_mfa_recover_attempt(uuid) to service_role;

-- Clearing codes ----------------------------------------------------------------------------

-- Drops the caller's recovery codes once no verified factor is left (after turning two-step
-- sign in off). While one is on, it changes nothing. Returns how many codes went.
create or replace function public.clear_mfa_recovery_codes() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  removed int;
begin
  if exists (
    select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified'
  ) then
    return 0;
  end if;
  delete from private.mfa_recovery_codes r where r.user_id = uid;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.clear_mfa_recovery_codes() from public, anon;
grant execute on function public.clear_mfa_recovery_codes() to authenticated, service_role;

-- Security notices ---------------------------------------------------------------------------

-- A required category cannot be switched off: not on Me, not by set_notification_pref, not by an
-- unsubscribe link, and any stored setting for it is ignored. Its defaults always hold.
alter table private.notification_categories
  add column required boolean not null default false;

comment on column private.notification_categories.required is
  'Always delivered with its defaults (security notices): no setting, no unsubscribe link.';

insert into private.notification_categories
  (category, position, push_default, email_default, push_allowed, email_allowed, required)
values ('security', 90, true, true, true, true, true)
on conflict (category) do nothing;

insert into private.notification_types (type, category)
values ('account.mfa_removed', 'security')
on conflict (type) do nothing;

-- Service role only (mfa-recover): tells the person a recovery code turned two-step sign in off.
create or replace function public.notify_mfa_recovered(target uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.notify(array[target], 'account.mfa_removed', '{}'::jsonb, null);
end;
$$;

revoke execute on function public.notify_mfa_recovered(uuid) from public, anon, authenticated;
grant execute on function public.notify_mfa_recovered(uuid) to service_role;

-- Required categories in the settings functions -----------------------------------------------
-- Bodies as in 20261113062656_notification_prefs_and_email.sql, plus the `required` checks.

-- Where a notification of this type goes for this person, besides the inbox. A required
-- category ignores stored settings.
create or replace function private.notification_channels(uid uuid, kind text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case
      when c.category is null
        or (c.push_allowed and coalesce(case when c.required then null else p.push end, c.push_default))
      then 'push'
    end,
    case
      when c.email_allowed
        and coalesce(case when c.required then null else p.email end, c.email_default)
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

-- Required categories have no setting to show.
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
  where not c.required
  order by c.position;
end;
$$;

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
  if exists (
    select 1 from private.notification_categories c
    where c.category = set_notification_pref.category and c.required
  ) then
    raise exception using message = 'notification_setting_required', detail = 'Security notices cannot be turned off', errcode = '23514';
  end if;

  insert into public.notification_prefs as p (user_id, category, push, email)
  values (uid, set_notification_pref.category, set_notification_pref.push, set_notification_pref.email)
  on conflict (user_id, category) do update
    set push = coalesce(excluded.push, p.push),
        email = coalesce(excluded.email, p.email);

  -- An email setting changed by hand makes any unsubscribe snapshot stale.
  if set_notification_pref.email is not null then
    delete from private.email_unsubscribe_undo u where u.user_id = uid;
  end if;
end;
$$;

-- Required categories have no unsubscribe link of their own, and an "all" link leaves them on.
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
  restored boolean := false;
begin
  if cardinality(parts) = 3 then
    uid := private.try_uuid(parts[1]);
    cat := parts[2];
  end if;

  if uid is null
     or not (cat = 'all' or exists (
       select 1 from private.notification_categories c
       where c.category = cat and c.email_allowed and not c.required
     ))
     or token is distinct from private.unsubscribe_token(uid, cat) then
    raise exception using message = 'invalid_unsubscribe_link', detail = 'This unsubscribe link is not valid', errcode = '22023';
  end if;
  if action is null or action not in ('preview', 'unsubscribe', 'undo') then
    raise exception using message = 'invalid_payload', detail = 'action must be preview, unsubscribe or undo', errcode = '22023';
  end if;

  select array_agg(c.category order by c.position) into cats
  from private.notification_categories c
  where c.email_allowed and not c.required and (cat = 'all' or c.category = cat);

  active := exists (select 1 from public.profiles p where p.id = uid and p.deleted_at is null);

  if active and action = 'unsubscribe' then
    -- Only the first click is remembered: a second one would snapshot "all off".
    insert into private.email_unsubscribe_undo (user_id, scope, prior)
    select uid, cat, jsonb_object_agg(s.c, p.email)
    from unnest(cats) as s (c)
    join private.notification_categories c on c.category = s.c
    left join public.notification_prefs p on p.user_id = uid and p.category = s.c
    having bool_or(coalesce(p.email, c.email_default))
    on conflict (user_id, scope) do nothing;

    insert into public.notification_prefs as p (user_id, category, email)
    select uid, s.c, false from unnest(cats) as s (c)
    on conflict (user_id, category) do update set email = false;
  elsif active and action = 'undo' then
    delete from private.email_unsubscribe_undo u
    where u.user_id = uid and u.scope = cat
    returning u.prior into saved;

    -- With the snapshot: exactly what it held. Without one (already undone, or the
    -- person changed settings since): a one-category link turns that email on; an
    -- 'all' link changes nothing, since there is nothing to put back.
    if saved is not null or cat <> 'all' then
      insert into public.notification_prefs as p (user_id, category, email)
      select uid, s.c, case when saved is not null then (saved ->> s.c)::boolean else true end
      from unnest(cats) as s (c)
      on conflict (user_id, category) do update set email = excluded.email;
      restored := true;
    end if;
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
    'subscribed', active and coalesce(subscribed, false),
    'restored', restored
  );
end;
$$;
