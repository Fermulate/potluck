-- Guest availability links (ADR 16). A member shares a link to a polling plan; anyone with it can
-- add their times with just a name, no account. Guests are their own rows, never auth users:
--
--   event_guest_links         one shareable code per link, with an expiry and a cap on guests
--   event_guests              one row per guest who answered through a link; the browser keeps a
--                             random token, the table keeps only its sha256
--   event_guest_availability  the guest's painted slots, same shape as public.availability
--
-- Clients never write these tables. Members read them (minus the token hash) for the heatmap and
-- the plan page; anon reads nothing and goes through two anon-callable RPCs that check the code,
-- expiry, revocation, the cap, the plan's status and the group's archive state on every call.
-- best_slots counts guests like members (removed ones not at all), so they count toward
-- min_attendees.
-- best_slots body as in 20261105071518_rpc_availability.sql plus the guest rows.

-- Tables ------------------------------------------------------------------------------------------

create table public.event_guest_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  code text not null unique default private.random_code(12),
  created_by uuid references public.profiles (id) on delete set null,
  max_guests int not null check (max_guests between 1 and 100),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.event_guest_links is
  'Shareable links that let people without an account add availability to one plan.';

create index event_guest_links_event_id_idx on public.event_guest_links (event_id);
create index event_guest_links_group_id_idx on public.event_guest_links (group_id);
create index event_guest_links_created_by_idx on public.event_guest_links (created_by);

create table public.event_guests (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.event_guest_links (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  token_hash bytea not null,
  saves int not null default 1,
  saves_window_start timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, token_hash)
);

comment on table public.event_guests is
  'People who answered a plan through a guest link. token_hash is sha256 of the token their browser keeps; it is never readable by clients.';
comment on column public.event_guests.saves is
  'Saves since saves_window_start: the per guest rate limit in set_guest_availability.';
comment on column public.event_guests.removed_at is
  'Set when the organizer removes the answer: the slots are deleted, the seat frees up, and the token can no longer answer.';

create index event_guests_link_id_idx on public.event_guests (link_id, created_at);
create index event_guests_event_id_idx on public.event_guests (event_id);
create index event_guests_group_id_idx on public.event_guests (group_id);

create table public.event_guest_availability (
  guest_id uuid not null references public.event_guests (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  slot_start timestamptz not null,
  level public.availability_level not null default 'yes',
  primary key (guest_id, slot_start)
);

create index event_guest_availability_event_slot_idx
  on public.event_guest_availability (event_id, slot_start);

-- Privileges and RLS: members read, nobody writes directly ---------------------------------------

revoke all on public.event_guest_links from anon, authenticated;
revoke all on public.event_guests from anon, authenticated;
revoke all on public.event_guest_availability from anon, authenticated;

grant all on public.event_guest_links to service_role;
grant all on public.event_guests to service_role;
grant all on public.event_guest_availability to service_role;

grant select on public.event_guest_links to authenticated;
grant select (id, link_id, event_id, group_id, display_name, created_at, updated_at)
  on public.event_guests to authenticated;
grant select on public.event_guest_availability to authenticated;

alter table public.event_guest_links enable row level security;
alter table public.event_guests enable row level security;
alter table public.event_guest_availability enable row level security;

create policy "event_guest_links: members read" on public.event_guest_links
  for select to authenticated
  using (group_id = any (array(select private.my_group_ids())));

create policy "event_guests: members read" on public.event_guests
  for select to authenticated
  using (group_id = any (array(select private.my_group_ids())) and removed_at is null);

create policy "event_guest_availability: members read" on public.event_guest_availability
  for select to authenticated
  using (event_id = any (array(select private.my_event_ids())));

-- ADR 13: Realtime skips private.check_request(), so a session that still owes its two-step code
-- reads nothing here.
create policy "event_guest_links: two-step sign in done" on public.event_guest_links
  as restrictive for select to authenticated
  using ((select private.mfa_satisfied()));

create policy "event_guests: two-step sign in done" on public.event_guests
  as restrictive for select to authenticated
  using ((select private.mfa_satisfied()));

create policy "event_guest_availability: two-step sign in done" on public.event_guest_availability
  as restrictive for select to authenticated
  using ((select private.mfa_satisfied()));

alter publication supabase_realtime add table public.event_guest_availability;

-- Helpers -----------------------------------------------------------------------------------------

-- A guest's name as typed, made safe to show: invisible and zero width characters (soft hyphen,
-- joiners, bidi controls, variation selectors, tag characters, Hangul fillers, the BOM) are dropped,
-- any run of whitespace or control characters becomes one space, and the ends are trimmed. Same
-- rules and test cases as cleanGuestName in packages/core.
create or replace function private.clean_guest_name(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      coalesce(name, ''),
      '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U0001D173-\U0001D17A\U000E0000-\U000E007F]',
      '',
      'g'
    ),
    '[\s\u0001-\u001F\u007F-\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+',
    ' ',
    'g'
  ));
$$;

revoke execute on function private.clean_guest_name(text) from public, anon, authenticated;

-- Parses and checks a slots payload against an event's grid. The same rules as the grid check in
-- public.set_availability (and buildSlots in packages/core); returns [{slot_start, level}].
create or replace function private.event_slots(ev public.events, slots jsonb)
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

  return parsed;
end;
$$;

-- The guest a browser token belongs to on one link, or null.
create or replace function private.guest_for_token(lid uuid, token text)
returns public.event_guests
language sql
stable
security definer
set search_path = ''
as $$
  select g.*
  from public.event_guests g
  where g.link_id = lid
    and token is not null
    and char_length(token) between 16 and 200
    and g.token_hash = sha256(convert_to(token, 'UTF8'));
$$;

revoke execute on function private.event_slots(public.events, jsonb) from public, anon, authenticated;
revoke execute on function private.guest_for_token(uuid, text) from public, anon, authenticated;

-- Signed-in RPCs ----------------------------------------------------------------------------------

create or replace function public.create_guest_link(event_id uuid, ttl text, max_guests int default 10)
returns public.event_guest_links
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  ev public.events := private.member_event(create_guest_link.event_id);
  link public.event_guest_links;
begin
  perform private.require_group_open(ev.group_id);
  -- Serializes with schedule_event and cancel_event, and with other links for this plan.
  select * into ev from public.events e where e.id = ev.id for no key update;
  if ev.status <> 'polling' then
    raise exception using message = 'event_not_polling', detail = 'This event is no longer collecting availability', errcode = '23514';
  end if;
  if ttl is null or ttl not in ('24h', '7d', '30d') then
    raise exception using message = 'invalid_guest_link_ttl', detail = 'Links last 24 hours, 7 days or 30 days', errcode = '22023';
  end if;
  if create_guest_link.max_guests is null or create_guest_link.max_guests not between 1 and 100 then
    raise exception using message = 'invalid_guest_limit', detail = 'A link takes 1 to 100 guests', errcode = '22023';
  end if;
  if (
    select count(*) from public.event_guest_links l
    where l.event_id = ev.id and l.revoked_at is null and l.expires_at > now()
  ) >= 20 then
    raise exception using message = 'guest_link_limit', detail = 'This plan already has 20 open guest links', errcode = '23514';
  end if;

  insert into public.event_guest_links (event_id, group_id, created_by, max_guests, expires_at)
  values (
    ev.id,
    ev.group_id,
    uid,
    create_guest_link.max_guests,
    now() + case ttl when '24h' then interval '24 hours' when '7d' then interval '7 days' else interval '30 days' end
  )
  returning * into link;

  return link;
end;
$$;

revoke execute on function public.create_guest_link(uuid, text, int) from public, anon;
grant execute on function public.create_guest_link(uuid, text, int) to authenticated, service_role;

create or replace function public.revoke_guest_link(link_id uuid)
returns public.event_guest_links
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  link public.event_guest_links;
  my_role public.group_role;
begin
  select * into link from public.event_guest_links l where l.id = revoke_guest_link.link_id for update;
  if link.id is null then
    raise exception using message = 'guest_link_not_found', detail = 'This guest link is not valid', errcode = 'PT404';
  end if;
  my_role := private.require_member(link.group_id);
  if my_role = 'member'
     and link.created_by is distinct from uid
     and (select e.created_by from public.events e where e.id = link.event_id) is distinct from uid then
    raise exception using message = 'not_allowed', detail = 'Only whoever made the link, the organizer or a group admin can do that', errcode = '42501';
  end if;
  perform private.require_group_open(link.group_id);

  update public.event_guest_links l set revoked_at = coalesce(l.revoked_at, now())
  where l.id = link.id
  returning * into link;
  return link;
end;
$$;

revoke execute on function public.revoke_guest_link(uuid) from public, anon;
grant execute on function public.revoke_guest_link(uuid) to authenticated, service_role;

create or replace function public.remove_guest_answer(guest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  guest public.event_guests;
begin
  perform private.require_user();
  select * into guest from public.event_guests g where g.id = remove_guest_answer.guest_id;
  if guest.id is null then
    raise exception using message = 'guest_not_found', detail = 'That guest answer is already gone', errcode = 'PT404';
  end if;
  -- The link row lock serializes with set_guest_availability, so no save lands after the removal.
  -- Link before event, the order set_guest_availability takes them in.
  perform 1 from public.event_guest_links l where l.id = guest.link_id for update;
  -- Organizer or group admin, group not archived.
  perform private.manageable_event(guest.event_id);
  select * into guest from public.event_guests g where g.id = guest.id;
  if guest.removed_at is not null then
    raise exception using message = 'guest_not_found', detail = 'That guest answer is already gone', errcode = 'PT404';
  end if;
  -- Keep the row so the guest's token cannot answer again; the slots go and the seat frees up.
  delete from public.event_guest_availability ga where ga.guest_id = guest.id;
  update public.event_guests g set removed_at = now(), updated_at = now() where g.id = guest.id;
end;
$$;

revoke execute on function public.remove_guest_answer(uuid) from public, anon;
grant execute on function public.remove_guest_answer(uuid) to authenticated, service_role;

-- Anon-callable RPCs ------------------------------------------------------------------------------

-- What a guest link shows. status is one of:
--   open       answers welcome: the plan, the grid, aggregated heat, the visitor's own answer
--   full       every seat taken (a guest who already answered still sees open): the plan only
--   scheduled  the plan has a time: title, emojis, host, starts_at and ends_at. Only for a guest
--              who answered through this link
--   removed    the organizer removed this visitor's answer
--   revoked, expired, archived, closed (cancelled, or no longer polling): nothing else
-- heat is [{slot_start, yes, maybe}] from members and guests, never names or ids.
create or replace function public.guest_link_preview(code text, token text default null)
returns table (
  status text,
  title text,
  emoji text,
  group_emoji text,
  host_name text,
  timezone text,
  window_start date,
  window_end date,
  day_start_minute int,
  day_end_minute int,
  slot_minutes int,
  duration_minutes int,
  expires_at timestamptz,
  max_guests int,
  guest_count int,
  respondents int,
  my_name text,
  my_slots jsonb,
  heat jsonb,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  link public.event_guest_links;
  ev public.events;
  grp public.groups;
  me public.event_guests;
  answered boolean;
  guests int;
  host text;
  st text;
begin
  select * into link from public.event_guest_links l where l.code = guest_link_preview.code;
  if link.id is null then
    raise exception using message = 'guest_link_not_found', detail = 'This guest link is not valid', errcode = 'PT404';
  end if;
  select * into ev from public.events e where e.id = link.event_id;
  select * into grp from public.groups g where g.id = link.group_id;
  me := private.guest_for_token(link.id, guest_link_preview.token);
  answered := me.id is not null and me.removed_at is null;
  select count(*)::int into guests from public.event_guests g
  where g.link_id = link.id and g.removed_at is null;
  select nullif(split_part(p.display_name, ' ', 1), '') into host
  from public.profiles p where p.id = link.created_by and p.deleted_at is null;

  st := case
    when link.revoked_at is not null then 'revoked'
    when grp.archived_at is not null then 'archived'
    when me.removed_at is not null then 'removed'
    when ev.status in ('scheduled', 'done') and answered then 'scheduled'
    when link.expires_at <= now() then 'expired'
    when ev.status <> 'polling' then 'closed'
    when not answered and guests >= link.max_guests then 'full'
    else 'open'
  end;

  if st = 'scheduled' then
    return query select st, ev.title, ev.emoji, grp.emoji, host, ev.timezone,
      null::date, null::date, null::int, null::int, null::int, null::int,
      null::timestamptz, null::int, null::int, null::int,
      me.display_name, null::jsonb, null::jsonb,
      ev.starts_at, ev.ends_at;
    return;
  end if;

  if st not in ('open', 'full') then
    return query select st, null::text, null::text, null::text, null::text, null::text,
      null::date, null::date, null::int, null::int, null::int, null::int,
      null::timestamptz, null::int, null::int, null::int, null::text, null::jsonb, null::jsonb,
      null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
  with answers as (
    select a.user_id as who, a.slot_start, a.level
    from public.availability a
    join public.group_members m on m.group_id = ev.group_id and m.user_id = a.user_id
    where a.event_id = ev.id
    union all
    select ga.guest_id, ga.slot_start, ga.level
    from public.event_guest_availability ga
    join public.event_guests g on g.id = ga.guest_id and g.removed_at is null
    where ga.event_id = ev.id
  )
  select
    st,
    ev.title,
    ev.emoji,
    grp.emoji,
    host,
    ev.timezone,
    ev.window_start,
    ev.window_end,
    ev.day_start_minute,
    ev.day_end_minute,
    ev.slot_minutes,
    ev.duration_minutes,
    link.expires_at,
    link.max_guests,
    guests,
    case when st = 'open' then (select count(distinct x.who)::int from answers x) end,
    case when answered then me.display_name end,
    case when answered then (
      select coalesce(jsonb_agg(jsonb_build_object('slot_start', ga.slot_start, 'level', ga.level) order by ga.slot_start), '[]'::jsonb)
      from public.event_guest_availability ga where ga.guest_id = me.id
    ) end,
    case when st = 'open' then (
      select coalesce(jsonb_agg(jsonb_build_object('slot_start', h.slot_start, 'yes', h.yes, 'maybe', h.maybe) order by h.slot_start), '[]'::jsonb)
      from (
        select
          x.slot_start,
          (count(*) filter (where x.level = 'yes'))::int as yes,
          (count(*) filter (where x.level = 'maybe'))::int as maybe
        from answers x
        group by x.slot_start
      ) h
    ) end,
    null::timestamptz,
    null::timestamptz;
end;
$$;

revoke execute on function public.guest_link_preview(text, text) from public;
grant execute on function public.guest_link_preview(text, text) to anon, authenticated, service_role;

-- Adds or replaces a guest's answer. No token (or one this link does not know) makes a new guest,
-- if the link has room, and returns a fresh token for the browser to keep; a known token edits
-- that guest. The link row lock serializes the cap and the rate limits.
-- Limits: names 1 to 40 characters once cleaned (private.clean_guest_name), a new guest needs at
-- least one slot, 20 new guests per link per 10 minutes, 60 saves per guest per hour, max_guests
-- guests per link. A token whose answer the organizer removed is refused (guest_removed).
create or replace function public.set_guest_availability(code text, name text, token text, slots jsonb)
returns table (guest_token text, saved int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  link public.event_guest_links;
  ev public.events;
  grp public.groups;
  me public.event_guests;
  clean_name text := private.clean_guest_name(set_guest_availability.name);
  parsed jsonb;
  fresh_token text;
  n int;
begin
  select * into link from public.event_guest_links l where l.code = set_guest_availability.code for update;
  if link.id is null then
    raise exception using message = 'guest_link_not_found', detail = 'This guest link is not valid', errcode = 'PT404';
  end if;
  select * into ev from public.events e where e.id = link.event_id;
  select * into grp from public.groups g where g.id = link.group_id;

  if link.revoked_at is not null then
    raise exception using message = 'guest_link_revoked', detail = 'This guest link was turned off', errcode = '23514';
  end if;
  if link.expires_at <= now() then
    raise exception using message = 'guest_link_expired', detail = 'This guest link has expired', errcode = '23514';
  end if;
  if grp.archived_at is not null then
    raise exception using message = 'group_archived', detail = 'This group is archived', errcode = '23514';
  end if;
  if ev.status <> 'polling' then
    raise exception using message = 'event_not_polling', detail = 'This event is no longer collecting availability', errcode = '23514';
  end if;
  if char_length(clean_name) not between 1 and 40 then
    raise exception using message = 'invalid_guest_name', detail = 'Names are 1 to 40 characters', errcode = '22023';
  end if;

  parsed := private.event_slots(ev, slots);
  me := private.guest_for_token(link.id, set_guest_availability.token);
  if me.removed_at is not null then
    raise exception using message = 'guest_removed', detail = 'The organizer removed this answer', errcode = '42501';
  end if;

  if me.id is null then
    if jsonb_array_length(parsed) = 0 then
      raise exception using message = 'guest_slots_required', detail = 'Pick at least one time', errcode = '22023';
    end if;
    select count(*)::int into n from public.event_guests g
    where g.link_id = link.id and g.removed_at is null;
    if n >= link.max_guests then
      raise exception using message = 'guest_link_full', detail = 'This guest link is full', errcode = '23514';
    end if;
    if (
      select count(*) from public.event_guests g
      where g.link_id = link.id and g.created_at > now() - interval '10 minutes'
    ) >= 20 then
      raise exception using message = 'guest_rate_limited', detail = 'Too many answers at once, try again in a few minutes', errcode = '23514';
    end if;
    fresh_token := private.random_code(24);
    insert into public.event_guests (link_id, event_id, group_id, display_name, token_hash)
    values (link.id, ev.id, ev.group_id, clean_name, sha256(convert_to(fresh_token, 'UTF8')))
    returning * into me;
  elsif me.saves_window_start > now() - interval '1 hour' then
    if me.saves >= 60 then
      raise exception using message = 'guest_rate_limited', detail = 'Too many saves, try again later', errcode = '23514';
    end if;
    update public.event_guests g
    set saves = g.saves + 1, display_name = clean_name, updated_at = now()
    where g.id = me.id;
  else
    update public.event_guests g
    set saves = 1, saves_window_start = now(), display_name = clean_name, updated_at = now()
    where g.id = me.id;
  end if;

  delete from public.event_guest_availability ga where ga.guest_id = me.id;
  insert into public.event_guest_availability (guest_id, event_id, slot_start, level)
  select me.id, ev.id, s.slot_start, s.level
  from jsonb_to_recordset(parsed) as s (slot_start timestamptz, level public.availability_level);
  get diagnostics n = row_count;

  return query select coalesce(fresh_token, set_guest_availability.token), n;
end;
$$;

revoke execute on function public.set_guest_availability(text, text, text, jsonb) from public;
grant execute on function public.set_guest_availability(text, text, text, jsonb) to anon, authenticated, service_role;

-- best_slots with guests --------------------------------------------------------------------------

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
  max_rows int := least(greatest(coalesce($2, 5), 0), 100);
begin
  return query
  with members as (
    select m.user_id from public.group_members m where m.group_id = ev.group_id
    union all
    select g.id from public.event_guests g where g.event_id = ev.id and g.removed_at is null
  ),
  answers as (
    select a.user_id, a.slot_start, a.level from public.availability a where a.event_id = ev.id
    union all
    select ga.guest_id, ga.slot_start, ga.level from public.event_guest_availability ga where ga.event_id = ev.id
  ),
  candidates as (
    select distinct a.slot_start as slot
    from answers a
    join members mb on mb.user_id = a.user_id
  ),
  per_person as (
    select
      c.slot,
      mb.user_id,
      count(a.slot_start) as covered,
      coalesce(bool_and(a.level = 'yes'), false) as all_yes
    from candidates c
    cross join members mb
    cross join generate_series(0, cells - 1) as k (i)
    left join answers a
      on a.user_id = mb.user_id
     and a.slot_start = c.slot + make_interval(mins => k.i * ev.slot_minutes)
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
