-- Deleted groups, the rest of the way (ADR 20). 20261113213126 hid a deleted group from
-- my_group_ids and the member helpers; these paths joined group_members on their own:
--
-- 1. private.my_event_ids and private.can_manage_event (event, RSVP and availability policies,
--    and so realtime) leave deleted groups out. Bodies as in 20261105071444_policy_helpers.sql
--    plus the deleted_at test.
-- 2. public.my_timeline leaves out plans of deleted groups. Body as in
--    20261106010000_integrity_fixes.sql plus `g.deleted_at is null`.
-- 3. private.monthly_summary leaves out deleted groups. Body as in
--    20261113062656_notification_prefs_and_email.sql plus `g.deleted_at is null`.
-- 4. delete_group refuses one-on-one tabs (direct_group_not_deletable), as Splitwise does:
--    get_or_create_direct_group would otherwise keep handing back a group nobody can see. It
--    now also tells the other members (group.deleted, data keyed deleted_group_id so the
--    notification is not dropped like other news about a deleted group) and restore_group
--    tells them it is back (group.restored), and only within 30 days of the delete. Bodies as
--    in 20261113213126 plus those.
-- 5. Members keep reading the group.deleted line of a deleted group's activity, so the feed
--    says what happened (private.my_deleted_group_ids, one more select policy).
-- 6. groups.cover_path is exactly `<group id>/<one file name>`; stored paths that are not are cleared.
-- 7. Debts in a circle: with simplify off every net can be zero while people still owe each other.
--    delete_group and private.guard_group_delete also refuse while private.group_debts (what the
--    balances tab shows) has rows; friend_balances and settle_with_friend skip deleted groups
--    (bodies as in 20261113115301_group_debts_and_bulk_settle.sql plus `deleted_at is null`), and
--    no payment can land in a deleted group (require_live_group on settlements).
-- 8. Guest links close with the group: delete_group revokes them with the delete timestamp and
--    restore_group reopens exactly those (guest_link_preview then says revoked, and guests cannot
--    answer). export_my_data leaves deleted groups out: body as in
--    20261113204239_export_and_import.sql plus `g.deleted_at is null`. import_expenses already
--    refuses through require_member (group_deleted).

-- 1. Event helpers -----------------------------------------------------------------------------

create or replace function private.my_event_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.events e
  join public.group_members m on m.group_id = e.group_id
  join public.groups g on g.id = e.group_id
  where m.user_id = (select auth.uid()) and g.deleted_at is null;
$$;

create or replace function private.can_manage_event(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.events e
    join public.group_members m on m.group_id = e.group_id and m.user_id = (select auth.uid())
    join public.groups g on g.id = e.group_id
    where e.id = eid
      and g.deleted_at is null
      and (m.role in ('owner', 'admin') or e.created_by = m.user_id)
  );
$$;

-- 2. Timeline ----------------------------------------------------------------------------------

create or replace function public.my_timeline(
  "from" timestamptz default now(),
  "to" timestamptz default now() + interval '60 days'
)
returns table (
  event_id uuid, group_id uuid, group_name text, group_emoji text, group_color text,
  title text, emoji text, location text, status public.event_status, timezone text,
  starts_at timestamptz, ends_at timestamptz, window_start date, window_end date,
  rsvp_deadline timestamptz, my_rsvp public.rsvp_status, going_count integer,
  availability_requested boolean, availability_submitted boolean
)
language plpgsql stable security definer set search_path = '' as $_$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  range_from timestamptz := coalesce($1, now());
  range_to timestamptz := coalesce($2, now() + interval '60 days');
begin
  return query
  select
    e.id,
    g.id,
    g.name,
    g.emoji,
    g.color,
    e.title,
    e.emoji,
    e.location,
    e.status,
    e.timezone,
    e.starts_at,
    e.ends_at,
    e.window_start,
    e.window_end,
    e.rsvp_deadline,
    r.status,
    (select count(*)::int from public.event_rsvps x where x.event_id = e.id and x.status = 'going'),
    exists (
      select 1 from public.availability_requests q
      where q.event_id = e.id and q.user_id = uid and q.responded_at is null
    ),
    exists (select 1 from public.availability a where a.event_id = e.id and a.user_id = uid)
  from public.events e
  join public.group_members m on m.group_id = e.group_id and m.user_id = uid
  join public.groups g on g.id = e.group_id
  left join public.event_rsvps r on r.event_id = e.id and r.user_id = uid
  where g.deleted_at is null
    and (
      (e.status = 'scheduled' and e.starts_at < range_to and coalesce(e.ends_at, e.starts_at) >= range_from)
      or (
        e.status = 'polling'
        and e.window_end >= (range_from at time zone e.timezone)::date
        and e.window_start <= (range_to at time zone e.timezone)::date
      )
    )
  order by coalesce(e.starts_at, (e.window_start::timestamp at time zone e.timezone)), e.id;
end;
$_$;

-- 3. Monthly summary ---------------------------------------------------------------------------

create or replace function private.monthly_summary(uid uuid, month date) returns jsonb
language sql stable security definer set search_path = '' as $$
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
         ) or exists (
           select 1 from public.expense_payers x where x.expense_id = e.id and x.user_id = uid
         )))::int as expenses,
      (select count(*) from public.settlements s, bounds
       where s.group_id = g.id and s.deleted_at is null
         and s.created_at >= bounds.starts and s.created_at < bounds.ends
         and uid in (s.from_user, s.to_user))::int as payments
    from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.user_id = uid and g.deleted_at is null
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

-- 4. Delete and restore ------------------------------------------------------------------------

insert into private.notification_types (type, category) values
  ('group.deleted', 'groups'),
  ('group.restored', 'groups')
on conflict (type) do nothing;

create or replace function public.delete_group(group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(delete_group.group_id);
  uid uuid := auth.uid();
  stamp timestamptz := now();
  g public.groups;
begin
  if my_role <> 'owner' then
    raise exception using message = 'not_allowed', detail = 'Only the owner can delete the group', errcode = '42501';
  end if;
  select * into g from public.groups x where x.id = delete_group.group_id for update;
  if g.is_direct then
    raise exception using
      message = 'direct_group_not_deletable',
      detail = 'A one-on-one tab cannot be deleted',
      errcode = '23514';
  end if;
  if exists (
    select 1 from public.group_balances b
    where b.group_id = delete_group.group_id and b.net_cents <> 0
  ) or exists (select 1 from private.group_debts(delete_group.group_id)) then
    raise exception using
      message = 'group_has_balances',
      detail = 'Settle every balance before deleting this group',
      errcode = '23514';
  end if;

  update public.groups x set deleted_at = stamp, deleted_by = uid where x.id = delete_group.group_id;
  update public.group_invites i set revoked_at = stamp
  where i.group_id = delete_group.group_id and i.revoked_at is null;
  update public.event_guest_links l set revoked_at = stamp
  where l.group_id = delete_group.group_id and l.revoked_at is null;
  perform private.log_activity(delete_group.group_id, uid, 'group.deleted', delete_group.group_id,
    jsonb_build_object('name', g.name));
  perform private.notify(
    array(select m.user_id from public.group_members m where m.group_id = delete_group.group_id),
    'group.deleted',
    jsonb_build_object('deleted_group_id', g.id, 'group_name', g.name, 'emoji', g.emoji),
    uid
  );
end;
$$;

create or replace function public.restore_group(group_id uuid) returns public.groups
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  g public.groups;
begin
  select * into g from public.groups x where x.id = restore_group.group_id for update;
  if g.id is null then
    raise exception using message = 'group_not_found', detail = 'This group is gone for good', errcode = 'PT404';
  end if;
  if not exists (
    select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid
  ) then
    raise exception using message = 'not_a_member', detail = 'You are not a member of this group', errcode = '42501';
  end if;
  if g.deleted_at is null then
    return g;
  end if;
  if g.deleted_at <= now() - interval '30 days' then
    raise exception using message = 'group_not_found', detail = 'This group is gone for good', errcode = 'PT404';
  end if;

  update public.group_invites i set revoked_at = null
  where i.group_id = g.id and i.revoked_at = g.deleted_at;
  update public.event_guest_links l set revoked_at = null
  where l.group_id = g.id and l.revoked_at = g.deleted_at;
  update public.groups x set deleted_at = null, deleted_by = null
  where x.id = g.id
  returning * into g;
  perform private.log_activity(g.id, uid, 'group.restored', g.id, jsonb_build_object('name', g.name));
  perform private.notify(
    array(select m.user_id from public.group_members m where m.group_id = g.id),
    'group.restored',
    jsonb_build_object('group_id', g.id, 'group_name', g.name),
    uid
  );
  return g;
end;
$$;

-- 5. The delete stays in the feed ---------------------------------------------------------------

create or replace function private.my_deleted_group_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.group_id
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = (select auth.uid()) and g.deleted_at is not null;
$$;

revoke execute on function private.my_deleted_group_ids() from public;
grant execute on function private.my_deleted_group_ids() to authenticated, service_role;

create policy "activity: members read a deleted group's delete" on public.activity
  for select to authenticated
  using (verb = 'group.deleted' and group_id = any (array(select private.my_deleted_group_ids())));

-- 6. Covers live under their group --------------------------------------------------------------

alter table public.groups disable trigger groups_activity;
update public.groups g set cover_path = null
where g.cover_path is not null
  and not (g.cover_path ~ ('^' || g.id::text || '/[^/]+$') and position('..' in g.cover_path) = 0);
alter table public.groups enable trigger groups_activity;

alter table public.groups
  add constraint groups_cover_path_check
    check (
      cover_path is null
      or (cover_path ~ ('^' || id::text || '/[^/]+$') and position('..' in cover_path) = 0)
    );

-- 7. Debts in a circle -------------------------------------------------------------------------

-- Body as in 20261106000000_review_fixes.sql plus the pairwise check. Debts are read without
-- the caller (the purge job has none): with simplify on, zero nets mean nothing is owed; with it
-- off, private.pairwise_debts is what the balances tab shows.
create or replace function private.guard_group_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('potluck.closing_account', true) is distinct from 'on'
     and (
       exists (
         select 1 from public.group_balances b
         where b.group_id = old.id and b.net_cents <> 0
       )
       or (not old.simplify_debts and exists (select 1 from private.pairwise_debts(old.id)))
     ) then
    raise exception using
      message = 'group_has_balances',
      detail = 'Settle every balance before deleting this group',
      errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger settlements_require_live_group
before insert on public.settlements
for each row execute function private.require_live_group();

create or replace function public.friend_balances()
returns table (friend_id uuid, group_id uuid, currency text, net_cents bigint, archived boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  g record;
begin
  for g in
    select x.id, x.currency, x.archived_at
    from public.groups x
    join public.group_members m on m.group_id = x.id and m.user_id = uid
    where x.deleted_at is null
    order by x.id
  loop
    return query
      select
        case when d.from_user = uid then d.to_user else d.from_user end,
        g.id,
        g.currency::text,
        case when d.from_user = uid then -d.amount_cents else d.amount_cents end,
        g.archived_at is not null
      from private.group_debts(g.id) d
      where uid in (d.from_user, d.to_user)
        and exists (
          select 1 from public.group_members f
          where f.group_id = g.id
            and f.user_id = case when d.from_user = uid then d.to_user else d.from_user end
        );
  end loop;
end;
$$;

revoke execute on function public.friend_balances() from public, anon;
grant execute on function public.friend_balances() to authenticated, service_role;

-- settle_with_friend ----------------------------------------------------------------------------------

-- `amounts`: null settles everything between the two in every shared open group. Otherwise an
-- object of group id to amount (minor units, group currency): only those groups, each with that
-- amount, which must be more than zero and no more than what is owed there (partial payments).
create or replace function public.settle_with_friend(
  friend_id uuid,
  settled_on date default null,
  note text default null,
  amounts jsonb default null
) returns setof public.settlements
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  v_note text := private.payment_note(settle_with_friend.note);
  v_at timestamptz := private.payment_time(settle_with_friend.settled_on);
  picked jsonb := settle_with_friend.amounts;
  gids uuid[];
  gid uuid;
  cur text;
  d record;
  amt bigint;
  matched int := 0;
  paid public.settlements;
begin
  if settle_with_friend.friend_id is null or settle_with_friend.friend_id = uid then
    raise exception using message = 'invalid_parties', detail = 'A payment needs two different people', errcode = '22023';
  end if;
  if picked is not null and (jsonb_typeof(picked) <> 'object' or picked = '{}'::jsonb) then
    raise exception using message = 'invalid_payload', detail = 'Pick at least one group', errcode = '22023';
  end if;

  select coalesce(array_agg(mine.group_id order by mine.group_id), '{}') into gids
  from public.group_members mine
  join public.group_members theirs
    on theirs.group_id = mine.group_id and theirs.user_id = settle_with_friend.friend_id
  join public.groups g on g.id = mine.group_id
  where mine.user_id = uid and g.deleted_at is null;

  -- Lock order: every group row, in id order, before reading any balance.
  foreach gid in array gids loop
    perform 1 from public.groups g where g.id = gid for no key update;
  end loop;

  foreach gid in array gids loop
    continue when picked is not null and not (picked ? gid::text);
    select g.currency into cur from public.groups g
    where g.id = gid and g.archived_at is null and g.deleted_at is null;
    -- Archived groups are read only; a member may have left before the lock.
    continue when cur is null;
    continue when (
      select count(*) from public.group_members m
      where m.group_id = gid and m.user_id in (uid, settle_with_friend.friend_id)
    ) <> 2;

    for d in
      select x.from_user, x.to_user, x.amount_cents from private.group_debts(gid) x
      where (x.from_user = uid and x.to_user = settle_with_friend.friend_id)
         or (x.from_user = settle_with_friend.friend_id and x.to_user = uid)
    loop
      amt := d.amount_cents;
      if picked is not null then
        begin
          amt := (picked ->> gid::text)::bigint;
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            raise exception using message = 'invalid_payload', detail = 'The amounts are not valid', errcode = '22023';
        end;
        if amt is null or amt <= 0 or amt > d.amount_cents then
          raise exception using message = 'invalid_amount', detail = 'Pay more than zero and no more than is owed', errcode = '22023';
        end if;
        matched := matched + 1;
      end if;
      insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
      values (gid, d.from_user, d.to_user, amt, cur, 1, v_note, v_at, uid)
      returning * into paid;
      return next paid;
    end loop;
  end loop;

  -- A picked group that is not shared, is archived, or has nothing owed any more.
  if picked is not null and matched <> (select count(*) from jsonb_object_keys(picked)) then
    raise exception using message = 'nothing_owed', detail = 'Nothing is owed in one of those groups any more', errcode = '23514';
  end if;
end;
$$;

revoke execute on function public.settle_with_friend(uuid, date, text, jsonb) from public, anon;

-- 8. Guest links and exports -----------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  gids uuid[];
  v_groups jsonb;
begin
  select coalesce(array_agg(m.group_id), '{}') into gids
  from public.group_members m where m.user_id = uid;
  select coalesce(jsonb_agg(private.export_group(g.id) order by g.created_at, g.id), '[]'::jsonb)
    into v_groups
  from public.groups g where g.id = any (gids) and g.deleted_at is null;

  return jsonb_build_object(
    'format', 'potluck-backup',
    'version', 1,
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'email', (select u.email from auth.users u where u.id = p.id),
        'avatar_path', p.avatar_path,
        'timezone', p.timezone,
        'default_currency', p.default_currency,
        'locale', p.locale,
        'created_at', p.created_at
      )
      from public.profiles p where p.id = uid
    ),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object('kind', pm.kind, 'handle', pm.handle, 'updated_at', pm.updated_at)
                       order by pm.kind)
      from public.payment_methods pm where pm.user_id = uid
    ), '[]'::jsonb),
    -- Everyone the file mentions, so names survive people leaving or closing their account.
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name,
                         'deleted', p.deleted_at is not null,
                         'placeholder', p.is_placeholder) order by p.id)
      from public.profiles p
      where p.id in (
        select (v #>> '{}')::uuid
        from unnest(array[
          '$[*].created_by', '$[*].members[*].user_id',
          '$[*].expenses[*].created_by', '$[*].expenses[*].payers[*].user_id',
          '$[*].expenses[*].splits[*].user_id', '$[*].expenses[*].items[*].user_ids[*]',
          '$[*].expenses[*].comments[*].author_id',
          '$[*].payments[*].from_user', '$[*].payments[*].to_user', '$[*].payments[*].created_by',
          '$[*].payments[*].comments[*].author_id',
          '$[*].recurring[*].created_by', '$[*].recurring[*].paid_by',
          '$[*].recurring[*].payers[*].user_id', '$[*].recurring[*].splits[*].user_id',
          '$[*].recurring[*].items[*].user_ids[*]',
          '$[*].plans[*].created_by', '$[*].plans[*].rsvps[*].user_id',
          '$[*].plans[*].availability[*].user_id', '$[*].plans[*].comments[*].author_id'
        ]::jsonpath[]) k (path),
             jsonb_path_query(v_groups, k.path) v
        -- Templates keep their payers, splits and items as sent: only real ids count.
        where jsonb_typeof(v) = 'string' and pg_input_is_valid(v #>> '{}', 'uuid')
        union select f.friend_id from public.friendships f where f.user_id = uid
        union select uid
      )
    ), '[]'::jsonb),
    'friends', coalesce((
      select jsonb_agg(f.friend_id order by f.friend_id)
      from public.friendships f where f.user_id = uid
    ), '[]'::jsonb),
    'groups', v_groups
  );
end;
$$;
