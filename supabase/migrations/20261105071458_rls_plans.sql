-- RLS: events and planning. Status changes (schedule, cancel) and availability
-- writes go through RPCs; event details and RSVPs are written directly.

alter table public.events enable row level security;
alter table public.availability enable row level security;
alter table public.availability_requests enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.busy_blocks enable row level security;

create policy "events: members read"
on public.events for select
to authenticated
using (group_id in (select private.my_group_ids()));

create policy "events: members create"
on public.events for insert
to authenticated
with check (
  group_id in (select private.my_group_ids())
  and created_by = (select auth.uid())
  and status = 'polling'
);

create policy "events: creator or admin edit"
on public.events for update
to authenticated
using ((select private.can_manage_event(id)))
with check ((select private.can_manage_event(id)));

create policy "events: creator or admin delete"
on public.events for delete
to authenticated
using ((select private.can_manage_event(id)));

create policy "availability: members read"
on public.availability for select
to authenticated
using (event_id in (select private.my_event_ids()));

create policy "availability_requests: members read"
on public.availability_requests for select
to authenticated
using (event_id in (select private.my_event_ids()));

create policy "event_rsvps: members read"
on public.event_rsvps for select
to authenticated
using (event_id in (select private.my_event_ids()));

create policy "event_rsvps: rsvp for self"
on public.event_rsvps for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and event_id in (select private.my_event_ids())
);

create policy "event_rsvps: change own"
on public.event_rsvps for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and event_id in (select private.my_event_ids())
);

create policy "event_rsvps: delete own"
on public.event_rsvps for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "busy_blocks: read own"
on public.busy_blocks for select
to authenticated
using (user_id = (select auth.uid()));

create policy "busy_blocks: create own"
on public.busy_blocks for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "busy_blocks: delete own"
on public.busy_blocks for delete
to authenticated
using (user_id = (select auth.uid()));
