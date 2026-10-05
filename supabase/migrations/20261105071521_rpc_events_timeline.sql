-- RPCs: locking/cancelling events and the personal timeline.

-- Loads an event the caller may lock or cancel: group owner/admin, or creator.
create or replace function private.manageable_event(eid uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  uid uuid := private.require_user();
  my_role public.group_role;
begin
  select * into ev from public.events e where e.id = eid for update;
  if ev.id is null then
    raise exception using message = 'event_not_found', detail = 'Event not found', errcode = 'P0002';
  end if;
  my_role := private.require_member(ev.group_id);
  if my_role = 'member' and ev.created_by is distinct from uid then
    raise exception using message = 'not_allowed', detail = 'Only the organizer or a group admin can do that', errcode = '42501';
  end if;
  return ev;
end;
$$;

-- Locks in a time. Can also reschedule an already scheduled event.
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
    reminder_sent_at = null
  where e.id = ev.id
  returning * into ev;

  return ev;
end;
$$;

create or replace function public.cancel_event(event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev public.events := private.manageable_event(cancel_event.event_id);
begin
  if ev.status = 'cancelled' then
    return ev;
  end if;
  if ev.status = 'done' then
    raise exception using message = 'event_done', detail = 'This event already happened', errcode = '23514';
  end if;

  update public.events e set status = 'cancelled'
  where e.id = ev.id
  returning * into ev;

  return ev;
end;
$$;

-- Upcoming events across all my groups: scheduled events starting in
-- [from, to) and polls whose window overlaps it, with my RSVP and request state.
create or replace function public.my_timeline(
  "from" timestamptz default now(),
  "to" timestamptz default now() + interval '60 days'
)
returns table (
  event_id uuid,
  group_id uuid,
  group_name text,
  group_emoji text,
  group_color text,
  title text,
  emoji text,
  location text,
  status public.event_status,
  timezone text,
  starts_at timestamptz,
  ends_at timestamptz,
  window_start date,
  window_end date,
  rsvp_deadline timestamptz,
  my_rsvp public.rsvp_status,
  going_count int,
  availability_requested boolean,
  availability_submitted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  where
    (e.status = 'scheduled' and e.starts_at < range_to and coalesce(e.ends_at, e.starts_at) >= range_from)
    or (
      e.status = 'polling'
      and e.window_end >= (range_from at time zone e.timezone)::date
      and e.window_start <= (range_to at time zone e.timezone)::date
    )
  order by coalesce(e.starts_at, (e.window_start::timestamp at time zone e.timezone)), e.id;
end;
$$;

revoke execute on function private.manageable_event(uuid) from public, anon, authenticated;

revoke execute on function
  public.schedule_event(uuid, timestamptz),
  public.cancel_event(uuid),
  public.my_timeline(timestamptz, timestamptz)
from public, anon;

grant execute on function
  public.schedule_event(uuid, timestamptz),
  public.cancel_event(uuid),
  public.my_timeline(timestamptz, timestamptz)
to authenticated, service_role;
