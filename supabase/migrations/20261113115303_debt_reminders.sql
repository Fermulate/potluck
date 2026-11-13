-- "Remind" on a debt: the person owed nudges the person who owes them. At most once a day (UTC)
-- per group and pair; the reminder is an in-app notification `debt.reminder`, which the push
-- trigger also sends to their devices. An optional short note goes along ("Rent is due Friday").

create table public.debt_reminders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- The person owed, who sent the reminder.
  from_user uuid not null references public.profiles (id) on delete cascade,
  -- The person who owes.
  to_user uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  note text check (char_length(note) <= 280),
  sent_on date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  constraint debt_reminders_once_a_day unique (group_id, from_user, to_user, sent_on),
  constraint debt_reminders_check check (from_user <> to_user)
);

comment on table public.debt_reminders is
  'One row per reminder sent; the unique key keeps it to once a day per group and pair.';

create index debt_reminders_from_user_idx on public.debt_reminders (from_user);
create index debt_reminders_to_user_idx on public.debt_reminders (to_user);

alter table public.debt_reminders enable row level security;

-- Both people can see that a reminder went out; nobody writes the table directly.
create policy "debt_reminders: the pair reads" on public.debt_reminders
for select to authenticated
using (
  (from_user = (select auth.uid()) or to_user = (select auth.uid()))
  and group_id = any (array(select private.my_group_ids()))
);

revoke all on public.debt_reminders from anon, authenticated;
grant select (id, group_id, from_user, to_user, amount_cents, currency, note, sent_on, created_at)
  on public.debt_reminders to authenticated;
grant all on public.debt_reminders to service_role;

-- remind_debt ---------------------------------------------------------------------------------------

create or replace function public.remind_debt(group_id uuid, user_id uuid, note text default null)
returns public.debt_reminders
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  g public.groups;
  owed bigint;
  v_note text := nullif(btrim(remind_debt.note), '');
  result public.debt_reminders;
begin
  perform private.require_member(remind_debt.group_id);
  perform private.require_group_open(remind_debt.group_id);
  select * into g from public.groups x where x.id = remind_debt.group_id;

  if char_length(v_note) > 280 then
    raise exception using message = 'note_too_long', detail = 'Keep the note short', errcode = '22023';
  end if;
  if remind_debt.user_id is null or remind_debt.user_id = uid then
    raise exception using message = 'invalid_parties', detail = 'Pick someone who owes you', errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_members m
    where m.group_id = g.id and m.user_id = remind_debt.user_id
  ) then
    raise exception using message = 'member_not_in_group', detail = 'They are not in this group', errcode = '23514';
  end if;

  select d.amount_cents into owed
  from private.group_debts(g.id) d
  where d.from_user = remind_debt.user_id and d.to_user = uid;
  if coalesce(owed, 0) <= 0 then
    raise exception using message = 'nothing_owed', detail = 'They do not owe you anything here', errcode = '23514';
  end if;

  insert into public.debt_reminders (group_id, from_user, to_user, amount_cents, currency, note)
  values (g.id, uid, remind_debt.user_id, owed, g.currency, v_note)
  on conflict on constraint debt_reminders_once_a_day do nothing
  returning * into result;
  if result.id is null then
    raise exception using message = 'already_reminded', detail = 'You already sent a reminder today', errcode = '23514';
  end if;

  perform private.notify(
    array[remind_debt.user_id],
    'debt.reminder',
    jsonb_build_object(
      'group_id', g.id,
      'from_user', uid,
      'amount_cents', owed,
      'currency', g.currency,
      'note', v_note
    ),
    uid
  );
  return result;
end;
$$;

revoke execute on function public.remind_debt(uuid, uuid, text) from public, anon;
grant execute on function public.remind_debt(uuid, uuid, text) to authenticated, service_role;
