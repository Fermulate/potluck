-- Ledger and membership integrity. Every function keeps its signature and grants.
--
--   * Blocks: nobody joins a group through an invite while a block stands
--     between them and someone already in it (accept_invite raises blocked).
--     invite_preview reports blocked and archived so the join page can say so.
--   * Former members stay readable: co-members can read the profile of anyone
--     who has left one of their groups while something there still names them
--     (private.former_members), so old expenses, payments and activity keep
--     their names.
--   * Membership changes and money writes serialize on the group row:
--     remove_member and leave_group lock it before reading balances, and every
--     RPC that moves a balance takes a share lock on it first. Lock order is
--     always the group row, then the expense or payment row.
--     Closing an account and the recurring expenses job lock the group rows
--     the same way before reading balances or membership.
--   * Nothing moves a former member's balance: editing or deleting an expense
--     they are part of (as payer or with a share) is refused, and so is
--     deleting a payment with someone who has left (member_not_in_group).
--   * An edit that only changes who is in the split, or their shares, is
--     logged and notified as expense.updated like any other edit.
--   * The owner can leave when only closed accounts are left with them, which
--     deletes the group, as long as no active person has an open balance.
--   * schedule_event keeps reminder_sent_at unless the start time changes.
--   * FX rates keep 12 decimal places instead of 8 (IDR, KRW and friends).

-- Blocks --------------------------------------------------------------------------------------

-- True when either person has blocked the other.
create or replace function private.has_block(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks x where x.blocker_id = a and x.blocked_id = b)
      or exists (select 1 from public.blocks x where x.blocker_id = b and x.blocked_id = a);
$$;

-- True when anyone in the group has a block, in either direction, with `uid`.
create or replace function private.blocked_in_group(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.blocks b
      join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
      where b.blocked_id = uid
    )
    or exists (
      select 1 from public.blocks b
      join public.group_members m on m.group_id = gid and m.user_id = b.blocked_id
      where b.blocker_id = uid
    );
$$;

create or replace function public.get_or_create_direct_group(friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  gid uuid;
begin
  if get_or_create_direct_group.friend_id = uid then
    raise exception using message = 'invalid_friend', detail = 'You cannot split with yourself', errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = get_or_create_direct_group.friend_id
      and p.deleted_at is null
      and p.id in (select private.my_contact_ids())
  ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;

  if private.has_block(uid, get_or_create_direct_group.friend_id) then
    raise exception using message = 'blocked', detail = 'You cannot split with this person', errcode = '42501';
  end if;

  -- Serialize creation per pair so two taps do not create two groups.
  perform pg_advisory_xact_lock(hashtextextended(
    least(uid::text, get_or_create_direct_group.friend_id::text)
      || greatest(uid::text, get_or_create_direct_group.friend_id::text),
    0
  ));

  select g.id into gid
  from public.groups g
  where g.is_direct
    and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
    and exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id = get_or_create_direct_group.friend_id
    )
  order by g.created_at
  limit 1;

  if gid is not null then
    return gid;
  end if;

  insert into public.groups (name, currency, is_direct, members_can_invite, created_by)
  select 'Direct', p.default_currency, true, false, uid
  from public.profiles p where p.id = uid
  returning id into gid;

  insert into public.group_members (group_id, user_id, role)
  values (gid, uid, 'owner'), (gid, get_or_create_direct_group.friend_id, 'admin');

  return gid;
end;
$$;

-- status is one of: valid, expired, revoked, used_up, archived, blocked.
-- blocked only shows for a signed in visitor who is not already a member.
create or replace function public.invite_preview(code text)
returns table (
  group_id uuid,
  name text,
  emoji text,
  color text,
  cover_path text,
  member_count int,
  first_names text[],
  status text,
  is_member boolean
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
  select * into inv from public.group_invites i where i.code = invite_preview.code;

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
    (select count(*)::int from public.group_members m where m.group_id = g.id),
    array(
      select split_part(p.display_name, ' ', 1)
      from public.group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = g.id and p.deleted_at is null
      order by (m.role = 'owner') desc, m.joined_at, p.id
      limit 5
    ),
    case
      when inv.revoked_at is not null then 'revoked'
      when inv.expires_at is not null and inv.expires_at <= now() then 'expired'
      when inv.max_uses is not null and inv.uses >= inv.max_uses then 'used_up'
      when g.archived_at is not null then 'archived'
      when uid is not null and not x.is_member and private.blocked_in_group(g.id, uid) then 'blocked'
      else 'valid'
    end,
    x.is_member
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

-- Joins the group behind an invite code. Already being a member is not an
-- error and does not use up the invite.
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
  if inv.email is not null then
    select lower(u.email) into my_email from auth.users u where u.id = uid;
    if my_email is distinct from inv.email then
      raise exception using message = 'invite_wrong_email', detail = 'This invite was sent to a different email address', errcode = '42501';
    end if;
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

revoke execute on function
  private.has_block(uuid, uuid),
  private.blocked_in_group(uuid, uuid)
from public, anon, authenticated;

-- Former members ------------------------------------------------------------------------------

-- Who has left which group (or had their account closed). Kept so the people
-- still there can read the name on old expenses, payments and activity.
-- Rejoining removes the row; deleting the group removes them all.
create table private.former_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  left_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index former_members_user_id_idx on private.former_members (user_id);

alter table private.former_members enable row level security;
revoke all on table private.former_members from public, anon, authenticated;
grant all on table private.former_members to service_role;

-- Whether anything in the group still names this person: money, comments or the feed.
create or replace function private.referenced_in_group(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.expenses e where e.group_id = gid and e.paid_by = uid)
    or exists (
      select 1 from public.expense_splits s
      join public.expenses e on e.id = s.expense_id
      where e.group_id = gid and s.user_id = uid
    )
    or exists (
      select 1 from public.settlements st
      where st.group_id = gid and uid in (st.from_user, st.to_user)
    )
    or exists (select 1 from public.comments c where c.group_id = gid and c.author_id = uid)
    or exists (
      select 1 from public.activity a
      where a.group_id = gid
        and (a.actor_id = uid or (a.subject_id = uid and a.verb like 'member.%'))
    );
$$;

revoke execute on function private.referenced_in_group(uuid, uuid) from public, anon, authenticated;

create or replace function private.track_former_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    delete from private.former_members f
    where f.group_id = new.group_id and f.user_id = new.user_id;
    return null;
  end if;

  -- Rows removed by a cascading group or profile delete have nothing to point at, and a
  -- leaver nothing in the group names anymore has nothing to be read for.
  if exists (select 1 from public.groups g where g.id = old.group_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id)
     and private.referenced_in_group(old.group_id, old.user_id) then
    insert into private.former_members (group_id, user_id)
    values (old.group_id, old.user_id)
    on conflict (group_id, user_id) do update set left_at = excluded.left_at;
  end if;
  return null;
end;
$$;

create trigger group_members_track_former
after insert or delete on public.group_members
for each row execute function private.track_former_members();

-- The feed's own trigger runs first on the same delete; a membership taken away by a cascading
-- profile delete has nobody left to log.
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

-- Everyone who left before this table existed (the feed logs every departure) and is still
-- referenced in the group.
insert into private.former_members (group_id, user_id)
select distinct a.group_id, a.subject_id
from public.activity a
where a.verb in ('member.left', 'member.removed')
  and a.subject_id is not null
  and exists (select 1 from public.profiles p where p.id = a.subject_id)
  and not exists (
    select 1 from public.group_members m where m.group_id = a.group_id and m.user_id = a.subject_id
  )
  and private.referenced_in_group(a.group_id, a.subject_id)
on conflict do nothing;

-- People who have left one of my groups.
create or replace function private.my_former_contact_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id
  from public.group_members mine
  join private.former_members f on f.group_id = mine.group_id
  where mine.user_id = (select auth.uid());
$$;

grant execute on function private.my_former_contact_ids() to authenticated, service_role;

alter policy "profiles: read self and contacts" on public.profiles
using (
  id = (select auth.uid())
  or id in (select private.my_contact_ids())
  or id in (select private.my_former_contact_ids())
);

revoke execute on function private.track_former_members() from public, anon, authenticated;

-- Membership changes --------------------------------------------------------------------------

create or replace function public.remove_member(group_id uuid, user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role;
  target_role public.group_role;
begin
  -- Waits for money writes in flight; new ones wait for this transaction.
  -- Membership is read once the lock is held, so a caller removed meanwhile is refused.
  perform 1 from public.groups g where g.id = remove_member.group_id for no key update;
  my_role := private.require_member(remove_member.group_id);

  if remove_member.user_id = auth.uid() then
    raise exception using message = 'use_leave_group', detail = 'Use leave group to remove yourself', errcode = '22023';
  end if;
  if my_role = 'member' then
    raise exception using message = 'not_allowed', detail = 'Only owners and admins can remove members', errcode = '42501';
  end if;

  select m.role into target_role
  from public.group_members m
  where m.group_id = remove_member.group_id and m.user_id = remove_member.user_id;

  if target_role is null then
    raise exception using message = 'member_not_found', detail = 'That person is not in this group', errcode = 'PT404';
  end if;
  if target_role = 'owner' then
    raise exception using message = 'cannot_remove_owner', detail = 'The owner cannot be removed', errcode = '42501';
  end if;
  if my_role = 'admin' and target_role <> 'member' then
    raise exception using message = 'not_allowed', detail = 'Admins can only manage regular members', errcode = '42501';
  end if;
  if private.member_balance(remove_member.group_id, remove_member.user_id) <> 0 then
    raise exception using message = 'member_has_balance', detail = 'This member still has an unsettled balance', errcode = '23514';
  end if;

  delete from public.group_members m
  where m.group_id = remove_member.group_id and m.user_id = remove_member.user_id;
end;
$$;

-- Owners must transfer ownership first. When nobody else active is left
-- (alone, or only closed accounts remain), the owner leaving deletes the group,
-- as long as no active person is owed or owes anything there.
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
  where m.group_id = leave_group.group_id and m.user_id <> uid and p.deleted_at is null;

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

-- Expenses ------------------------------------------------------------------------------------

create or replace function private.require_unarchived(gid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.groups g where g.id = gid and g.archived_at is not null) then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;
end;
$$;

create or replace function private.save_expense(eid uuid, payload jsonb)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  my_role public.group_role;
  prev public.expenses;
  g public.groups;
  p jsonb := coalesce(payload, '{}'::jsonb);
  gid uuid;
  v_description text;
  v_amount bigint;
  v_currency text;
  v_fx numeric;
  v_paid_by uuid;
  v_split_type public.split_type;
  v_spent_at date;
  v_receipt text;
  v_event uuid;
  v_recurrence public.recurrence;
  split_input jsonb;
  rewrite_splits boolean;
  computed jsonb;
  result public.expenses;
  recurring uuid;
  old_shares jsonb;
  new_shares jsonb;
  payer_left boolean := false;
  sharer_left boolean := false;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end if;

  if eid is null then
    begin
      gid := (p ->> 'group_id')::uuid;
    exception when invalid_text_representation then
      gid := null;
    end;
    if gid is null then
      raise exception using message = 'group_required', detail = 'Pick a group for this expense', errcode = '22023';
    end if;
    -- Serializes with remove_member and leave_group (group row first, always),
    -- then membership is checked, so a caller removed while waiting is refused.
    perform 1 from public.groups x where x.id = gid for share;
    my_role := private.require_member(gid);
  else
    select e.group_id into gid from public.expenses e where e.id = eid;
    if gid is null then
      raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
    end if;
    perform 1 from public.groups x where x.id = gid for share;
    my_role := private.require_member(gid);

    select * into prev from public.expenses e where e.id = eid for update;
    if prev.id is null then
      raise exception using message = 'expense_not_found', detail = 'Expense not found', errcode = 'PT404';
    end if;
    if my_role = 'member' and uid is distinct from prev.created_by and uid <> prev.paid_by then
      raise exception using message = 'not_allowed', detail = 'You can only edit your own expenses', errcode = '42501';
    end if;
    if prev.deleted_at is not null then
      raise exception using message = 'expense_deleted', detail = 'Restore this expense before editing it', errcode = '23514';
    end if;
    if p ? 'group_id' and (p ->> 'group_id') is distinct from gid::text then
      raise exception using message = 'invalid_payload', detail = 'An expense cannot move to another group', errcode = '22023';
    end if;

    select coalesce(jsonb_object_agg(s.user_id, s.share_cents), '{}'::jsonb) into old_shares
    from public.expense_splits s where s.expense_id = prev.id;

    payer_left := not exists (
      select 1 from public.group_members m where m.group_id = gid and m.user_id = prev.paid_by
    );
    sharer_left := exists (
      select 1 from public.expense_splits s
      where s.expense_id = prev.id
        and s.share_cents > 0
        and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
    );
  end if;

  select * into g from public.groups x where x.id = gid;
  if g.archived_at is not null then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;

  -- Merge with the stored row on update.
  v_description := btrim(coalesce(p ->> 'description', prev.description, ''));
  if v_description = '' then
    raise exception using message = 'description_required', detail = 'Add a description', errcode = '22023';
  end if;

  if p ? 'amount_cents' then
    if jsonb_typeof(p -> 'amount_cents') <> 'number'
       or (p ->> 'amount_cents')::numeric <> trunc((p ->> 'amount_cents')::numeric)
       or (p ->> 'amount_cents')::numeric <= 0
       or (p ->> 'amount_cents')::numeric > 100000000000 then
      raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
    end if;
    v_amount := (p ->> 'amount_cents')::bigint;
  else
    v_amount := prev.amount_cents;
  end if;
  if v_amount is null then
    raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
  end if;

  v_currency := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), prev.currency, g.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;

  begin
    v_spent_at := coalesce((p ->> 'spent_at')::date, prev.spent_at, current_date);
    v_paid_by := coalesce((p ->> 'paid_by')::uuid, prev.paid_by, uid);
    v_split_type := coalesce((p ->> 'split_type')::public.split_type, prev.split_type, 'equal');
    v_event := case when p ? 'event_id' then (p ->> 'event_id')::uuid else prev.event_id end;
    v_recurrence := (p ->> 'recurrence')::public.recurrence;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'invalid_payload', detail = 'The expense is not valid', errcode = '22023';
  end;

  if v_currency = g.currency then
    v_fx := 1;
  elsif prev.id is not null and prev.currency = v_currency then
    v_fx := prev.fx_rate;
  else
    v_fx := private.fx_rate(v_currency::char(3), g.currency, v_spent_at);
    if v_fx is null then
      raise exception using
        message = 'fx_rate_unavailable',
        detail = format('No exchange rate from %s to %s yet', v_currency, g.currency),
        errcode = '23514';
    end if;
  end if;

  -- Only a new payer must be a member: an older expense paid by someone who has since left can
  -- still have its details edited.
  if v_paid_by is distinct from prev.paid_by
     and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = v_paid_by) then
    raise exception using message = 'payer_not_in_group', detail = 'The payer is not in this group', errcode = '23514';
  end if;

  if v_event is not null and not exists (
    select 1 from public.events ev where ev.id = v_event and ev.group_id = gid
  ) then
    raise exception using message = 'event_not_in_group', detail = 'That event is not in this group', errcode = '22023';
  end if;

  v_receipt := case when p ? 'receipt_path' then nullif(p ->> 'receipt_path', '') else prev.receipt_path end;
  if v_receipt is not null and v_receipt not like gid::text || '/%' then
    raise exception using message = 'invalid_receipt_path', detail = 'Receipts must be stored under the group folder', errcode = '22023';
  end if;

  -- Decide which splits to write.
  if p ? 'splits' then
    split_input := p -> 'splits';
    rewrite_splits := true;
  elsif prev.id is null then
    raise exception using message = 'splits_required', detail = 'Add at least one person to the split', errcode = '22023';
  elsif v_amount <> prev.amount_cents or v_split_type <> prev.split_type then
    -- Re-derive from the stored people and weights.
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'weight', s.weight) order by s.user_id)
    into split_input
    from public.expense_splits s where s.expense_id = prev.id;
    rewrite_splits := true;
  else
    rewrite_splits := false;
  end if;

  if rewrite_splits then
    select jsonb_agg(to_jsonb(c)) into computed
    from private.compute_splits(v_amount, v_split_type, split_input) c;

    if exists (
      select 1 from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric)
      where not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = s.user_id)
    ) then
      raise exception using message = 'split_member_not_in_group', detail = 'Everyone in the split must be in the group', errcode = '23514';
    end if;

    select coalesce(jsonb_object_agg(s.user_id, s.share_cents), '{}'::jsonb) into new_shares
    from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric);
  end if;

  -- A former member's balance is settled at zero and must stay there: the
  -- payer is credited the converted total and each person debited their share,
  -- so neither may change while they are out of the group.
  if (payer_left and (v_paid_by <> prev.paid_by or v_amount <> prev.amount_cents or v_currency <> prev.currency))
     or (sharer_left and (rewrite_splits or v_amount <> prev.amount_cents or v_currency <> prev.currency)) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  -- The expense row and its splits are written one after the other, so the
  -- sum check must run at commit even if the caller made constraints immediate.
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check deferred;

  if prev.id is null then
    if v_recurrence is not null then
      insert into public.recurring_expenses (
        group_id, description, amount_cents, currency, paid_by, split_type, category,
        splits, recurrence, next_run_on, created_by
      ) values (
        gid, v_description, v_amount, v_currency, v_paid_by, v_split_type, p ->> 'category',
        split_input, v_recurrence,
        (v_spent_at + case v_recurrence
          when 'weekly' then interval '1 week'
          when 'monthly' then interval '1 month'
          else interval '1 year' end)::date,
        uid
      )
      returning id into recurring;
    end if;

    insert into public.expenses (
      group_id, event_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
      category, notes, spent_at, receipt_path, recurring_id, created_by
    ) values (
      gid, v_event, v_description, v_amount, v_currency, v_fx, v_paid_by, v_split_type,
      nullif(btrim(p ->> 'category'), ''), nullif(p ->> 'notes', ''), v_spent_at, v_receipt, recurring, uid
    )
    returning * into result;
  else
    update public.expenses e set
      description = v_description,
      amount_cents = v_amount,
      currency = v_currency,
      fx_rate = v_fx,
      paid_by = v_paid_by,
      split_type = v_split_type,
      category = case when p ? 'category' then nullif(btrim(p ->> 'category'), '') else e.category end,
      notes = case when p ? 'notes' then nullif(p ->> 'notes', '') else e.notes end,
      spent_at = v_spent_at,
      receipt_path = v_receipt,
      event_id = v_event
    where e.id = prev.id
    returning * into result;
  end if;

  if rewrite_splits then
    delete from public.expense_splits s where s.expense_id = result.id;
    insert into public.expense_splits (expense_id, user_id, share_cents, weight)
    select result.id, s.user_id, s.share_cents, s.weight
    from jsonb_to_recordset(computed) as s (user_id uuid, share_cents bigint, weight numeric);
  end if;

  -- The expenses triggers only see the expense row. When the edit changed who
  -- owes what and nothing they compare, log and notify here instead, with the
  -- same verb and payload (people dropped from the split hear about it too).
  if prev.id is not null and rewrite_splits and new_shares <> old_shares then
    if (result.description, result.amount_cents, result.currency, result.fx_rate, result.paid_by,
        result.split_type, result.category, result.notes, result.spent_at, result.receipt_path,
        result.event_id)
       is not distinct from
       (prev.description, prev.amount_cents, prev.currency, prev.fx_rate, prev.paid_by,
        prev.split_type, prev.category, prev.notes, prev.spent_at, prev.receipt_path,
        prev.event_id) then
      perform private.log_activity(gid, uid, 'expense.updated', result.id,
        jsonb_build_object(
          'description', result.description,
          'amount_cents', result.amount_cents,
          'currency', result.currency,
          'paid_by', result.paid_by
        ));
    end if;

    if (result.description, result.amount_cents, result.currency, result.fx_rate, result.paid_by,
        result.split_type, result.spent_at)
       is not distinct from
       (prev.description, prev.amount_cents, prev.currency, prev.fx_rate, prev.paid_by,
        prev.split_type, prev.spent_at) then
      perform private.notify(
        array(
          select k::uuid from jsonb_object_keys(old_shares) as k
          union
          select k::uuid from jsonb_object_keys(new_shares) as k
          union
          select result.paid_by
        ),
        'expense.updated',
        jsonb_build_object(
          'expense_id', result.id,
          'group_id', result.group_id,
          'description', result.description,
          'amount_cents', result.amount_cents,
          'currency', result.currency
        ),
        uid
      );
    end if;
  end if;

  return result;
end;
$$;

create or replace function public.delete_expense(id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid := (select x.group_id from public.expenses x where x.id = delete_expense.id);
  e public.expenses;
begin
  if gid is not null then
    perform 1 from public.groups g where g.id = gid for share;
    perform private.require_member(gid);
  end if;
  e := private.editable_expense(delete_expense.id);

  if e.deleted_at is null and exists (
    select s.user_id from public.expense_splits s where s.expense_id = e.id and s.share_cents > 0
    union
    select e.paid_by
    except
    select m.user_id from public.group_members m where m.group_id = e.group_id
  ) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  update public.expenses x
  set deleted_at = coalesce(x.deleted_at, now())
  where x.id = e.id
  returning * into e;
  return e;
end;
$$;

create or replace function public.restore_expense(id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid := (select x.group_id from public.expenses x where x.id = restore_expense.id);
  e public.expenses;
begin
  if gid is not null then
    perform 1 from public.groups g where g.id = gid for share;
    perform private.require_member(gid);
  end if;
  e := private.editable_expense(restore_expense.id);

  if e.deleted_at is null then
    return e;
  end if;

  if exists (
    select s.user_id from public.expense_splits s where s.expense_id = e.id and s.share_cents > 0
    union
    select e.paid_by
    except
    select m.user_id from public.group_members m where m.group_id = e.group_id
  ) then
    raise exception using message = 'split_member_not_in_group', detail = 'Someone in this expense has left the group', errcode = '23514';
  end if;

  update public.expenses x set deleted_at = null where x.id = e.id returning * into e;
  return e;
end;
$$;

revoke execute on function private.require_unarchived(uuid) from public, anon, authenticated;

-- Payments ------------------------------------------------------------------------------------

create or replace function public.settle_up(
  group_id uuid,
  to_user uuid,
  amount_cents bigint,
  currency text default null,
  note text default null
)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  payer uuid := uid;
  g public.groups;
  cur text;
  fx numeric;
  result public.settlements;
begin
  perform 1 from public.groups x where x.id = settle_up.group_id for share;
  perform private.require_member(settle_up.group_id);
  perform private.require_unarchived(settle_up.group_id);
  select * into g from public.groups x where x.id = settle_up.group_id;

  if settle_up.amount_cents is null or settle_up.amount_cents <= 0 or settle_up.amount_cents > 100000000000 then
    raise exception using message = 'invalid_amount', detail = 'Enter an amount greater than zero', errcode = '22023';
  end if;
  if settle_up.to_user is null or settle_up.to_user = payer then
    raise exception using message = 'invalid_recipient', detail = 'Pick who you paid', errcode = '22023';
  end if;
  if (
    select count(*) from public.group_members m
    where m.group_id = settle_up.group_id and m.user_id in (payer, settle_up.to_user)
  ) <> 2 then
    raise exception using message = 'member_not_found', detail = 'Both people must be in the group', errcode = 'PT404';
  end if;

  cur := upper(coalesce(nullif(btrim(settle_up.currency), ''), g.currency));
  if cur !~ '^[A-Z]{3}$' then
    raise exception using message = 'invalid_currency', detail = 'Unknown currency code', errcode = '22023';
  end if;
  fx := private.fx_rate(cur::char(3), g.currency, current_date);
  if fx is null then
    raise exception using
      message = 'fx_rate_unavailable',
      detail = format('No exchange rate from %s to %s yet', cur, g.currency),
      errcode = '23514';
  end if;

  insert into public.settlements (group_id, from_user, to_user, amount_cents, currency, fx_rate, note, settled_at, created_by)
  values (
    settle_up.group_id, payer, settle_up.to_user, settle_up.amount_cents, cur, fx,
    nullif(btrim(settle_up.note), ''), now(), uid
  )
  returning * into result;

  return result;
end;
$$;

-- Removing a payment with someone who has left would reopen a debt nobody can settle.
create or replace function public.delete_settlement(id uuid)
returns public.settlements
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.settlements;
  my_role public.group_role;
  uid uuid := private.require_user();
  gid uuid;
begin
  select x.group_id into gid from public.settlements x where x.id = delete_settlement.id;
  if gid is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  perform 1 from public.groups g where g.id = gid for share;
  my_role := private.require_member(gid);

  select * into s from public.settlements x where x.id = delete_settlement.id for update;
  if s.id is null then
    raise exception using message = 'settlement_not_found', detail = 'Payment not found', errcode = 'PT404';
  end if;
  if my_role = 'member' and uid not in (s.from_user, s.to_user) and uid is distinct from s.created_by then
    raise exception using message = 'not_allowed', detail = 'You can only remove payments you were part of', errcode = '42501';
  end if;
  perform private.require_unarchived(s.group_id);

  if s.deleted_at is null and (
    select count(*) from public.group_members m
    where m.group_id = s.group_id and m.user_id in (s.from_user, s.to_user)
  ) <> 2 then
    raise exception using message = 'member_not_in_group', detail = 'Someone in this payment has left the group', errcode = '23514';
  end if;

  update public.settlements x set deleted_at = coalesce(x.deleted_at, now())
  where x.id = s.id
  returning * into s;
  return s;
end;
$$;

-- Plans ---------------------------------------------------------------------------------------

-- Locks in a time. Can also reschedule an already scheduled event; the
-- reminder goes out again only when the start time actually moves.
create or replace function public.schedule_event(event_id uuid, starts_at timestamptz)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev public.events := private.manageable_event(schedule_event.event_id);
begin
  if schedule_event.starts_at is null then
    raise exception using message = 'starts_at_required', detail = 'Pick a start time', errcode = '22023';
  end if;
  if ev.status not in ('polling', 'scheduled') then
    raise exception using message = 'event_not_schedulable', detail = 'This event can no longer be scheduled', errcode = '23514';
  end if;

  update public.events e set
    status = 'scheduled',
    starts_at = schedule_event.starts_at,
    ends_at = schedule_event.starts_at + make_interval(mins => e.duration_minutes),
    reminder_sent_at = case
      when e.starts_at is distinct from schedule_event.starts_at then null
      else e.reminder_sent_at
    end
  where e.id = ev.id
  returning * into ev;

  return ev;
end;
$$;

-- FX precision --------------------------------------------------------------------------------

-- Cross rates for weak currencies (1 IDR = 0.0000617 USD) kept only three or
-- four significant digits at 8 decimals. 12 decimals keep at least eight.
-- Stored rates have at most 8 decimals, so widening changes no balance.
drop view public.group_balances;

alter table public.fx_rates alter column rate type numeric(24, 12);
alter table public.expenses alter column fx_rate type numeric(24, 12);
alter table public.settlements alter column fx_rate type numeric(24, 12);

create or replace function private.convert_minor(amount bigint, rate numeric, from_currency text, to_currency text)
returns bigint
language sql
immutable
parallel safe
return case
    when from_currency = to_currency then round(amount::numeric * rate::numeric(24, 12))::bigint
    else round(
      amount::numeric * rate::numeric(24, 12)
      * power(10::numeric, private.minor_units(to_currency) - private.minor_units(from_currency))
    )::bigint
  end;

create or replace function private.fx_rate(from_currency char(3), to_currency char(3), on_day date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result numeric;
begin
  if from_currency = to_currency then
    return 1;
  end if;

  select r.rate into result
  from public.fx_rates r
  where r.base = from_currency and r.quote = to_currency and r.day <= on_day
  order by r.day desc
  limit 1;

  if result is null then
    select round(1 / r.rate, 12) into result
    from public.fx_rates r
    where r.base = to_currency and r.quote = from_currency and r.day <= on_day
    order by r.day desc
    limit 1;
  end if;

  return result;
end;
$$;

-- Unchanged from 20261105071431_group_balances_view.sql.
create view public.group_balances
with (security_invoker = true)
as
with expense_totals as not materialized (
  select
    e.id,
    e.group_id,
    e.paid_by,
    private.convert_minor(e.amount_cents, e.fx_rate, e.currency, g.currency) as total
  from public.expenses e
  join public.groups g on g.id = e.group_id
  where e.deleted_at is null
),
split_parts as (
  select
    t.id,
    t.group_id,
    t.total,
    s.user_id,
    div(t.total::numeric * s.share_cents, sum(s.share_cents) over w) as base,
    mod(t.total::numeric * s.share_cents, sum(s.share_cents) over w) as rem
  from expense_totals t
  join public.expense_splits s on s.expense_id = t.id
  window w as (partition by t.group_id, t.id)
),
split_shares as (
  select
    p.group_id,
    p.user_id,
    p.base + case
      when row_number() over (partition by p.group_id, p.id order by p.rem desc, p.user_id)
           <= p.total - sum(p.base) over (partition by p.group_id, p.id)
      then 1 else 0
    end as share
  from split_parts p
),
ledger as (
  select m.group_id, m.user_id, 0::numeric as delta
  from public.group_members m

  union all

  select t.group_id, t.paid_by, t.total::numeric
  from expense_totals t

  union all

  select s.group_id, s.user_id, -s.share
  from split_shares s

  union all

  select st.group_id, st.from_user,
         private.convert_minor(st.amount_cents, st.fx_rate, st.currency, g.currency)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null

  union all

  select st.group_id, st.to_user,
         -private.convert_minor(st.amount_cents, st.fx_rate, st.currency, g.currency)::numeric
  from public.settlements st
  join public.groups g on g.id = st.group_id
  where st.deleted_at is null
)
select l.group_id, l.user_id, sum(l.delta)::bigint as net_cents
from ledger l
group by l.group_id, l.user_id;

comment on view public.group_balances is 'Net balance per member in group currency (positive = is owed).';

revoke all on table public.group_balances from anon, authenticated;
grant select on table public.group_balances to authenticated;
grant select on table public.group_balances to service_role;

-- The currency picker asks which currencies convert into the group currency
-- (base = X or quote = X); the primary key only covers the base side.
create index fx_rates_quote_day_idx on public.fx_rates (quote, day desc) include (base);

-- Closing an account ---------------------------------------------------------------------------

-- Same as 20261106000000_review_fixes.sql, plus the group rows of every group
-- the account is in are locked first (in id order, so two closings cannot
-- deadlock), before ownership moves and zero-balance memberships are removed.
-- An expense or payment in flight finishes first, so no balance it creates is
-- left behind on a membership that was just deleted.
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

-- Recurring expenses job -----------------------------------------------------------------------

-- Same as 20261106000000_review_fixes.sql, but the group rows of every due
-- template are share locked up front, in id order (the order delete_my_account
-- uses, so the two cannot deadlock), before any template row is locked or
-- membership is checked: group row first, the order every money RPC uses. Each
-- template is then locked and re-read, and skipped if someone else holds it or
-- it is no longer due.
create or replace function private.materialize_recurring_expenses(run_on date default current_date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_ids uuid[];
  cand_id uuid;
  r public.recurring_expenses;
  g public.groups;
  fx numeric;
  new_id uuid;
  due date;
  anchor_day int;
  runs int;
  made int := 0;
begin
  set constraints public.expenses_splits_sum_check, public.expense_splits_sum_check deferred;

  select coalesce(array_agg(x.id order by x.next_run_on, x.id), '{}') into due_ids
  from public.recurring_expenses x
  where x.active and x.next_run_on <= run_on;

  perform 1 from public.groups x
  where x.id in (select t.group_id from public.recurring_expenses t where t.id = any(due_ids))
  order by x.id
  for share;

  foreach cand_id in array due_ids loop
    begin
      select * into r from public.recurring_expenses x
      where x.id = cand_id and x.active and x.next_run_on <= run_on
      for update skip locked;
      if not found then
        continue;
      end if;
      select * into g from public.groups x where x.id = r.group_id;

      if g.archived_at is not null
         or not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = r.paid_by)
         or exists (
           select 1 from jsonb_array_elements(r.splits) e
           where not exists (
             select 1 from public.group_members m
             where m.group_id = r.group_id and m.user_id = (e ->> 'user_id')::uuid
           )
         )
         or exists (
           select 1 from public.profiles p
           where p.deleted_at is not null
             and (p.id = r.paid_by
                  or p.id in (select (e ->> 'user_id')::uuid from jsonb_array_elements(r.splits) e))
         ) then
        update public.recurring_expenses x set active = false where x.id = r.id;
        continue;
      end if;

      due := r.next_run_on;
      anchor_day := private.recurring_anchor_day(r);
      runs := 0;
      while due <= run_on and runs < 12 loop
        fx := private.fx_rate(r.currency, g.currency, due);
        exit when fx is null;

        insert into public.expenses (
          group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
          category, spent_at, recurring_id, created_by
        ) values (
          r.group_id, r.description, r.amount_cents, r.currency, fx, r.paid_by, r.split_type,
          r.category, due, r.id, r.created_by
        )
        returning id into new_id;

        insert into public.expense_splits (expense_id, user_id, share_cents, weight)
        select new_id, c.user_id, c.share_cents, c.weight
        from private.compute_splits(r.amount_cents, r.split_type, r.splits) c;

        due := private.recurring_step(due, r.recurrence, anchor_day);
        runs := runs + 1;
        made := made + 1;
      end loop;

      update public.recurring_expenses x set next_run_on = due where x.id = r.id;
    exception
      when others then
        raise warning 'recurring expense % skipped: %', cand_id, sqlerrm;
    end;
  end loop;

  return made;
end;
$$;
