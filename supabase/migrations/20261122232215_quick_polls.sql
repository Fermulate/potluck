-- Quick polls (ADR 22). Anyone, signed in or not, makes an availability poll, shares its link,
-- and everyone who opens it adds their times and sees everyone else's. No group, no event, no
-- auth user:
--
--   quick_polls                 one row per poll: its code, grid, expiry and the sha256 of the
--                               creator's token (the browser keeps the token)
--   quick_poll_answers          one row per browser that answered, with a seat number (1, 2,
--                               3...) and, when the poll asks for names, a name; plus the sha256
--                               of the token that browser made
--   quick_poll_slots            the slots each answer painted, same shape as public.availability
--   private.quick_poll_creates  when polls were made and by which client (sha256 of the first
--                               x-forwarded-for entry), kept an hour, for the create rate limit
--
-- Clients never touch the tables (RLS on, no policies, no grants). Everything goes through five
-- security definer RPCs that anon and authenticated may call. A poll's status has one owner,
-- private.quick_poll_status. The slot grid rule has one owner too: the body of
-- private.event_slots (as in 20261113170311_guest_links.sql, live in schema/current.sql) moves
-- into private.grid_slots, and event_slots now hands its event's grid to it.
-- The limits match packages/core/src/quick-polls/limits.ts.

-- Grid rule ---------------------------------------------------------------------------------------

-- Parses and checks a slots payload against a grid: the same rules as public.set_availability and
-- buildSlots in packages/core. Returns [{slot_start, level}].
create or replace function private.grid_slots(
  timezone text,
  window_start date,
  window_end date,
  day_start_minute int,
  day_end_minute int,
  slot_minutes int,
  slots jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  parsed jsonb;
begin
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
      select (s.slot_start at time zone grid_slots.timezone) as local_ts
    ) l
    cross join lateral (
      select
        l.local_ts::date as day,
        (extract(hour from l.local_ts) * 60 + extract(minute from l.local_ts))::int as minute,
        extract(second from l.local_ts) as sec
    ) t
    where s.slot_start is null
       or t.day < grid_slots.window_start
       or t.day > grid_slots.window_end
       or t.sec <> 0
       or t.minute < grid_slots.day_start_minute
       or t.minute + grid_slots.slot_minutes > grid_slots.day_end_minute
       or (t.minute - grid_slots.day_start_minute) % grid_slots.slot_minutes <> 0
  ) then
    raise exception using message = 'invalid_slot', detail = 'Some times are outside the grid', errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(parsed)) <> (
    select count(distinct (s.slot_start))
    from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level)
  ) then
    raise exception using message = 'duplicate_slot', detail = 'A time appears twice', errcode = '22023';
  end if;

  return parsed;
end;
$$;

revoke execute on function private.grid_slots(text, date, date, int, int, int, jsonb) from public, anon, authenticated;

create or replace function private.event_slots(ev public.events, slots jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.grid_slots(
    ev.timezone, ev.window_start, ev.window_end, ev.day_start_minute, ev.day_end_minute, ev.slot_minutes, slots
  );
$$;

-- Tables ------------------------------------------------------------------------------------------

create table public.quick_polls (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default private.random_code(12),
  title text check (char_length(title) between 1 and 80),
  timezone text not null check (private.is_time_zone(timezone)),
  window_start date not null,
  window_end date not null,
  day_start_minute int not null check (day_start_minute between 0 and 1439),
  day_end_minute int not null check (day_end_minute between 1 and 1440),
  slot_minutes int not null default 30 check (slot_minutes in (30, 60)),
  duration_minutes int not null check (duration_minutes between 15 and 1440),
  names_required boolean not null default true,
  max_people int not null default 10 check (max_people between 2 and 15),
  creator_token_hash bytea not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (window_end >= window_start and window_end - window_start <= 13),
  check (day_end_minute - day_start_minute >= slot_minutes)
);

comment on table public.quick_polls is
  'Availability polls made without an account (ADR 22). Only the quick poll RPCs read or write them; creator_token_hash is sha256 of the token the creator''s browser keeps.';

create index quick_polls_expires_at_idx on public.quick_polls (expires_at);

create table public.quick_poll_answers (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.quick_polls (id) on delete cascade,
  seat int not null check (seat >= 1),
  display_name text check (char_length(display_name) between 1 and 40),
  token_hash bytea not null,
  saves int not null default 1,
  saves_window_start timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, seat),
  unique (poll_id, token_hash)
);

comment on table public.quick_poll_answers is
  'One answer per browser per quick poll. seat numbers the answers 1, 2, 3 in order; display_name is null when the poll does not ask for names. token_hash is sha256 of the browser''s token.';
comment on column public.quick_poll_answers.saves is
  'Saves since saves_window_start: the per answer rate limit in set_quick_poll_availability.';

create table public.quick_poll_slots (
  answer_id uuid not null references public.quick_poll_answers (id) on delete cascade,
  slot_start timestamptz not null,
  level public.availability_level not null default 'yes',
  primary key (answer_id, slot_start)
);

revoke all on public.quick_polls from anon, authenticated;
revoke all on public.quick_poll_answers from anon, authenticated;
revoke all on public.quick_poll_slots from anon, authenticated;

grant all on public.quick_polls to service_role;
grant all on public.quick_poll_answers to service_role;
grant all on public.quick_poll_slots to service_role;

alter table public.quick_polls enable row level security;
alter table public.quick_poll_answers enable row level security;
alter table public.quick_poll_slots enable row level security;

create table private.quick_poll_creates (
  creator_hash bytea,
  created_at timestamptz not null default now()
);

create index quick_poll_creates_created_at_idx on private.quick_poll_creates (created_at);
create index quick_poll_creates_creator_idx on private.quick_poll_creates (creator_hash, created_at);

comment on table private.quick_poll_creates is
  'One row per quick poll made, kept an hour, for the create rate limit. creator_hash is sha256 of the first x-forwarded-for entry, null without one. Deleting a poll leaves its row here.';

revoke all on table private.quick_poll_creates from public, anon, authenticated;

-- Helpers -----------------------------------------------------------------------------------------

-- sha256 of a browser token, or null for one that cannot be ours (missing, too short, too long).
create or replace function private.quick_poll_token_hash(token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select case when char_length(token) between 16 and 200 then sha256(convert_to(token, 'UTF8')) end;
$$;

-- The one place a quick poll's status is decided, first match wins:
--   expired  expires_at has passed
--   closed   the creator closed it
--   full     every seat is taken and the visitor has not answered
--   open     otherwise
create or replace function private.quick_poll_status(poll public.quick_polls, answered boolean)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when poll.expires_at <= now() then 'expired'
    when poll.closed_at is not null then 'closed'
    when not coalesce(answered, false)
      and (select count(*) from public.quick_poll_answers a where a.poll_id = poll.id) >= poll.max_people
      then 'full'
    else 'open'
  end;
$$;

-- Deletes expired polls (their answers and slots go with them) and create log rows past the hour.
create or replace function private.purge_quick_polls()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.quick_polls q where q.expires_at <= now();
  get diagnostics n = row_count;
  delete from private.quick_poll_creates c where c.created_at <= now() - interval '1 hour';
  return n;
end;
$$;

revoke execute on function private.quick_poll_token_hash(text) from public, anon, authenticated;
revoke execute on function private.quick_poll_status(public.quick_polls, boolean) from public, anon, authenticated;
revoke execute on function private.purge_quick_polls() from public, anon, authenticated;

select cron.schedule('purge-quick-polls', '25 * * * *', $$select private.purge_quick_polls()$$);

-- RPCs, all anon-callable -------------------------------------------------------------------------

-- Makes a poll and returns its code and the creator's token, which is also the creator's answer
-- token. payload keys: title (optional, cleaned like guest names, blank means none), timezone,
-- window_start, window_end (1 to 14 days, both included, not all in the past), day_start_minute,
-- day_end_minute (at least one slot apart), duration_minutes (15 to 1440), slot_minutes (30 or
-- 60, default 30), ttl ('24h' or '7d'), names_required (default true), max_people (2 to 15,
-- default 10).
-- Rate limits: 5 polls an hour per client (sha256 of the first x-forwarded-for entry, when there is
-- one) and 200 an hour in all. An advisory lock serializes the counts.
create or replace function public.create_quick_poll(payload jsonb)
returns table (code text, creator_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  p jsonb := create_quick_poll.payload;
  v_title text;
  v_timezone text;
  v_window_start date;
  v_window_end date;
  v_day_start int;
  v_day_end int;
  v_duration int;
  v_slot int;
  v_ttl text;
  v_names boolean;
  v_max int;
  headers json;
  client bytea;
  token text := private.random_code(24);
  poll public.quick_polls;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception using message = 'invalid_quick_poll', detail = 'Poll settings are not valid', errcode = '22023';
  end if;

  begin
    v_title := nullif(private.clean_guest_name(p ->> 'title'), '');
    v_timezone := p ->> 'timezone';
    v_window_start := (p ->> 'window_start')::date;
    v_window_end := (p ->> 'window_end')::date;
    v_day_start := (p ->> 'day_start_minute')::int;
    v_day_end := (p ->> 'day_end_minute')::int;
    v_duration := (p ->> 'duration_minutes')::int;
    v_slot := coalesce((p ->> 'slot_minutes')::int, 30);
    v_ttl := p ->> 'ttl';
    v_names := coalesce((p ->> 'names_required')::boolean, true);
    v_max := coalesce((p ->> 'max_people')::int, 10);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
      or numeric_value_out_of_range then
      raise exception using message = 'invalid_quick_poll', detail = 'Poll settings are not valid', errcode = '22023';
  end;

  if char_length(v_title) > 80 then
    raise exception using message = 'invalid_quick_poll_title', detail = 'Titles are up to 80 characters', errcode = '22023';
  end if;
  if v_timezone is null or not private.is_time_zone(v_timezone) then
    raise exception using message = 'invalid_quick_poll_timezone', detail = 'That time zone is not known', errcode = '22023';
  end if;
  if v_window_start is null or v_window_end is null
     or v_window_end < v_window_start
     or v_window_end - v_window_start > 13
     or v_window_end < (now() at time zone v_timezone)::date then
    raise exception using message = 'invalid_quick_poll_window', detail = 'Polls cover 1 to 14 days, not all in the past', errcode = '22023';
  end if;
  if v_slot not in (30, 60) then
    raise exception using message = 'invalid_quick_poll_slot_minutes', detail = 'Slots are 30 or 60 minutes', errcode = '22023';
  end if;
  if v_day_start is null or v_day_end is null
     or v_day_start not between 0 and 1439
     or v_day_end not between 1 and 1440
     or v_day_end - v_day_start < v_slot then
    raise exception using message = 'invalid_quick_poll_hours', detail = 'The day must end at least one slot after it starts', errcode = '22023';
  end if;
  if v_duration is null or v_duration not between 15 and 1440 then
    raise exception using message = 'invalid_quick_poll_duration', detail = 'Plans last 15 minutes to 24 hours', errcode = '22023';
  end if;
  if v_ttl is null or v_ttl not in ('24h', '7d') then
    raise exception using message = 'invalid_quick_poll_ttl', detail = 'Polls last 24 hours or 7 days', errcode = '22023';
  end if;
  if v_max not between 2 and 15 then
    raise exception using message = 'invalid_quick_poll_people', detail = 'A poll takes 2 to 15 people', errcode = '22023';
  end if;

  -- PostgREST passes the request headers; the first x-forwarded-for entry is the client address
  -- (Supabase "Securing your API"). Only its hash is kept, and only for an hour.
  headers := nullif(current_setting('request.headers', true), '')::json;
  client := sha256(convert_to(nullif(btrim(split_part(headers ->> 'x-forwarded-for', ',', 1)), ''), 'UTF8'));

  perform pg_advisory_xact_lock(hashtextextended('create_quick_poll', 0));
  if client is not null and (
    select count(*) from private.quick_poll_creates c
    where c.creator_hash = client and c.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using message = 'quick_poll_rate_limited', detail = 'Too many polls from here, try again in an hour', errcode = '23514';
  end if;
  if (
    select count(*) from private.quick_poll_creates c where c.created_at > now() - interval '1 hour'
  ) >= 200 then
    raise exception using message = 'quick_poll_rate_limited', detail = 'Too many polls right now, try again later', errcode = '23514';
  end if;
  insert into private.quick_poll_creates (creator_hash) values (client);

  insert into public.quick_polls (
    title, timezone, window_start, window_end, day_start_minute, day_end_minute, slot_minutes,
    duration_minutes, names_required, max_people, creator_token_hash, expires_at
  )
  values (
    v_title, v_timezone, v_window_start, v_window_end, v_day_start, v_day_end, v_slot,
    v_duration, v_names, v_max, sha256(convert_to(token, 'UTF8')),
    now() + case v_ttl when '24h' then interval '24 hours' else interval '7 days' end
  )
  returning * into poll;

  return query select poll.code, token, poll.expires_at;
end;
$$;

revoke execute on function public.create_quick_poll(jsonb) from public;
grant execute on function public.create_quick_poll(jsonb) to anon, authenticated, service_role;

-- What a poll link shows. status comes from private.quick_poll_status. An expired poll shows its
-- status only; open, full and closed show the poll, whether the visitor made it, and every answer:
-- answers is [{seat, name, mine, slots: [{slot_start, level}]}] by seat, name null when the poll
-- does not ask for names, never ids or hashes.
create or replace function public.quick_poll_preview(code text, token text default null)
returns table (
  status text,
  title text,
  timezone text,
  window_start date,
  window_end date,
  day_start_minute int,
  day_end_minute int,
  slot_minutes int,
  duration_minutes int,
  names_required boolean,
  max_people int,
  expires_at timestamptz,
  is_creator boolean,
  answers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  poll public.quick_polls;
  hashed bytea := private.quick_poll_token_hash(quick_poll_preview.token);
  my_id uuid;
  st text;
begin
  select * into poll from public.quick_polls q where q.code = quick_poll_preview.code;
  if poll.id is null then
    raise exception using message = 'quick_poll_not_found', detail = 'This poll is not valid', errcode = 'PT404';
  end if;
  select a.id into my_id from public.quick_poll_answers a where a.poll_id = poll.id and a.token_hash = hashed;
  st := private.quick_poll_status(poll, my_id is not null);

  if st = 'expired' then
    return query select st, null::text, null::text, null::date, null::date, null::int, null::int,
      null::int, null::int, null::boolean, null::int, null::timestamptz, null::boolean, null::jsonb;
    return;
  end if;

  return query select
    st,
    poll.title,
    poll.timezone,
    poll.window_start,
    poll.window_end,
    poll.day_start_minute,
    poll.day_end_minute,
    poll.slot_minutes,
    poll.duration_minutes,
    poll.names_required,
    poll.max_people,
    poll.expires_at,
    coalesce(hashed = poll.creator_token_hash, false),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'seat', a.seat,
        'name', case when poll.names_required then a.display_name end,
        'mine', a.id is not distinct from my_id,
        'slots', (
          select coalesce(jsonb_agg(jsonb_build_object('slot_start', s.slot_start, 'level', s.level) order by s.slot_start), '[]'::jsonb)
          from public.quick_poll_slots s
          where s.answer_id = a.id
        )
      ) order by a.seat), '[]'::jsonb)
      from public.quick_poll_answers a
      where a.poll_id = poll.id
    );
end;
$$;

revoke execute on function public.quick_poll_preview(text, text) from public;
grant execute on function public.quick_poll_preview(text, text) to anon, authenticated, service_role;

-- Adds or replaces an answer. The browser makes its own token (16 to 200 characters) before its
-- first save and sends it every time, so a save resent after a lost reply edits the answer it
-- made instead of taking a second seat. A token this poll does not know makes a new answer under
-- it, if there is a seat; a known token edits its answer; the creator's token (from
-- create_quick_poll) makes or edits the creator's answer. No token, or a malformed one, is
-- invalid_quick_poll_token. Only the sha256 is kept, and the token is handed back as given. The
-- poll row lock serializes seats and the cap.
-- Limits: names 1 to 40 characters once cleaned when the poll asks for names (ignored and stored
-- as null when it does not), a new answer needs at least one slot, 60 saves per answer per hour,
-- max_people answers per poll (an answer already in can still edit a full poll).
create or replace function public.set_quick_poll_availability(code text, name text, token text, slots jsonb)
returns table (answer_token text, saved int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  poll public.quick_polls;
  me public.quick_poll_answers;
  hashed bytea := private.quick_poll_token_hash(set_quick_poll_availability.token);
  clean_name text;
  parsed jsonb;
  n int;
begin
  if hashed is null then
    raise exception using message = 'invalid_quick_poll_token', detail = 'The answer token is missing or not valid', errcode = '22023';
  end if;
  select * into poll from public.quick_polls q where q.code = set_quick_poll_availability.code for update;
  if poll.id is null then
    raise exception using message = 'quick_poll_not_found', detail = 'This poll is not valid', errcode = 'PT404';
  end if;
  select * into me from public.quick_poll_answers a where a.poll_id = poll.id and a.token_hash = hashed;

  case private.quick_poll_status(poll, me.id is not null)
    when 'expired' then
      raise exception using message = 'quick_poll_expired', detail = 'This poll has ended', errcode = '23514';
    when 'closed' then
      raise exception using message = 'quick_poll_closed', detail = 'This poll is closed', errcode = '23514';
    when 'full' then
      raise exception using message = 'quick_poll_full', detail = 'This poll is full', errcode = '23514';
    else
      null;
  end case;

  if poll.names_required then
    clean_name := private.clean_guest_name(set_quick_poll_availability.name);
    if char_length(clean_name) not between 1 and 40 then
      raise exception using message = 'invalid_quick_poll_name', detail = 'Names are 1 to 40 characters', errcode = '22023';
    end if;
  end if;

  parsed := private.grid_slots(
    poll.timezone, poll.window_start, poll.window_end, poll.day_start_minute, poll.day_end_minute,
    poll.slot_minutes, set_quick_poll_availability.slots
  );

  if me.id is null then
    if jsonb_array_length(parsed) = 0 then
      raise exception using message = 'quick_poll_slots_required', detail = 'Pick at least one time', errcode = '22023';
    end if;
    -- Answers only ever go with their poll, so the next seat is never one used before.
    insert into public.quick_poll_answers (poll_id, seat, display_name, token_hash)
    values (
      poll.id,
      coalesce((select max(a.seat) from public.quick_poll_answers a where a.poll_id = poll.id), 0) + 1,
      clean_name,
      hashed
    )
    returning * into me;
  elsif me.saves_window_start > now() - interval '1 hour' then
    if me.saves >= 60 then
      raise exception using message = 'quick_poll_rate_limited', detail = 'Too many saves, try again later', errcode = '23514';
    end if;
    update public.quick_poll_answers a
    set saves = a.saves + 1, display_name = clean_name, updated_at = now()
    where a.id = me.id;
  else
    update public.quick_poll_answers a
    set saves = 1, saves_window_start = now(), display_name = clean_name, updated_at = now()
    where a.id = me.id;
  end if;

  delete from public.quick_poll_slots s where s.answer_id = me.id;
  insert into public.quick_poll_slots (answer_id, slot_start, level)
  select me.id, s.slot_start, s.level
  from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level);
  get diagnostics n = row_count;

  return query select set_quick_poll_availability.token, n;
end;
$$;

revoke execute on function public.set_quick_poll_availability(text, text, text, jsonb) from public;
grant execute on function public.set_quick_poll_availability(text, text, text, jsonb) to anon, authenticated, service_role;

-- The creator stops new answers and edits. Results stay readable until the poll expires. Running
-- it again changes nothing.
create or replace function public.close_quick_poll(code text, token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  poll public.quick_polls;
begin
  select * into poll from public.quick_polls q where q.code = close_quick_poll.code for update;
  if poll.id is null then
    raise exception using message = 'quick_poll_not_found', detail = 'This poll is not valid', errcode = 'PT404';
  end if;
  if private.quick_poll_token_hash(close_quick_poll.token) is distinct from poll.creator_token_hash then
    raise exception using message = 'not_allowed', detail = 'Only whoever made the poll can close it', errcode = '42501';
  end if;
  update public.quick_polls q set closed_at = coalesce(q.closed_at, now()) where q.id = poll.id;
end;
$$;

revoke execute on function public.close_quick_poll(text, text) from public;
grant execute on function public.close_quick_poll(text, text) to anon, authenticated, service_role;

-- The creator deletes the poll, its answers and their slots now.
create or replace function public.delete_quick_poll(code text, token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  poll public.quick_polls;
begin
  select * into poll from public.quick_polls q where q.code = delete_quick_poll.code for update;
  if poll.id is null then
    raise exception using message = 'quick_poll_not_found', detail = 'This poll is not valid', errcode = 'PT404';
  end if;
  if private.quick_poll_token_hash(delete_quick_poll.token) is distinct from poll.creator_token_hash then
    raise exception using message = 'not_allowed', detail = 'Only whoever made the poll can delete it', errcode = '42501';
  end if;
  delete from public.quick_polls q where q.id = poll.id;
end;
$$;

revoke execute on function public.delete_quick_poll(text, text) from public;
grant execute on function public.delete_quick_poll(text, text) to anon, authenticated, service_role;
