-- set_availability serializes replaces per (event, viewer). The web client can have two
-- requests for the same viewer on the wire at once (a save in flight and the keepalive flush
-- sent as the page is left); without a lock their delete-then-insert steps interleave under
-- read committed and the server can end on the union of two maps, or on a primary key error.
-- Body as in 20261106000000_review_fixes.sql plus the transaction advisory lock.
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
  perform private.require_group_open(ev.group_id);
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
        (e.elem ->> 'slot_start')::timestamptz as slot_start,
        coalesce((e.elem ->> 'level')::public.availability_level, 'yes') as level
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

  perform pg_advisory_xact_lock(hashtextextended(ev.id::text || ':' || uid::text, 0));

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
