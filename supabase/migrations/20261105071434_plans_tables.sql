-- Events, availability polling, RSVPs and imported busy time.
--
-- The availability grid of an event covers every day in [window_start, window_end]
-- from day_start_minute to day_end_minute, in the event's timezone, cut into
-- slot_minutes cells. availability.slot_start is the UTC start of one cell.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (char_length(description) <= 4000),
  location text check (char_length(location) <= 300),
  emoji text check (char_length(emoji) <= 16),
  status public.event_status not null default 'polling',
  timezone text not null default 'UTC',
  window_start date not null default current_date,
  window_end date not null default (current_date + 6),
  day_start_minute int not null default 480,
  day_end_minute int not null default 1320,
  slot_minutes int not null default 30,
  duration_minutes int not null default 120,
  min_attendees int not null default 2,
  starts_at timestamptz,
  ends_at timestamptz,
  rsvp_deadline timestamptz,
  reminder_sent_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end >= window_start and window_end - window_start <= 62),
  check (day_start_minute between 0 and 1439),
  check (day_end_minute between 1 and 1440 and day_end_minute > day_start_minute),
  check (slot_minutes in (15, 30, 60)),
  check (duration_minutes between 15 and 1440),
  check (min_attendees >= 1),
  check (ends_at is null or (starts_at is not null and ends_at > starts_at)),
  check (status <> 'scheduled' or starts_at is not null)
);

comment on column public.events.timezone is 'IANA zone the availability window (days, day_start/day_end) is expressed in.';
comment on column public.events.reminder_sent_at is 'Set by the hourly reminder job so each event is reminded once.';

create index events_group_id_idx on public.events (group_id);
create index events_created_by_idx on public.events (created_by);
create index events_starts_at_idx on public.events (starts_at) where status = 'scheduled';

create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();

alter table public.expenses
  add constraint expenses_event_id_fkey
  foreign key (event_id) references public.events (id) on delete set null;

create table public.availability (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot_start timestamptz not null,
  level public.availability_level not null default 'yes',
  primary key (event_id, user_id, slot_start)
);

create index availability_user_id_idx on public.availability (user_id);
create index availability_event_slot_idx on public.availability (event_id, slot_start);

create table public.availability_requests (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (event_id, user_id)
);

create index availability_requests_user_id_idx on public.availability_requests (user_id);
create index availability_requests_requested_by_idx on public.availability_requests (requested_by);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.rsvp_status not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_rsvps_user_id_idx on public.event_rsvps (user_id);

create trigger event_rsvps_set_updated_at
before update on public.event_rsvps
for each row execute function private.set_updated_at();

create table public.busy_blocks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'manual' check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (user_id, starts_at, ends_at, source)
);

comment on table public.busy_blocks is 'Imported busy time, shown as hatched cells on the availability grid.';

revoke all on table public.events, public.availability, public.availability_requests,
  public.event_rsvps, public.busy_blocks from anon, authenticated;

grant select, delete on table public.events to authenticated;
grant insert (id, group_id, title, description, location, emoji, timezone, window_start, window_end,
  day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees, rsvp_deadline)
  on table public.events to authenticated;
grant update (title, description, location, emoji, timezone, window_start, window_end,
  day_start_minute, day_end_minute, slot_minutes, duration_minutes, min_attendees, rsvp_deadline)
  on table public.events to authenticated;

grant select on table public.availability, public.availability_requests to authenticated;
grant select, insert, delete on table public.event_rsvps to authenticated;
grant update (status) on table public.event_rsvps to authenticated;
grant select, insert, delete on table public.busy_blocks to authenticated;

grant all on table public.events, public.availability, public.availability_requests,
  public.event_rsvps, public.busy_blocks to service_role;
