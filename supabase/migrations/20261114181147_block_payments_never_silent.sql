-- Settling up across a block is never silent. 20261114161054_payments_across_blocks.sql let both
-- people change any payment in a 1:1 tab across a block, while the block still muted the blocker's
-- notifications. Now the blocked side may record a new payment there and change only the payments
-- they recorded themselves; payments the blocker recorded stay out of their reach. Payment
-- notifications (created, updated, deleted, restored) are no longer muted by a block, so the
-- blocker hears about every payment the blocked person touches. ADR 19 has the dated note.
--
-- Redefined (each body copied from schema/current.sql, as noted above it):
--   private.freeze_blocked_direct_money, private.skip_placeholder_notification.

-- Body as in 20261114161054_payments_across_blocks.sql (live copy in schema/current.sql) plus: the
-- blocked side of a 1:1 tab may add a payment (settlements) and change only the ones they recorded.
CREATE OR REPLACE FUNCTION "private"."freeze_blocked_direct_money"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  uid uuid := auth.uid();
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  gid uuid;
begin
  if uid is null or private.claiming() then
    return coalesce(new, old);
  end if;
  -- Payments are how the two square up: a new one goes through, and so does a change to one the
  -- person recorded. The blocker hears of each (skip_placeholder_notification lets them through).
  if tg_table_name = 'settlements'
     and (tg_op = 'INSERT' or (to_jsonb(old) ->> 'created_by')::uuid = uid) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'comments' then
    gid := coalesce(
      (select x.group_id from public.expenses x where x.id = (row ->> 'expense_id')::uuid),
      (select e.group_id from public.events e where e.id = (row ->> 'event_id')::uuid),
      (select s.group_id from public.settlements s where s.id = (row ->> 'settlement_id')::uuid),
      (row ->> 'group_id')::uuid
    );
  else
    gid := (row ->> 'group_id')::uuid;
  end if;
  if tg_table_name = 'recurring_expenses' and tg_op = 'UPDATE'
     and (to_jsonb(old) ->> 'active')::boolean and not (to_jsonb(new) ->> 'active')::boolean then
    return new;
  end if;
  if exists (select 1 from public.groups g where g.id = gid and g.is_direct)
     and exists (
       select 1 from public.blocks b
       join public.group_members m on m.group_id = gid and m.user_id = b.blocker_id
       where b.blocked_id = uid
     ) then
    raise exception using message = 'not_a_friend', detail = 'You can only split with friends', errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Body as in 20261113201103_placeholder_members.sql (live copy in schema/current.sql) plus: a
-- block no longer mutes payment notifications, so no payment changes without the blocker hearing.
CREATE OR REPLACE FUNCTION "private"."skip_placeholder_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- A placeholder only ever gets its invite.
  if new.type <> 'member.added'
     and exists (select 1 from public.profiles p where p.id = new.user_id and p.is_placeholder) then
    return null;
  end if;
  -- Its invite never goes to an address whose account has a block with whoever sent it. The
  -- seat remembers, so one goes out if that block is lifted.
  if new.type = 'member.added'
     and private.seat_email_blocked(new.user_id, private.try_uuid(new.data ->> 'actor_id')) then
    update public.placeholders x
    set held_by = private.try_uuid(new.data ->> 'actor_id'),
        held_reminder = coalesce((new.data ->> 'reminder')::boolean, false)
    where x.profile_id = new.user_id;
    return null;
  end if;
  -- Blocking mutes: nothing someone did reaches a person who blocked them, except a payment that
  -- moves the blocker's balance.
  if new.type not like 'settlement.%' and exists (
    select 1 from public.blocks b
    where b.blocker_id = new.user_id
      and b.blocked_id = private.try_uuid(new.data ->> 'actor_id')
  ) then
    return null;
  end if;
  return new;
end;
$$;
