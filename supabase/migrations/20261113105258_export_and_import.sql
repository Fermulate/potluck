-- Export, backup and import (ADR 13).
--
-- import_expenses(group_id, rows, source): writes a whole file of expenses and payments into one
-- group in one transaction. Expenses go through private.save_expense, the path create_expense_v2
-- takes, so every check it makes (members, payers, departed people, sums, rates) holds for
-- imports too. Payments are written like settle_up writes them, but between any two members and
-- on the day the file gives. If any row fails nothing is written, and the error carries the row
-- number in its hint (`import_row:<n>`, counting from 1).
--
-- While an import runs, `potluck.importing` holds the group id for the rest of the transaction.
-- Two new before insert triggers drop the per row activity and notifications it would cause
-- (also the expense notifications the deferred trigger writes at commit), so the group gets
-- one `expenses.imported` activity entry instead of hundreds of lines and pushes.
--
-- export_my_data(): the viewer's whole account as one JSON document (format `potluck-backup`,
-- version 1, documented in docs/backup-format.md). Rates are decimal text, like every read.

-- Holding back per row side effects -----------------------------------------------------------

create or replace function private.hold_import_activity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.group_id::text = current_setting('potluck.importing', true)
     and new.verb <> 'expenses.imported' then
    return null;
  end if;
  return new;
end;
$$;

create or replace function private.hold_import_notifications() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.data ->> 'group_id' = current_setting('potluck.importing', true) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function private.hold_import_activity() from public, anon, authenticated;
revoke execute on function private.hold_import_notifications() from public, anon, authenticated;

create trigger activity_hold_during_import
  before insert on public.activity
  for each row execute function private.hold_import_activity();

create trigger notifications_hold_during_import
  before insert on public.notifications
  for each row execute function private.hold_import_notifications();

-- Import -------------------------------------------------------------------------------------

create or replace function public.import_expenses(group_id uuid, rows jsonb, source text default 'csv')
returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid := import_expenses.group_id;
  v_source text := lower(coalesce(nullif(btrim(import_expenses.source), ''), 'csv'));
  g public.groups;
  r jsonb;
  i int := 0;
  n_expenses int := 0;
  n_payments int := 0;
  v_kind text;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_currency text;
  v_day date;
  v_fx numeric;
  err_message text;
  err_detail text;
  err_state text;
begin
  if v_source not in ('splitwise', 'potluck', 'csv') then
    raise exception using message = 'invalid_import', detail = 'Unknown import source', errcode = '22023';
  end if;
  if import_expenses.rows is null or jsonb_typeof(import_expenses.rows) <> 'array'
     or jsonb_array_length(import_expenses.rows) = 0 then
    raise exception using message = 'invalid_import', detail = 'There is nothing to import', errcode = '22023';
  end if;
  if jsonb_array_length(import_expenses.rows) > 5000 then
    raise exception using message = 'import_too_large', detail = 'Import at most 5000 rows at a time', errcode = '22023';
  end if;

  -- Group row first, then membership, before any expense or payment row (lock order).
  perform 1 from public.groups x where x.id = gid for share;
  perform private.require_member(gid);
  perform private.require_unarchived(gid);
  select * into g from public.groups x where x.id = gid;

  perform set_config('potluck.importing', gid::text, true);

  begin
    for r in select e.elem from jsonb_array_elements(import_expenses.rows) with ordinality as e (elem, ord)
             order by e.ord
    loop
      i := i + 1;
      if jsonb_typeof(r) <> 'object' then
        raise exception using message = 'invalid_import', detail = 'A row is not valid', errcode = '22023';
      end if;
      v_kind := r ->> 'kind';

      if v_kind = 'expense' then
        if jsonb_typeof(r -> 'payers') is distinct from 'array' then
          raise exception using message = 'invalid_payers', detail = 'Say who paid', errcode = '22023';
        end if;
        if jsonb_typeof(r -> 'splits') is distinct from 'array' then
          raise exception using message = 'splits_required', detail = 'Add at least one person to the split', errcode = '22023';
        end if;
        begin
          v_day := (r ->> 'spent_at')::date;
        exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
          v_day := null;
        end;
        if v_day is null then
          raise exception using message = 'invalid_import', detail = 'Every row needs a date', errcode = '22023';
        end if;

        perform private.save_expense(null, jsonb_build_object(
          'group_id', gid,
          'description', left(btrim(coalesce(r ->> 'description', '')), 120),
          'amount_cents', r -> 'amount_cents',
          'currency', r ->> 'currency',
          'spent_at', v_day,
          'category', left(nullif(btrim(r ->> 'category'), ''), 40),
          'notes', left(nullif(r ->> 'notes', ''), 2000),
          'is_refund', case when jsonb_typeof(r -> 'is_refund') = 'boolean' then (r ->> 'is_refund')::boolean else false end,
          'payers', r -> 'payers',
          'split_type', 'exact',
          'splits', r -> 'splits'
        ));
        n_expenses := n_expenses + 1;

      elsif v_kind = 'payment' then
        v_from := private.try_uuid(r ->> 'from_user');
        v_to := private.try_uuid(r ->> 'to_user');
        if v_from is null or v_to is null or v_from = v_to then
          raise exception using message = 'invalid_recipient', detail = 'Say who paid whom', errcode = '22023';
        end if;
        if jsonb_typeof(r -> 'amount_cents') is distinct from 'number'
           or (r ->> 'amount_cents')::numeric <> trunc((r ->> 'amount_cents')::numeric)
           or (r ->> 'amount_cents')::numeric <= 0
           or (r ->> 'amount_cents')::numeric > 100000000000 then
          raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
        end if;
        v_amount := (r ->> 'amount_cents')::bigint;
        v_currency := upper(coalesce(nullif(btrim(r ->> 'currency'), ''), g.currency));
        if v_currency !~ '^[A-Z]{3}$' then
          raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
        end if;
        begin
          v_day := (r ->> 'paid_on')::date;
        exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
          v_day := null;
        end;
        if v_day is null then
          raise exception using message = 'invalid_import', detail = 'Every row needs a date', errcode = '22023';
        end if;
        -- Nothing may move the balance of someone who left.
        if (
          select count(*) from public.group_members m
          where m.group_id = gid and m.user_id in (v_from, v_to)
        ) <> 2 then
          raise exception using message = 'member_not_in_group', detail = 'Both people must be in the group', errcode = '23514';
        end if;
        v_fx := private.fx_rate(v_currency::char(3), g.currency, v_day);
        if v_fx is null then
          raise exception using
            message = 'fx_rate_unavailable',
            detail = format('No exchange rate from %s to %s yet', v_currency, g.currency),
            errcode = '23514';
        end if;

        insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
        values (
          gid, v_from, v_to, v_amount, v_currency, v_fx,
          left(nullif(btrim(r ->> 'note'), ''), 500),
          (v_day + time '12:00') at time zone 'UTC',
          uid
        );
        n_payments := n_payments + 1;

      else
        raise exception using message = 'invalid_import', detail = 'Each row is an expense or a payment', errcode = '22023';
      end if;
    end loop;
  exception when others then
    get stacked diagnostics
      err_message = message_text,
      err_detail = pg_exception_detail,
      err_state = returned_sqlstate;
    raise exception using
      message = err_message,
      detail = coalesce(err_detail, ''),
      hint = format('import_row:%s', i),
      errcode = err_state;
  end;

  perform private.log_activity(gid, uid, 'expenses.imported', null, jsonb_build_object(
    'expenses', n_expenses,
    'payments', n_payments,
    'source', v_source
  ));

  return jsonb_build_object('expenses', n_expenses, 'payments', n_payments);
end;
$$;

revoke execute on function public.import_expenses(uuid, jsonb, text) from public, anon;
grant execute on function public.import_expenses(uuid, jsonb, text) to authenticated, service_role;

-- Backup -------------------------------------------------------------------------------------

-- One group as the backup lists it. Called only by export_my_data for the caller's own groups.
create or replace function private.export_group(gid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'emoji', g.emoji,
    'color', g.color,
    'currency', g.currency,
    'is_direct', g.is_direct,
    'simplify_debts', g.simplify_debts,
    'members_can_invite', g.members_can_invite,
    'default_split', g.default_split,
    'created_by', g.created_by,
    'created_at', g.created_at,
    'archived_at', g.archived_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at)
                       order by m.joined_at, m.user_id)
      from public.group_members m where m.group_id = g.id), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'description', e.description,
        'amount_cents', e.amount_cents,
        'currency', e.currency,
        'fx_rate', e.fx_rate::text,
        'is_refund', e.is_refund,
        'split_type', e.split_type,
        'category', e.category,
        'notes', e.notes,
        'spent_at', e.spent_at,
        'tax_cents', e.tax_cents,
        'tip_cents', e.tip_cents,
        'discount_cents', e.discount_cents,
        'event_id', e.event_id,
        'recurring_id', e.recurring_id,
        'receipt_path', e.receipt_path,
        'created_by', e.created_by,
        'created_at', e.created_at,
        'updated_at', e.updated_at,
        'deleted_at', e.deleted_at,
        'payers', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'paid_cents', p.paid_cents)
                           order by p.paid_cents desc, p.user_id)
          from public.expense_payers p where p.expense_id = e.id), '[]'::jsonb),
        'splits', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'share_cents', s.share_cents,
                             'weight', s.weight::text, 'adjustment_cents', s.adjustment_cents)
                           order by s.user_id)
          from public.expense_splits s where s.expense_id = e.id), '[]'::jsonb),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('position', it.position, 'description', it.description,
                             'amount_cents', it.amount_cents, 'user_ids', to_jsonb(it.user_ids))
                           order by it.position)
          from public.expense_items it where it.expense_id = e.id), '[]'::jsonb),
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'body', c.body,
                             'created_at', c.created_at)
                           order by c.created_at, c.id)
          from public.comments c where c.expense_id = e.id and c.deleted_at is null), '[]'::jsonb)
      ) order by e.spent_at, e.created_at, e.id)
      from public.expenses e where e.group_id = g.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'from_user', s.from_user,
        'to_user', s.to_user,
        'amount_cents', s.amount_cents,
        'currency', s.currency,
        'fx_rate', s.fx_rate::text,
        'note', s.note,
        'settled_at', s.settled_at,
        'created_by', s.created_by,
        'created_at', s.created_at,
        'deleted_at', s.deleted_at
      ) order by s.settled_at, s.id)
      from public.settlements s where s.group_id = g.id), '[]'::jsonb),
    'recurring', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'description', x.description,
        'amount_cents', x.amount_cents,
        'currency', x.currency,
        'paid_by', x.paid_by,
        'payers', x.payers,
        'split_type', x.split_type,
        'splits', x.splits,
        'category', x.category,
        'recurrence', x.recurrence,
        'next_run_on', x.next_run_on,
        'active', x.active,
        'created_by', x.created_by,
        'created_at', x.created_at
      ) order by x.created_at, x.id)
      from public.recurring_expenses x where x.group_id = g.id), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'description', ev.description,
        'location', ev.location,
        'emoji', ev.emoji,
        'status', ev.status,
        'timezone', ev.timezone,
        'window_start', ev.window_start,
        'window_end', ev.window_end,
        'day_start_minute', ev.day_start_minute,
        'day_end_minute', ev.day_end_minute,
        'slot_minutes', ev.slot_minutes,
        'duration_minutes', ev.duration_minutes,
        'min_attendees', ev.min_attendees,
        'starts_at', ev.starts_at,
        'ends_at', ev.ends_at,
        'rsvp_deadline', ev.rsvp_deadline,
        'created_by', ev.created_by,
        'created_at', ev.created_at,
        'rsvps', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', rv.user_id, 'status', rv.status, 'updated_at', rv.updated_at)
                           order by rv.user_id)
          from public.event_rsvps rv where rv.event_id = ev.id), '[]'::jsonb),
        'availability', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'slot_start', a.slot_start, 'level', a.level)
                           order by a.user_id, a.slot_start)
          from public.availability a where a.event_id = ev.id), '[]'::jsonb),
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'body', c.body,
                             'created_at', c.created_at)
                           order by c.created_at, c.id)
          from public.comments c where c.event_id = ev.id and c.deleted_at is null), '[]'::jsonb)
      ) order by ev.created_at, ev.id)
      from public.events ev where ev.group_id = g.id), '[]'::jsonb)
  )
  from public.groups g
  where g.id = gid;
$$;

revoke execute on function private.export_group(uuid) from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  gids uuid[];
begin
  select coalesce(array_agg(m.group_id), '{}') into gids
  from public.group_members m where m.user_id = uid;

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
    -- Everyone the file mentions, so names survive people leaving or closing their account.
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name,
                         'deleted', p.deleted_at is not null) order by p.id)
      from public.profiles p
      where p.id in (
        select m.user_id from public.group_members m where m.group_id = any (gids)
        union select x.user_id from public.expense_payers x
          join public.expenses e on e.id = x.expense_id where e.group_id = any (gids)
        union select x.user_id from public.expense_splits x
          join public.expenses e on e.id = x.expense_id where e.group_id = any (gids)
        union select s.from_user from public.settlements s where s.group_id = any (gids)
        union select s.to_user from public.settlements s where s.group_id = any (gids)
        union select c.author_id from public.comments c where c.group_id = any (gids)
        union select f.friend_id from public.friendships f where f.user_id = uid
        union select uid
      )
    ), '[]'::jsonb),
    'friends', coalesce((
      select jsonb_agg(f.friend_id order by f.friend_id)
      from public.friendships f where f.user_id = uid
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(private.export_group(g.id) order by g.created_at, g.id)
      from public.groups g where g.id = any (gids)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated, service_role;
