-- RPCs: availability polling.

-- Loads an event and checks the caller is in its group.
create or replace function private.member_event(eid uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events e where e.id = eid;
  if ev.id is null then
    raise exception using message = 'event_not_found', detail = 'Event not found', errcode = 'P0002';
  end if;
  perform private.require_member(ev.group_id);
  return ev;
end;
$$;

-- Replaces the caller's availability for an event.
-- slots: array of {"slot_start": timestamptz, "level": "yes" | "maybe"}; a bare
-- timestamp string means "yes". Every slot must be a cell of the event grid.
-- Returns the number of slots saved.
create or replace function public.set_availability(event_id uuid, slots jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ev public.events := private.member_event(set_availability.event_id);
  parsed jsonb;
  saved int;
begin
  if ev.status <> 'polling' then
    raise exception using message = 'event_not_polling', detail = 'This event is no longer collecting availability', errcode = '23514';
  end if;
  if slots is null or jsonb_typeof(slots) <> 'array' then
    raise exception using message = 'invalid_slots', detail = 'Availability is not valid', errcode = '22023';
  end if;
  if jsonb_array_length(slots) > 5000 then
    raise exception using message = 'invalid_slots', detail = 'Too many slots', errcode = '22023';
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('slot_start', x.slot_start, 'level', x.level)), '[]'::jsonb)
    into parsed
    from (
      select
        case jsonb_typeof(e.elem)
          when 'string' then (e.elem #>> '{}')::timestamptz
          else (e.elem ->> 'slot_start')::timestamptz
        end as slot_start,
        case jsonb_typeof(e.elem)
          when 'string' then 'yes'::public.availability_level
          else coalesce((e.elem ->> 'level')::public.availability_level, 'yes')
        end as level
      from jsonb_array_elements(slots) as e (elem)
    ) x;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using message = 'invalid_slots', detail = 'Availability is not valid', errcode = '22023';
  end;

  if exists (
    select 1
    from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level)
    cross join lateral (
      select (s.slot_start at time zone ev.timezone) as local_ts
    ) l
    cross join lateral (
      select
        l.local_ts::date as day,
        (extract(hour from l.local_ts) * 60 + extract(minute from l.local_ts))::int as minute,
        extract(second from l.local_ts) as sec
    ) t
    where s.slot_start is null
       or t.day < ev.window_start
       or t.day > ev.window_end
       or t.sec <> 0
       or t.minute < ev.day_start_minute
       or t.minute + ev.slot_minutes > ev.day_end_minute
       or (t.minute - ev.day_start_minute) % ev.slot_minutes <> 0
  ) then
    raise exception using message = 'invalid_slot', detail = 'Some times are outside this event''s grid', errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(parsed)) <> (
    select count(distinct (s.slot_start))
    from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level)
  ) then
    raise exception using message = 'duplicate_slot', detail = 'A time appears twice', errcode = '22023';
  end if;

  delete from public.availability a
  where a.event_id = ev.id and a.user_id = uid;

  insert into public.availability (event_id, user_id, slot_start, level)
  select ev.id, uid, s.slot_start, s.level
  from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level);

  get diagnostics saved = row_count;

  update public.availability_requests r
  set responded_at = now()
  where r.event_id = ev.id and r.user_id = uid;

  return saved;
end;
$$;

-- Asks members to fill in their availability and notifies them.
-- user_ids null or empty means every member who has not answered yet.
-- Returns the number of people asked.
create or replace function public.request_availability(event_id uuid, user_ids uuid[] default null)
returns int
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
      and not exists (select 1 from public.availability a where a.event_id = ev.id and a.user_id = m.user_id);
  else
    if exists (
      select 1 from unnest(user_ids) as t (id)
      where not exists (select 1 from public.group_members m where m.group_id = ev.group_id and m.user_id = t.id)
    ) then
      raise exception using message = 'member_not_found', detail = 'Everyone asked must be in the group', errcode = 'P0002';
    end if;
    select coalesce(array_agg(distinct t.id), '{}') into targets
    from unnest(user_ids) as t (id)
    where t.id <> uid;
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

-- Ranks candidate start times for an event (same rules as rankSlots in
-- packages/core).
--
-- Candidates: every distinct slot_start in current members' availability.
-- A duration that is not a whole number of cells rounds up; a member counts as
-- "yes" if they marked yes for every needed cell, "maybe" if they covered
-- every cell with yes or maybe (at least one maybe), and is `missing`
-- otherwise (sorted by id). score = yes + 0.5 * maybe. Only candidates where
-- yes + maybe >= min_attendees are returned, ordered by score desc then
-- earliest. Rows from people no longer in the group are ignored.
create or replace function public.best_slots(event_id uuid, "limit" int default 5)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  yes_count int,
  maybe_count int,
  score numeric,
  missing uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev public.events := private.member_event($1);
  cells int := ceil(ev.duration_minutes::numeric / ev.slot_minutes)::int;
  span interval := make_interval(mins => cells * ev.slot_minutes);
  max_rows int := least(greatest(coalesce($2, 5), 0), 100);
begin
  return query
  with members as (
    select m.user_id from public.group_members m where m.group_id = ev.group_id
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
    left join public.availability a
      on a.event_id = ev.id
     and a.user_id = mb.user_id
     and a.slot_start >= c.slot
     and a.slot_start < c.slot + span
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
$$;

revoke execute on function private.member_event(uuid) from public, anon, authenticated;

revoke execute on function
  public.set_availability(uuid, jsonb),
  public.request_availability(uuid, uuid[]),
  public.best_slots(uuid, int)
from public, anon;

grant execute on function
  public.set_availability(uuid, jsonb),
  public.request_availability(uuid, uuid[]),
  public.best_slots(uuid, int)
to authenticated, service_role;
